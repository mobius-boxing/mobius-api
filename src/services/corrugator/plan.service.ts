/**
 * corrugator-planning DB orchestration (docs/dev/corrugator-planning/model.md
 * + Amendments). Controllers stay thin; every cross-table transaction (pool,
 * seeding, solve start/complete, adjust, register/unregister) lives here so
 * that solve completion — which runs from the worker's promise, with no
 * request in scope — can reuse the exact same code paths.
 *
 * Imports the engine ONLY through the five allowed modules (types.ts,
 * solve-runner.ts, solution.ts, combinator.ts, pending.service.ts) — see the
 * implementer brief. Nothing here touches geometry.ts/mesas.ts/model-builder.ts
 * directly.
 */
import { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { db, withTenant } from "../../database/registry";
import { withAuditContext } from "../../database/audit-context";
import { AppConfigService } from "../app-config.service";
import { CoreClient } from "../core-client.service";
import {
  IRouteStage,
  IStageSupply,
} from "../../interfaces/production-route/production-route.interfaces";
import {
  CorrugatorMachineSnapshot,
  CorrugatorParameters,
  CORRUGATOR_PARAMETER_DEFAULTS,
  CorrugatorBoard,
  CorrugatorSheetsSource,
  CorrugatorPlanStatus,
  ICorrugatorPlan,
  ICorrugatorPlanOrder,
  ICorrugatorPlanCombination,
  ICorrugatorPlanItem,
  ICorrugatorPool,
  ICorrugatorPoolGroup,
  ICorrugatorNotPlannable,
  ICorrugatorCandidate,
  ICorrugatorOrderState,
  ICorrugatorPlanMachineInput,
  IPaperClassRef,
  engineMachines,
} from "../../interfaces/corrugator-plan/corrugator-plan.interfaces";
import {
  Candidate,
  EngineCombination,
  EngineInput,
  SolveOutcome,
} from "./types";
import {
  startSolve as startSolveEngine,
  runningSolves,
  type SolveHandle,
} from "./solve-runner";
import {
  evaluate,
  checkFeasible,
  metersForPlannedSheets,
  suggestedMeters,
  resequence,
} from "./solution";
import { enumerate } from "./combinator";
import {
  corrugationSheetsPerUnit,
  pendingSheets,
} from "../scheduling/pending.service";
import { CorrugatorPlanDAO } from "../../dao/corrugator-plan/corrugator-plan.dao";
import { CorrugatorPlanOrderDAO } from "../../dao/corrugator-plan/corrugator-plan-order.dao";
import { CorrugatorPlanCombinationDAO } from "../../dao/corrugator-plan/corrugator-plan-combination.dao";

const TABLE = "corrugator_plans";
const MAX_LOG_CHARS = 20_000;
const SOLVE_JOB = { source: "job" as const, username: "corrugator-solver" };

export type ServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      message: string;
      code?: string;
      details?: Record<string, unknown>;
    };

const appConfig = new AppConfigService();
const planDao = new CorrugatorPlanDAO();
const orderDao = new CorrugatorPlanOrderDAO();
const combinationDao = new CorrugatorPlanCombinationDAO();

/** Solve handles for this process, keyed by numeric plan id (for cancel-solve). */
const activeSolves = new Map<number, SolveHandle>();

const physicalOf = (machineKey: string): string =>
  machineKey.slice(0, machineKey.lastIndexOf(":"));

const truncateLog = (log: string): string =>
  log.length > MAX_LOG_CHARS ? log.slice(0, MAX_LOG_CHARS) : log;

// ── Board key (D-10 + Amendment C-2) ────────────────────────────────────────

interface LayerInfo {
  position: number;
  isLiner: boolean;
  paperClassCode: string | null;
  fluteTypeCode: string | null;
}

function computeBoardKey(
  layers: LayerInfo[],
  theoreticalGrammage: number | null,
  corrugationCode: string,
): string {
  const base = layers.length
    ? [...layers]
        .sort((a, b) => a.position - b.position)
        .map(
          (l) =>
            `${l.position}:${l.isLiner ? "L" : "F"}:${l.paperClassCode ?? "-"}:${l.fluteTypeCode ?? "-"}`,
        )
        .join("|")
    : `corrugation:${corrugationCode}`;
  return `${base}|g:${theoreticalGrammage ?? 0}`;
}

// ── Batched loaders (C-7: no per-order query) ───────────────────────────────

interface CorrugationInfo {
  uuid: string;
  code: string;
  theoreticalGrammage: number | null;
  layers: LayerInfo[];
  fluteTypes: string[];
  paperClasses: IPaperClassRef[];
}

async function loadCorrugationsBatch(
  companyId: number,
  corrugationIds: number[],
): Promise<Map<number, CorrugationInfo>> {
  const result = new Map<number, CorrugationInfo>();
  if (corrugationIds.length === 0) return result;
  const knex = db("tenant");
  const corrRows = await knex("corrugations")
    .whereIn("id", corrugationIds)
    .andWhere("companyId", companyId)
    .select("id", "uuid", "code", "theoreticalGrammage");
  const layerRows = await knex("corrugation_layers as cl")
    .whereIn("cl.corrugationId", corrugationIds)
    .leftJoin("paper_classes as pc", "cl.paperClassId", "pc.id")
    .leftJoin("flute_types as ft", "cl.fluteTypeId", "ft.id")
    .select(
      "cl.corrugationId as corrugationId",
      "cl.position as position",
      "cl.isLiner as isLiner",
      "pc.code as paperClassCode",
      "pc.name as paperClassName",
      "ft.code as fluteTypeCode",
    )
    .orderBy(["cl.corrugationId", "cl.position"]);
  const layersByCorr = new Map<number, any[]>();
  for (const l of layerRows) {
    const list = layersByCorr.get(l.corrugationId) ?? [];
    list.push(l);
    layersByCorr.set(l.corrugationId, list);
  }
  for (const c of corrRows) {
    const rows = layersByCorr.get(c.id) ?? [];
    const fluteTypes = [
      ...new Set(
        rows.map((l) => l.fluteTypeCode).filter((x): x is string => !!x),
      ),
    ];
    const paperClassMap = new Map<string, string>();
    for (const l of rows) {
      if (l.paperClassCode)
        paperClassMap.set(
          l.paperClassCode,
          l.paperClassName ?? l.paperClassCode,
        );
    }
    result.set(c.id, {
      uuid: c.uuid,
      code: c.code,
      theoreticalGrammage:
        c.theoreticalGrammage != null ? Number(c.theoreticalGrammage) : null,
      layers: rows.map((l) => ({
        position: l.position,
        isLiner: l.isLiner,
        paperClassCode: l.paperClassCode ?? null,
        fluteTypeCode: l.fluteTypeCode ?? null,
      })),
      fluteTypes,
      paperClasses: [...paperClassMap.entries()].map(([code, name]) => ({
        code,
        name,
      })),
    });
  }
  return result;
}

/** Minimal `IRouteStage[]` per route — only the fields `stageFactors`/`corrugationSheetsPerUnit` read. */
async function loadRouteStagesBatch(
  routeIds: number[],
): Promise<Map<number, IRouteStage[]>> {
  const result = new Map<number, IRouteStage[]>();
  if (routeIds.length === 0) return result;
  const knex = db("tenant");
  const stageRows = await knex("production_route_stages")
    .whereIn("routeId", routeIds)
    .orderBy(["routeId", "number"])
    .select("id", "routeId", "number", "isCorrugation");
  const stageIds = stageRows.map((s: any) => s.id);
  const supplyRows = stageIds.length
    ? await knex("production_route_stage_supplies")
        .whereIn("stageId", stageIds)
        .select("stageId", "direction", "supplyType", "supplyId", "quantity")
    : [];
  const suppliesByStage = new Map<number, IStageSupply[]>();
  for (const s of supplyRows) {
    const list = suppliesByStage.get(s.stageId) ?? [];
    list.push({
      direction: s.direction,
      supplyType: s.supplyType,
      supplyId: s.supplyId,
      quantity: s.quantity != null ? parseFloat(s.quantity) : null,
      repetitionsWidth: 0,
      repetitionsLength: 0,
      allowsSimilar: false,
    });
    suppliesByStage.set(s.stageId, list);
  }
  for (const routeId of routeIds) {
    const stages: IRouteStage[] = stageRows
      .filter((s: any) => s.routeId === routeId)
      .map((s: any, i: number) => ({
        number: s.number ?? i,
        setupTimeMinutes: 0,
        machines: [],
        isCorrugation: s.isCorrugation,
        supplies: suppliesByStage.get(s.id) ?? [],
      }));
    result.set(routeId, stages);
  }
  return result;
}

async function loadAllocatedElsewhereBatch(
  productionOrderIds: number[],
  trx?: Knex.Transaction,
  excludePlanId?: number,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (productionOrderIds.length === 0) return map;
  const knex = trx ?? db("tenant");
  const q = knex("corrugator_plan_orders as o")
    .join("corrugator_plans as p", "p.id", "o.planId")
    .whereIn("o.productionOrderId", productionOrderIds)
    .andWhere("p.status", "registered");
  if (excludePlanId) q.andWhereNot("p.id", excludePlanId);
  const rows = await q
    .select("o.productionOrderId as productionOrderId")
    .sum("o.allocatedSheets as total")
    .groupBy("o.productionOrderId");
  for (const r of rows) map.set(r.productionOrderId, Number(r.total) || 0);
  return map;
}

async function loadInPlansBatch(
  companyId: number,
  productionOrderIds: number[],
): Promise<
  Map<
    number,
    {
      uuid: string;
      number: number;
      status: CorrugatorPlanStatus;
      registeredAt: Date | null;
    }[]
  >
> {
  const map = new Map<
    number,
    {
      uuid: string;
      number: number;
      status: CorrugatorPlanStatus;
      registeredAt: Date | null;
    }[]
  >();
  if (productionOrderIds.length === 0) return map;
  const rows = await db("tenant")("corrugator_plan_orders as o")
    .join("corrugator_plans as p", "p.id", "o.planId")
    .where("p.companyId", companyId)
    .whereIn("o.productionOrderId", productionOrderIds)
    .select(
      "o.productionOrderId as productionOrderId",
      "p.uuid as uuid",
      "p.number as number",
      "p.status as status",
      "p.registeredAt as registeredAt",
    );
  for (const r of rows) {
    const list = map.get(r.productionOrderId) ?? [];
    list.push({
      uuid: r.uuid,
      number: r.number,
      status: r.status,
      registeredAt: r.registeredAt,
    });
    map.set(r.productionOrderId, list);
  }
  return map;
}

// ── Eligible order rows + context (I-1, §Seeding, P-1, P-3) ────────────────

interface RawOrderRow {
  id: number;
  uuid: string;
  number: string;
  deliveryDate: Date | null;
  orderQuantity: number;
  routeId: number | null;
  productId: number;
  productUuid: string;
  productCode: string;
  productDescription: string | null;
  sheetLength: number | null;
  sheetWidth: number | null;
  mandatoryRotation: boolean;
  allowsRotationRaw: boolean;
  corrugationScoreLines: string | null;
  corrugationId: number | null;
  productionRouteId: number | null;
  underrunPercentage: number | null;
  overrunPercentage: number | null;
  customerUuid: string | null;
  customerName: string | null;
}

/** I-1 eligibility, batched: one query for the whole candidate set (`ids`) or the full pool (`search`). */
async function loadEligibleOrders(
  companyId: number,
  opts: { ids?: number[]; search?: string },
): Promise<RawOrderRow[]> {
  const knex = db("tenant");
  const q = knex("production_orders as po")
    .join("products as pr", "pr.id", "po.productId")
    .leftJoin("customers as cu", "cu.id", "pr.customerId")
    .where("po.companyId", companyId)
    .whereNotNull("po.schedulingApprovedAt")
    .whereNull("po.voidedAt")
    .whereNull("po.completedAt")
    .select(
      "po.id as id",
      "po.uuid as uuid",
      "po.number as number",
      "po.deliveryDate as deliveryDate",
      "po.quantity as orderQuantity",
      "po.routeId as routeId",
      "pr.uuid as productUuid",
      "pr.code as productCode",
      "pr.description as productDescription",
      "pr.sheetLength as sheetLength",
      "pr.sheetWidth as sheetWidth",
      "pr.mandatoryRotation as mandatoryRotation",
      "pr.allowsRotation as allowsRotationRaw",
      "pr.corrugationScoreLines as corrugationScoreLines",
      "pr.corrugationId as corrugationId",
      "pr.productionRouteId as productionRouteId",
      "pr.underrunPercentage as underrunPercentage",
      "pr.overrunPercentage as overrunPercentage",
      "cu.uuid as customerUuid",
      "cu.name as customerName",
    );
  if (opts.ids && opts.ids.length) q.whereIn("po.id", opts.ids);
  if (opts.search) {
    const s = `%${opts.search}%`;
    q.andWhere((b) => {
      b.where("po.number", "ILIKE", s)
        .orWhere("cu.name", "ILIKE", s)
        .orWhere("pr.code", "ILIKE", s);
    });
  }
  const rows = await q;
  return rows.map((r: any) => ({
    ...r,
    orderQuantity: Number(r.orderQuantity) || 0,
    sheetLength: r.sheetLength != null ? Number(r.sheetLength) : null,
    sheetWidth: r.sheetWidth != null ? Number(r.sheetWidth) : null,
    underrunPercentage:
      r.underrunPercentage != null ? Number(r.underrunPercentage) : 0,
    overrunPercentage:
      r.overrunPercentage != null ? Number(r.overrunPercentage) : 0,
  }));
}

export interface OrderContext {
  productionOrderId: number;
  productionOrderUuid: string;
  number: string;
  customerUuid: string | null;
  customerName: string | null;
  productUuid: string;
  productCode: string;
  productDescription: string | null;
  deliveryDate: Date | null;
  sheetLength: number | null;
  sheetWidth: number | null;
  allowsRotation: boolean;
  scoreLineCount: number;
  orderQuantity: number;
  corrugationId: number | null;
  board: CorrugatorBoard | null;
  sheetsPerUnit: number;
  sheetsSource: CorrugatorSheetsSource;
  requiredSheets: number;
  underrunPercentage: number;
  overrunPercentage: number;
  allocatedElsewhere: number;
  pendingSheets: number;
}

async function buildOrderContexts(
  companyId: number,
  rows: RawOrderRow[],
): Promise<OrderContext[]> {
  const corrugationIds = [
    ...new Set(
      rows.map((r) => r.corrugationId).filter((x): x is number => x != null),
    ),
  ];
  const routeIds = [
    ...new Set(
      rows
        .map((r) => r.routeId ?? r.productionRouteId)
        .filter((x): x is number => x != null),
    ),
  ];
  const orderIds = rows.map((r) => r.id);
  const [corrMap, stagesMap, allocMap, absolute, relative] = await Promise.all([
    loadCorrugationsBatch(companyId, corrugationIds),
    loadRouteStagesBatch(routeIds),
    loadAllocatedElsewhereBatch(orderIds),
    appConfig.getNumber(companyId, "ToleranciaProgramacion"),
    appConfig.getNumber(companyId, "ToleranciaRelativaProgramacion"),
  ]);

  return rows.map((r) => {
    const swapped = !!r.mandatoryRotation;
    const sheetLength = swapped ? r.sheetWidth : r.sheetLength;
    const sheetWidth = swapped ? r.sheetLength : r.sheetWidth;
    const allowsRotation = !!r.allowsRotationRaw && !r.mandatoryRotation;
    const trimmed = (r.corrugationScoreLines ?? "").trim();
    const scoreLineCount = trimmed === "" ? 0 : trimmed.split(";").length;
    const effectiveRouteId = r.routeId ?? r.productionRouteId ?? null;
    const stages =
      effectiveRouteId != null
        ? (stagesMap.get(effectiveRouteId) ?? null)
        : null;
    const { sheetsPerUnit, source } = corrugationSheetsPerUnit(
      stages,
      r.orderQuantity,
    );
    const requiredSheets = r.orderQuantity * sheetsPerUnit;
    const allocatedElsewhere = allocMap.get(r.id) ?? 0;
    const underrunPercentage = r.underrunPercentage ?? 0;
    const overrunPercentage = r.overrunPercentage ?? 0;
    const pending = pendingSheets(requiredSheets, allocatedElsewhere, {
      absolute,
      relative,
      underrunPercentage,
    });
    const corr =
      r.corrugationId != null ? (corrMap.get(r.corrugationId) ?? null) : null;
    const board: CorrugatorBoard | null = corr
      ? {
          key: computeBoardKey(
            corr.layers,
            corr.theoreticalGrammage,
            corr.code,
          ),
          corrugations: [{ uuid: corr.uuid, code: corr.code }],
          fluteTypes: corr.fluteTypes,
          paperClasses: corr.paperClasses,
          theoreticalGrammage: corr.theoreticalGrammage,
        }
      : null;
    return {
      productionOrderId: r.id,
      productionOrderUuid: r.uuid,
      number: r.number,
      customerUuid: r.customerUuid,
      customerName: r.customerName,
      productUuid: r.productUuid,
      productCode: r.productCode,
      productDescription: r.productDescription,
      deliveryDate: r.deliveryDate,
      sheetLength,
      sheetWidth,
      allowsRotation,
      scoreLineCount,
      orderQuantity: r.orderQuantity,
      corrugationId: r.corrugationId,
      board,
      sheetsPerUnit,
      sheetsSource: source,
      requiredSheets,
      underrunPercentage,
      overrunPercentage,
      allocatedElsewhere,
      pendingSheets: pending,
    };
  });
}

const isPlannable = (c: OrderContext): boolean =>
  (c.sheetLength ?? 0) > 0 &&
  (c.sheetWidth ?? 0) > 0 &&
  c.board !== null &&
  c.pendingSheets > 0;

// ── Pool (card 1, AC-1) ──────────────────────────────────────────────────

export async function getPool(
  companyId: number,
  search?: string,
): Promise<ICorrugatorPool> {
  const rows = await loadEligibleOrders(companyId, { search });
  const contexts = await buildOrderContexts(companyId, rows);
  const inPlansMap = await loadInPlansBatch(
    companyId,
    contexts.map((c) => c.productionOrderId),
  );

  const groups = new Map<string, ICorrugatorPoolGroup>();
  const notPlannable: ICorrugatorNotPlannable[] = [];

  for (const ctx of contexts) {
    const productionOrder = {
      uuid: ctx.productionOrderUuid,
      number: ctx.number,
    };
    const dimsOk = (ctx.sheetLength ?? 0) > 0 && (ctx.sheetWidth ?? 0) > 0;
    if (!dimsOk) {
      notPlannable.push({
        productionOrder,
        reason: "no-sheet-dimensions",
        detail: `El producto ${ctx.productCode} no tiene largo/ancho de plancha`,
      });
      continue;
    }
    if (!ctx.board) {
      notPlannable.push({
        productionOrder,
        reason: "no-corrugation",
        detail: `El producto ${ctx.productCode} no tiene corrugado asociado`,
      });
      continue;
    }
    if (ctx.pendingSheets === 0) {
      const fullyAllocated = ctx.allocatedElsewhere > 0;
      notPlannable.push({
        productionOrder,
        reason: fullyAllocated ? "fully-allocated" : "within-tolerance",
        detail: fullyAllocated
          ? `${ctx.number} ya está completamente asignada a otro programa`
          : `La cantidad pendiente de ${ctx.number} está dentro de la tolerancia de programación`,
      });
      continue;
    }

    const key = ctx.board.key;
    let group = groups.get(key);
    if (!group) {
      group = {
        board: {
          key,
          corrugations: [...ctx.board.corrugations],
          fluteTypes: [...ctx.board.fluteTypes],
          paperClasses: [...ctx.board.paperClasses],
          theoreticalGrammage: ctx.board.theoreticalGrammage,
        },
        orders: [],
      };
      groups.set(key, group);
    } else {
      for (const c of ctx.board.corrugations) {
        if (!group.board.corrugations.some((x) => x.uuid === c.uuid))
          group.board.corrugations.push(c);
      }
      for (const f of ctx.board.fluteTypes) {
        if (!group.board.fluteTypes.includes(f)) group.board.fluteTypes.push(f);
      }
      for (const p of ctx.board.paperClasses) {
        if (!group.board.paperClasses.some((x) => x.code === p.code))
          group.board.paperClasses.push(p);
      }
    }
    group.orders.push({
      productionOrder,
      customer: ctx.customerUuid
        ? { uuid: ctx.customerUuid, name: ctx.customerName ?? "" }
        : null,
      product: {
        uuid: ctx.productUuid,
        code: ctx.productCode,
        description: ctx.productDescription,
      },
      deliveryDate: ctx.deliveryDate,
      sheetLength: ctx.sheetLength!,
      sheetWidth: ctx.sheetWidth!,
      allowsRotation: ctx.allowsRotation,
      orderQuantity: ctx.orderQuantity,
      sheetsPerUnit: ctx.sheetsPerUnit,
      sheetsSource: ctx.sheetsSource,
      requiredSheets: ctx.requiredSheets,
      allocatedSheets: ctx.allocatedElsewhere,
      pendingSheets: ctx.pendingSheets,
      inPlans: inPlansMap.get(ctx.productionOrderId) ?? [],
    });
  }

  return { groups: [...groups.values()], notPlannable };
}

/** `~ GET /production-orders/:uuid` additive corrugator block (D-9). */
export async function getOrderCorrugatorState(
  companyId: number,
  productionOrderId: number,
): Promise<ICorrugatorOrderState | null> {
  const rows = await loadEligibleOrders(companyId, {
    ids: [productionOrderId],
  });
  if (rows.length === 0) return null;
  const [ctx] = await buildOrderContexts(companyId, rows);
  const plans = await loadInPlansBatch(companyId, [productionOrderId]);
  const allocated = ctx.allocatedElsewhere;
  const pending = ctx.pendingSheets;
  const state: ICorrugatorOrderState["state"] =
    allocated > 0 && pending === 0
      ? "programada"
      : allocated > 0
        ? "partial"
        : "none";
  return {
    sheetsPerUnit: ctx.sheetsPerUnit,
    sheetsSource: ctx.sheetsSource,
    requiredSheets: ctx.requiredSheets,
    allocatedSheets: allocated,
    pendingSheets: pending,
    state,
    plans: plans.get(productionOrderId) ?? [],
  };
}

// ── Machines / parameters validation (shared by create + update) ──────────

function normalizeWidths(
  widths: number[] | undefined,
  machineWidth: number,
): number[] {
  const list = widths && widths.length ? widths : [machineWidth];
  return [...new Set(list)].sort((a, b) => b - a);
}

function snapshotFromRow(
  row: any,
  widths: number[],
): CorrugatorMachineSnapshot {
  return {
    machineUuid: row.uuid,
    code: row.code ?? null,
    description: row.description ?? null,
    width: Number(row.width) || 0,
    widths,
    trim: Number(row.trim) || 0,
    maxElements: Number(row.maxElements) || 0,
    tableCount: Number(row.tableCount) || 0,
    formatsPerTable: Number(row.formatsPerTable) || 0,
    ordersPerFormat: Number(row.ordersPerFormat) || 0,
    ordersPerTable: Number(row.ordersPerTable) || 0,
    sheetLengthMin: Number(row.sheetLengthMin) || 0,
    sheetLengthMax: Number(row.sheetLengthMax) || 0,
    maxScoreLines: Number(row.maxScoreLines) || 0,
  };
}

async function validateMachines(
  companyId: number,
  machines: ICorrugatorPlanMachineInput[],
): Promise<
  | { ok: true; value: CorrugatorMachineSnapshot[] }
  | { ok: false; message: string }
> {
  if (!machines?.length)
    return { ok: false, message: "machines must have at least one entry" };
  const snapshots: CorrugatorMachineSnapshot[] = [];
  for (const m of machines) {
    const row = await db("tenant")("machines as m")
      .join("machine_types as mt", "m.machineTypeId", "mt.id")
      .where("m.uuid", m.machineUuid)
      .andWhere("m.companyId", companyId)
      .select("m.*", "mt.corrugated as corrugated")
      .first();
    if (!row)
      return { ok: false, message: `Machine not found: ${m.machineUuid}` };
    if (!row.corrugated)
      return {
        ok: false,
        message: `Machine ${row.code ?? m.machineUuid} is not a corrugator`,
      };
    const width = Number(row.width) || 0;
    if (!(width > 0))
      return {
        ok: false,
        message: `Machine ${row.code ?? m.machineUuid} has no width`,
      };
    const widths = normalizeWidths(m.widths, width);
    if (widths.some((w) => !(w > 0) || w > width)) {
      return {
        ok: false,
        message: `Machine ${row.code ?? m.machineUuid}: format widths must be between 0 and the machine width`,
      };
    }
    snapshots.push(snapshotFromRow(row, widths));
  }
  return { ok: true, value: snapshots };
}

const PARAMETER_KEYS = Object.keys(
  CORRUGATOR_PARAMETER_DEFAULTS,
) as (keyof CorrugatorParameters)[];

function mergeParameters(
  base: CorrugatorParameters,
  partial?: Partial<CorrugatorParameters>,
): { ok: true; value: CorrugatorParameters } | { ok: false; message: string } {
  const merged: CorrugatorParameters = {
    ...base,
    constraints: { ...base.constraints },
  };
  if (!partial) return { ok: true, value: merged };
  for (const key of Object.keys(partial)) {
    if (!PARAMETER_KEYS.includes(key as keyof CorrugatorParameters)) {
      return { ok: false, message: `Unknown parameter: ${key}` };
    }
    const value = (partial as Record<string, unknown>)[key];
    if (key === "constraints") {
      if (typeof value !== "object" || value === null) {
        return { ok: false, message: "constraints must be an object" };
      }
      for (const [flag, flagValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (!(flag in merged.constraints))
          return { ok: false, message: `Unknown constraint: ${flag}` };
        if (typeof flagValue !== "boolean")
          return { ok: false, message: `${flag} must be a boolean` };
        (merged.constraints as unknown as Record<string, boolean>)[flag] =
          flagValue;
      }
      continue;
    }
    const expectsBool =
      typeof (
        CORRUGATOR_PARAMETER_DEFAULTS as unknown as Record<string, unknown>
      )[key] === "boolean";
    if (
      expectsBool
        ? typeof value !== "boolean"
        : typeof value !== "number" || !Number.isFinite(value)
    ) {
      return {
        ok: false,
        message: `${key} must be a ${expectsBool ? "boolean" : "number"}`,
      };
    }
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return { ok: true, value: merged };
}

// ── Engine input assembly ───────────────────────────────────────────────

function buildEngineInput(
  plan: ICorrugatorPlan,
  orders: ICorrugatorPlanOrder[],
): EngineInput {
  const boardGrammage = plan.board?.theoreticalGrammage;
  const grammage =
    boardGrammage && boardGrammage > 0
      ? boardGrammage
      : (plan.parameters!.averageGrammage ?? 0);
  return {
    orders: orders.map((o) => ({
      key: o.uuid!,
      sheetLength: o.sheetLength!,
      sheetWidth: o.sheetWidth!,
      quantity: o.requestedSheets!,
      underrunPercentage: o.underrunPercentage!,
      overrunPercentage: o.overrunPercentage!,
      priority: o.priority!,
      partialProduction: o.partialProduction!,
      allowsRotation: o.allowsRotation!,
      scoreLineCount: o.scoreLineCount!,
    })),
    machines: engineMachines(plan.machines ?? []),
    parameters: plan.parameters!,
    grammage,
  };
}

async function loadEngineCombinations(
  planId: number,
  orders: ICorrugatorPlanOrder[],
  trx?: Knex.Transaction,
): Promise<EngineCombination[]> {
  const combos = await combinationDao.listByPlanId(planId, trx);
  const items = await combinationDao.listItemsByCombinationIds(
    combos.map((c) => c.id!),
    trx,
  );
  const byCombo = new Map<number, ICorrugatorPlanItem[]>();
  for (const it of items) {
    const list = byCombo.get(it.combinationId!) ?? [];
    list.push(it);
    byCombo.set(it.combinationId!, list);
  }
  const uuidById = new Map(orders.map((o) => [o.id!, o.uuid!]));
  return combos.map((c) => ({
    machineKey: c.machineKey!,
    sequence: c.sequence!,
    meters: c.meters!,
    items: (byCombo.get(c.id!) ?? [])
      .sort((a, b) => a.position! - b.position!)
      .map((it) => ({
        orderKey: uuidById.get(it.planOrderId!)!,
        count: it.count!,
        rotated: it.rotated!,
      })),
  }));
}

// ── Plan CRUD ────────────────────────────────────────────────────────────

export async function listPlans(req: import("express").Request) {
  return planDao.getAllWithFilters(req);
}

export async function getPlanDetail(
  companyId: number,
  uuid: string,
): Promise<ICorrugatorPlan | null> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return null;
  const orders = await orderDao.listByPlanId(plan.id!);
  const poRows = orders.length
    ? await db("tenant")("production_orders")
        .whereIn(
          "id",
          orders.map((o) => o.productionOrderId!),
        )
        .select("id", "uuid", "number")
    : [];
  const poById = new Map(
    poRows.map((r: any) => [r.id, { uuid: r.uuid, number: r.number }]),
  );

  const engineCombos = await loadEngineCombinations(plan.id!, orders);
  const figures =
    engineCombos.length > 0
      ? evaluate(buildEngineInput(plan, orders), engineCombos)
      : null;
  const figByOrder = new Map(
    (figures?.perOrder ?? []).map((f) => [f.orderKey, f]),
  );

  const ordersOut: ICorrugatorPlanOrder[] = orders.map((o) => {
    const f = figByOrder.get(o.uuid!);
    return {
      ...o,
      productionOrder: poById.get(o.productionOrderId!),
      lowerBound: f?.lowerBound,
      upperBound: f?.upperBound,
      plannedSheets: f?.plannedSheets,
      fulfillment: f?.fulfillment,
      state: f?.state,
    };
  });

  let combinationsOut: ICorrugatorPlanCombination[] = [];
  let summary = null as ICorrugatorPlan["summary"];
  if (figures && engineCombos.length > 0) {
    const combos = await combinationDao.listByPlanId(plan.id!);
    const items = await combinationDao.listItemsByCombinationIds(
      combos.map((c) => c.id!),
    );
    const itemsByCombo = new Map<number, ICorrugatorPlanItem[]>();
    for (const it of items) {
      const list = itemsByCombo.get(it.combinationId!) ?? [];
      list.push(it);
      itemsByCombo.set(it.combinationId!, list);
    }
    const orderById = new Map(orders.map((o) => [o.id!, o]));
    combinationsOut = combos.map((c, i) => {
      const fig = figures.perCombination[i];
      const itemFigByOrder = new Map(fig.items.map((it) => [it.orderKey, it]));
      const itemsOut: ICorrugatorPlanItem[] = (itemsByCombo.get(c.id!) ?? [])
        .sort((a, b) => a.position! - b.position!)
        .map((it) => {
          const order = orderById.get(it.planOrderId!)!;
          const itemFig = itemFigByOrder.get(order.uuid!);
          return {
            ...it,
            order: {
              uuid: order.uuid!,
              number: order.number!,
              customerName: order.customerName ?? null,
              productCode: order.productCode ?? null,
            },
            runLength: itemFig?.runLength,
            runWidth: itemFig?.runWidth,
            plannedSheets: itemFig?.plannedSheets,
            strokes: itemFig?.strokes,
            linearProduction: itemFig?.linearProduction,
          };
        });
      return {
        ...c,
        width: fig.width,
        trim: fig.trim,
        transversalRefile: fig.transversalRefile,
        refile: fig.refile,
        fullRefile: fig.fullRefile,
        wasteLinear: fig.wasteLinear,
        scrapKg: fig.scrapKg,
        elements: fig.elements,
        tables: fig.tables,
        scoreLines: fig.scoreLines,
        items: itemsOut,
      };
    });
    summary = figures.summary;
  }

  // solveToken is internal-only (I-14 fencing) and must never reach the API;
  // the other four solve* columns fold into `solve` (model.md's ICorrugatorPlan).
  const {
    solveToken: _solveToken,
    solveStatus,
    solveStartedAt,
    solveFinishedAt,
    combinationsGenerated,
    solveLog,
    ...rest
  } = plan;
  return {
    ...rest,
    solve: {
      status: solveStatus ?? null,
      startedAt: solveStartedAt ?? null,
      finishedAt: solveFinishedAt ?? null,
      combinationsGenerated: combinationsGenerated ?? null,
      log: solveLog ?? null,
    },
    orders: ordersOut,
    combinations: combinationsOut,
    summary,
  };
}

export async function createPlan(
  companyId: number,
  createdByUser: string | null,
  body: {
    name?: string | null;
    notes?: string | null;
    productionOrderUuids: string[];
    machines: ICorrugatorPlanMachineInput[];
    parameters?: Partial<CorrugatorParameters>;
  },
): Promise<ServiceResult<ICorrugatorPlan>> {
  if (!body.productionOrderUuids?.length) {
    return {
      ok: false,
      status: 400,
      message: "productionOrderUuids must have at least one entry",
    };
  }

  const idRows = await db("tenant")("production_orders")
    .whereIn("uuid", body.productionOrderUuids)
    .andWhere("companyId", companyId)
    .select("id", "uuid");
  const foundUuids = new Set(idRows.map((r) => r.uuid));
  const missing = body.productionOrderUuids.filter((u) => !foundUuids.has(u));
  if (missing.length) {
    return {
      ok: false,
      status: 400,
      message: `Production order(s) not found: ${missing.join(", ")}`,
    };
  }

  const rows = await loadEligibleOrders(companyId, {
    ids: idRows.map((r) => r.id),
  });
  if (rows.length !== idRows.length) {
    const eligibleIds = new Set(rows.map((r) => r.id));
    const notEligible = idRows.filter((r) => !eligibleIds.has(r.id));
    return {
      ok: false,
      status: 400,
      message: `Order(s) not eligible: ${notEligible.map((r) => r.uuid).join(", ")}`,
      code: "ORDER_NOT_ELIGIBLE",
    };
  }
  const contexts = await buildOrderContexts(companyId, rows);
  const notPlannable = contexts.filter((c) => !isPlannable(c));
  if (notPlannable.length) {
    return {
      ok: false,
      status: 400,
      message: `Order(s) not plannable: ${notPlannable.map((c) => c.number).join(", ")}`,
    };
  }
  const keys = new Set(contexts.map((c) => c.board!.key));
  if (keys.size > 1) {
    return {
      ok: false,
      status: 400,
      message: "Orders span more than one board",
      code: "MIXED_BOARD",
    };
  }

  const machinesResult = await validateMachines(companyId, body.machines);
  if (!machinesResult.ok)
    return { ok: false, status: 400, message: machinesResult.message };

  const parametersResult = mergeParameters(
    CORRUGATOR_PARAMETER_DEFAULTS,
    body.parameters,
  );
  if (!parametersResult.ok)
    return { ok: false, status: 400, message: parametersResult.message };

  const knex = db("tenant");
  const planUuid = await knex.transaction(async (trx) => {
    let number = await planDao.nextNumber(trx, companyId);
    let created: ICorrugatorPlan;
    try {
      created = await planDao.create(
        {
          uuid: uuidv4(),
          companyId,
          number,
          name: body.name ?? null,
          notes: body.notes ?? null,
          status: "draft",
          board: contexts[0].board!,
          machines: machinesResult.value,
          parameters: parametersResult.value,
          createdByUser,
        },
        trx,
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "23505") {
        number = await planDao.nextNumber(trx, companyId);
        created = await planDao.create(
          {
            uuid: uuidv4(),
            companyId,
            number,
            name: body.name ?? null,
            notes: body.notes ?? null,
            status: "draft",
            board: contexts[0].board!,
            machines: machinesResult.value,
            parameters: parametersResult.value,
            createdByUser,
          },
          trx,
        );
      } else {
        throw e;
      }
    }
    const orderRows: ICorrugatorPlanOrder[] = contexts.map((c, i) => ({
      uuid: uuidv4(),
      companyId,
      planId: created.id!,
      productionOrderId: c.productionOrderId,
      position: i,
      number: c.number,
      customerName: c.customerName,
      productCode: c.productCode,
      productDescription: c.productDescription,
      deliveryDate: c.deliveryDate,
      sheetLength: c.sheetLength!,
      sheetWidth: c.sheetWidth!,
      allowsRotation: c.allowsRotation,
      scoreLineCount: c.scoreLineCount,
      orderQuantity: c.orderQuantity,
      sheetsPerUnit: c.sheetsPerUnit,
      sheetsSource: c.sheetsSource,
      requiredSheets: c.requiredSheets,
      pendingSheets: c.pendingSheets,
      requestedSheets: c.pendingSheets,
      underrunPercentage: c.underrunPercentage,
      overrunPercentage: c.overrunPercentage,
      priority: "normal",
      partialProduction: true,
    }));
    await orderDao.insertMany(trx, orderRows);
    return created.uuid!;
  });

  return { ok: true, data: (await getPlanDetail(companyId, planUuid))! };
}

function statusGuard(plan: ICorrugatorPlan): ServiceResult<never> | null {
  if (plan.status === "registered") {
    return {
      ok: false,
      status: 409,
      message: "Plan is registered",
      code: "PLAN_REGISTERED",
    };
  }
  if (plan.status === "solving") {
    return {
      ok: false,
      status: 409,
      message: "Plan is solving",
      code: "PLAN_SOLVING",
    };
  }
  return null;
}

async function invalidateIfNeeded(
  trx: Knex.Transaction,
  plan: ICorrugatorPlan,
): Promise<void> {
  if (plan.status === "solved" || plan.status === "failed") {
    await combinationDao.deleteAllForPlan(trx, plan.id!);
    await trx(TABLE)
      .where("id", plan.id)
      .update({ status: "draft", updatedAt: trx.fn.now() });
  }
}

export async function updatePlan(
  companyId: number,
  uuid: string,
  body: {
    name?: string | null;
    notes?: string | null;
    parameters?: Partial<CorrugatorParameters>;
    machines?: ICorrugatorPlanMachineInput[];
  },
): Promise<ServiceResult<ICorrugatorPlan>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  const guard = statusGuard(plan);
  if (guard) return guard;

  const patch: Partial<ICorrugatorPlan> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.notes !== undefined) patch.notes = body.notes;

  let invalidates = false;
  if (body.parameters !== undefined) {
    const merged = mergeParameters(plan.parameters!, body.parameters);
    if (!merged.ok) return { ok: false, status: 400, message: merged.message };
    patch.parameters = merged.value;
    invalidates = true;
  }
  if (body.machines !== undefined) {
    const machinesResult = await validateMachines(companyId, body.machines);
    if (!machinesResult.ok)
      return { ok: false, status: 400, message: machinesResult.message };
    patch.machines = machinesResult.value;
    invalidates = true;
  }

  await db("tenant").transaction(async (trx) => {
    if (invalidates) await invalidateIfNeeded(trx, plan);
    await planDao.update(plan.id!, patch, trx);
  });

  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

export async function deletePlan(
  companyId: number,
  uuid: string,
): Promise<ServiceResult<null>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  if (plan.status === "registered") {
    return {
      ok: false,
      status: 409,
      message: "Undo the registration first",
      code: "PLAN_REGISTERED",
    };
  }
  await planDao.delete(plan.id!);
  return { ok: true, data: null };
}

// ── Lines (card 1/3) ─────────────────────────────────────────────────────

export async function addOrders(
  companyId: number,
  uuid: string,
  productionOrderUuids: string[],
): Promise<ServiceResult<ICorrugatorPlanOrder[]>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  const guard = statusGuard(plan);
  if (guard) return guard;
  if (!productionOrderUuids?.length) {
    return {
      ok: false,
      status: 400,
      message: "productionOrderUuids must have at least one entry",
    };
  }

  const idRows = await db("tenant")("production_orders")
    .whereIn("uuid", productionOrderUuids)
    .andWhere("companyId", companyId)
    .select("id", "uuid");
  const missing = productionOrderUuids.filter(
    (u) => !idRows.some((r) => r.uuid === u),
  );
  if (missing.length) {
    return {
      ok: false,
      status: 400,
      message: `Production order(s) not found: ${missing.join(", ")}`,
    };
  }
  const existing = await orderDao.listByPlanId(plan.id!);
  const already = idRows.filter((r) =>
    existing.some((e) => e.productionOrderId === r.id),
  );
  if (already.length) {
    return {
      ok: false,
      status: 400,
      message: `Order(s) already in plan: ${already.map((r) => r.uuid).join(", ")}`,
    };
  }

  const rows = await loadEligibleOrders(companyId, {
    ids: idRows.map((r) => r.id),
  });
  if (rows.length !== idRows.length) {
    return {
      ok: false,
      status: 400,
      message: "Order(s) not eligible",
      code: "ORDER_NOT_ELIGIBLE",
    };
  }
  const contexts = await buildOrderContexts(companyId, rows);
  const notPlannable = contexts.filter((c) => !isPlannable(c));
  if (notPlannable.length) {
    return {
      ok: false,
      status: 400,
      message: `Order(s) not plannable: ${notPlannable.map((c) => c.number).join(", ")}`,
    };
  }
  const badBoard = contexts.filter((c) => c.board!.key !== plan.board!.key);
  if (badBoard.length) {
    return {
      ok: false,
      status: 400,
      message: "Order(s) do not match the plan's board",
      code: "MIXED_BOARD",
    };
  }

  const inserted = await db("tenant").transaction(async (trx) => {
    let nextPos = (await orderDao.maxPosition(trx, plan.id!)) + 1;
    const rowsToInsert: ICorrugatorPlanOrder[] = contexts.map((c) => ({
      uuid: uuidv4(),
      companyId,
      planId: plan.id!,
      productionOrderId: c.productionOrderId,
      position: nextPos++,
      number: c.number,
      customerName: c.customerName,
      productCode: c.productCode,
      productDescription: c.productDescription,
      deliveryDate: c.deliveryDate,
      sheetLength: c.sheetLength!,
      sheetWidth: c.sheetWidth!,
      allowsRotation: c.allowsRotation,
      scoreLineCount: c.scoreLineCount,
      orderQuantity: c.orderQuantity,
      sheetsPerUnit: c.sheetsPerUnit,
      sheetsSource: c.sheetsSource,
      requiredSheets: c.requiredSheets,
      pendingSheets: c.pendingSheets,
      requestedSheets: c.pendingSheets,
      underrunPercentage: c.underrunPercentage,
      overrunPercentage: c.overrunPercentage,
      priority: "normal",
      partialProduction: true,
    }));
    const rowsInserted = await orderDao.insertMany(trx, rowsToInsert);
    await invalidateIfNeeded(trx, plan);
    return rowsInserted;
  });

  return { ok: true, data: inserted };
}

export async function updateOrderLine(
  companyId: number,
  uuid: string,
  orderUuid: string,
  body: {
    requestedSheets?: number;
    sheetsPerUnit?: number;
    underrunPercentage?: number;
    overrunPercentage?: number;
    priority?: "normal" | "mandatory" | "optional";
    partialProduction?: boolean;
    allowsRotation?: boolean;
    position?: number;
  },
): Promise<ServiceResult<ICorrugatorPlanOrder>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  const guard = statusGuard(plan);
  if (guard) return guard;

  const result = await db("tenant").transaction(async (trx) => {
    const line = await orderDao.getByUuid(orderUuid, plan.id!, trx);
    if (!line) return null;

    const patch: Partial<ICorrugatorPlanOrder> = {};
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.partialProduction !== undefined)
      patch.partialProduction = body.partialProduction;
    if (body.allowsRotation !== undefined)
      patch.allowsRotation = body.allowsRotation;
    if (body.underrunPercentage !== undefined)
      patch.underrunPercentage = body.underrunPercentage;
    if (body.overrunPercentage !== undefined)
      patch.overrunPercentage = body.overrunPercentage;
    if (body.requestedSheets !== undefined)
      patch.requestedSheets = body.requestedSheets;

    if (body.sheetsPerUnit !== undefined) {
      patch.sheetsPerUnit = body.sheetsPerUnit;
      patch.sheetsSource = "manual";
      const requiredSheets = line.orderQuantity! * body.sheetsPerUnit;
      patch.requiredSheets = requiredSheets;
      const allocatedMap = await loadAllocatedElsewhereBatch(
        [line.productionOrderId!],
        trx,
      );
      const absolute = await appConfig.getNumber(
        companyId,
        "ToleranciaProgramacion",
      );
      const relative = await appConfig.getNumber(
        companyId,
        "ToleranciaRelativaProgramacion",
      );
      const underrun = body.underrunPercentage ?? line.underrunPercentage!;
      const pending = pendingSheets(
        requiredSheets,
        allocatedMap.get(line.productionOrderId!) ?? 0,
        {
          absolute,
          relative,
          underrunPercentage: underrun,
        },
      );
      patch.pendingSheets = pending;
      if (body.requestedSheets === undefined) patch.requestedSheets = pending;
    }
    if (body.position !== undefined) patch.position = body.position;

    const updated = await orderDao.update(trx, line.id!, patch);
    if (body.position !== undefined)
      await orderDao.repackPositions(trx, plan.id!);
    await invalidateIfNeeded(trx, plan);
    return updated;
  });

  if (!result) return { ok: false, status: 404, message: "Line not found" };
  return { ok: true, data: result };
}

export async function deleteOrderLine(
  companyId: number,
  uuid: string,
  orderUuid: string,
): Promise<ServiceResult<null>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  const guard = statusGuard(plan);
  if (guard) return guard;

  const found = await db("tenant").transaction(async (trx) => {
    const line = await orderDao.getByUuid(orderUuid, plan.id!, trx);
    if (!line) return false;
    await orderDao.delete(trx, line.id!);
    await orderDao.repackPositions(trx, plan.id!);
    await invalidateIfNeeded(trx, plan);
    return true;
  });

  if (!found) return { ok: false, status: 404, message: "Line not found" };
  return { ok: true, data: null };
}

// ── Solve (card 2, D-3/C-4) ──────────────────────────────────────────────

export function solverBusy(): boolean {
  const cap = Number(process.env.CORRUGATOR_MAX_CONCURRENT_SOLVES ?? 2);
  return runningSolves() >= cap;
}

async function refreshMachineSnapshots(
  companyId: number,
  machines: CorrugatorMachineSnapshot[],
): Promise<CorrugatorMachineSnapshot[]> {
  const uuids = machines.map((m) => m.machineUuid);
  const rows = await db("tenant")("machines as m")
    .join("machine_types as mt", "m.machineTypeId", "mt.id")
    .whereIn("m.uuid", uuids)
    .andWhere("m.companyId", companyId)
    .select("m.*", "mt.corrugated as corrugated");
  const byUuid = new Map(rows.map((r: any) => [r.uuid, r]));
  return machines.map((snap) => {
    const row = byUuid.get(snap.machineUuid);
    return row ? snapshotFromRow(row, snap.widths) : snap;
  });
}

export async function startSolve(
  companyId: number,
  uuid: string,
): Promise<ServiceResult<ICorrugatorPlan>> {
  if (solverBusy()) {
    return {
      ok: false,
      status: 503,
      message: "The solver is busy, try again shortly",
      code: "SOLVER_BUSY",
    };
  }
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };

  const orders = await orderDao.listByPlanId(plan.id!);
  if (orders.length === 0)
    return { ok: false, status: 400, message: "The plan has no lines" };
  if (!plan.machines || plan.machines.length === 0) {
    return { ok: false, status: 400, message: "The plan has no machines" };
  }
  const boardGrammage = plan.board?.theoreticalGrammage ?? 0;
  const grammage =
    boardGrammage > 0 ? boardGrammage : (plan.parameters!.averageGrammage ?? 0);
  if (!(grammage > 0)) {
    return {
      ok: false,
      status: 400,
      message: "No grammage available for this board",
      code: "NO_GRAMMAGE",
    };
  }

  const refreshedMachines = await refreshMachineSnapshots(
    companyId,
    plan.machines,
  );
  const solveToken = uuidv4();
  const knex = db("tenant");

  const startResult = await knex.transaction(async (trx) => {
    const rows = await trx(TABLE)
      .where({ uuid, companyId })
      .whereIn("status", ["draft", "solved", "failed"])
      .update({
        status: "solving",
        solveToken,
        solveStartedAt: trx.fn.now(),
        solveFinishedAt: null,
        solveStatus: null,
        solveLog: null,
        combinationsGenerated: null,
        machines: JSON.stringify(refreshedMachines),
        updatedAt: trx.fn.now(),
      })
      .returning("*");
    if (rows.length === 0) return null;
    await combinationDao.deleteAllForPlan(trx, plan.id!);
    // Lines are read after the status flip: line edits 409 while solving, so these are the ones solved.
    const solvedOrders = await orderDao.listByPlanId(plan.id!, trx);
    return { plan: planDao.mapToInterface(rows[0]), orders: solvedOrders };
  });

  if (!startResult) {
    const current = await planDao.getByUuid(uuid, companyId);
    if (!current) return { ok: false, status: 404, message: "Plan not found" };
    const code =
      current.status === "registered" ? "PLAN_REGISTERED" : "PLAN_SOLVING";
    return {
      ok: false,
      status: 409,
      message: `Plan is ${current.status}`,
      code,
    };
  }

  const planId = startResult.plan.id!;
  const engineInput = buildEngineInput(
    { ...startResult.plan, machines: refreshedMachines },
    startResult.orders,
  );
  const handle = startSolveEngine(engineInput);
  activeSolves.set(planId, handle);
  void handle.result.then((outcome) => {
    if (activeSolves.get(planId) === handle) activeSolves.delete(planId);
    return completeSolve(companyId, planId, solveToken, outcome);
  });

  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

async function completeSolve(
  companyId: number,
  planId: number,
  solveToken: string,
  outcome: SolveOutcome,
): Promise<void> {
  try {
    await withAuditContext({ ...SOLVE_JOB, companyId }, () =>
      withTenant(companyId, () =>
        db("tenant").transaction(async (trx) => {
          const status =
            outcome.status === "ok" || outcome.status === "time-limit"
              ? "solved"
              : "failed";
          const rows = await trx(TABLE)
            .where({ id: planId, status: "solving", solveToken })
            .update({
              status,
              solveStatus: outcome.status,
              solveFinishedAt: trx.fn.now(),
              solveLog: truncateLog(outcome.log),
              combinationsGenerated: outcome.combinationsGenerated,
              updatedAt: trx.fn.now(),
            })
            .returning("id");
          if (rows.length === 0 || outcome.combinations.length === 0) return;

          const orders = await orderDao.listByPlanId(planId, trx);
          const orderByUuid = new Map(orders.map((o) => [o.uuid!, o]));
          for (const combo of outcome.combinations) {
            const inserted = await combinationDao.insertCombination(trx, {
              uuid: uuidv4(),
              companyId,
              planId,
              machineKey: combo.machineKey,
              sequence: combo.sequence,
              meters: combo.meters,
            });
            const itemRows = combo.items.map((it, i) => {
              const order = orderByUuid.get(it.orderKey);
              if (!order)
                throw new Error(
                  `Unknown order ${it.orderKey} in solve outcome`,
                );
              return {
                uuid: uuidv4(),
                companyId,
                combinationId: inserted.id!,
                planOrderId: order.id!,
                position: i,
                count: it.count,
                rotated: it.rotated,
              };
            });
            await combinationDao.insertItems(trx, itemRows);
          }
        }),
      ),
    );
  } catch (err) {
    console.error(
      `[corrugator] solve completion failed for plan ${planId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function cancelSolve(
  companyId: number,
  uuid: string,
): Promise<ServiceResult<ICorrugatorPlan>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };

  const cancelled = await db("tenant").transaction(async (trx) => {
    const rows = await trx(TABLE)
      .where({ uuid, companyId, status: "solving" })
      .update({
        status: "draft",
        solveStatus: "cancelled",
        solveFinishedAt: trx.fn.now(),
        updatedAt: trx.fn.now(),
      })
      .returning("id");
    return rows.length > 0;
  });
  if (!cancelled)
    return { ok: false, status: 409, message: "Plan is not solving" };

  activeSolves.get(plan.id!)?.cancel();
  activeSolves.delete(plan.id!);
  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

/** I-14 boot sweep: a `solving` plan whose worker never reported back becomes `failed`. */
export async function sweepStaleSolvesForCompany(
  companyId: number,
): Promise<number> {
  const knex = db("tenant");
  const rows = await knex(TABLE)
    .where({ companyId, status: "solving" })
    .select("id", "solveStartedAt", "parameters");
  const now = Date.now();
  let swept = 0;
  for (const r of rows) {
    const timeLimitSeconds =
      r.parameters?.timeLimitSeconds ||
      CORRUGATOR_PARAMETER_DEFAULTS.timeLimitSeconds;
    const staleMs = (2 * timeLimitSeconds + 300) * 1000;
    const startedAt = r.solveStartedAt
      ? new Date(r.solveStartedAt).getTime()
      : 0;
    if (now - startedAt > staleMs) {
      await knex(TABLE).where("id", r.id).update({
        status: "failed",
        solveStatus: "error",
        solveFinishedAt: knex.fn.now(),
        updatedAt: knex.fn.now(),
      });
      swept++;
    }
  }
  return swept;
}

export async function sweepStaleSolves(): Promise<void> {
  const companyIds = await CoreClient.activeCompanyIds();
  for (const companyId of companyIds) {
    try {
      await withTenant(companyId, () => sweepStaleSolvesForCompany(companyId));
    } catch (err) {
      console.error(
        `[corrugator] boot sweep failed for tenant ${companyId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ── Candidates (card 3, D-18) ────────────────────────────────────────────

export async function getCandidates(
  companyId: number,
  uuid: string,
  orderUuid: string,
  machineUuid?: string,
): Promise<ServiceResult<ICorrugatorCandidate[]>> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  if (plan.status !== "solved") {
    return {
      ok: false,
      status: 409,
      message: "Plan is not solved",
      code: "PLAN_DRAFT",
    };
  }
  const orders = await orderDao.listByPlanId(plan.id!);
  if (!orders.some((o) => o.uuid === orderUuid)) {
    return {
      ok: false,
      status: 400,
      message: "orderUuid not found in this plan",
    };
  }
  if (machineUuid) {
    const machineRow = await db("tenant")("machines")
      .where({ uuid: machineUuid, companyId })
      .first();
    if (!machineRow)
      return { ok: false, status: 400, message: "Unknown machine" };
  }

  const input = buildEngineInput(plan, orders);
  const existing = await loadEngineCombinations(plan.id!, orders);
  const deadlineMs =
    Math.min(Math.max(1, plan.parameters!.timeLimitSeconds), 120) * 1000;
  const enumerated = enumerate(input, deadlineMs);

  let candidates = enumerated.candidates.filter((c) =>
    c.items.some((it) => it.orderKey === orderUuid),
  );
  if (machineUuid)
    candidates = candidates.filter((c) =>
      c.machineKey.startsWith(`${machineUuid}:`),
    );

  const withFigures: ICorrugatorCandidate[] = candidates.map((c) => {
    const stub: EngineCombination = { ...c, sequence: 0, meters: 0 };
    const figures = evaluate(input, [stub]).perCombination[0];
    const meters = suggestedMeters(input, existing, c, orderUuid);
    return {
      machineKey: c.machineKey,
      items: c.items.map((it) => ({
        orderUuid: it.orderKey,
        count: it.count,
        rotated: it.rotated,
      })),
      trim: figures.trim,
      transversalRefile: figures.transversalRefile,
      refile: figures.refile,
      fullRefile: figures.fullRefile,
      suggestedMeters: meters,
    };
  });
  withFigures.sort((a, b) => a.refile - b.refile);

  return { ok: true, data: withFigures.slice(0, 50) };
}

// ── Adjust (card 3) ──────────────────────────────────────────────────────

type GateFailure = {
  ok: false;
  status: number;
  message: string;
  code?: string;
};

async function requireSolved(
  companyId: number,
  uuid: string,
): Promise<{ ok: true; plan: ICorrugatorPlan } | GateFailure> {
  const plan = await planDao.getByUuid(uuid, companyId);
  if (!plan) return { ok: false, status: 404, message: "Plan not found" };
  if (plan.status === "registered") {
    return {
      ok: false,
      status: 409,
      message: "Plan is registered",
      code: "PLAN_REGISTERED",
    };
  }
  if (plan.status === "solving") {
    return {
      ok: false,
      status: 409,
      message: "Plan is solving",
      code: "PLAN_SOLVING",
    };
  }
  if (plan.status !== "solved") {
    return {
      ok: false,
      status: 409,
      message: "Plan is not solved",
      code: "PLAN_DRAFT",
    };
  }
  return { ok: true, plan };
}

/** Renumber `sequence` 1.. per physical machine (I-3), reusing the engine's `resequence()`. */
async function renumberCombinations(
  trx: Knex.Transaction,
  planId: number,
): Promise<void> {
  const rows = await combinationDao.listByPlanId(planId, trx);
  const sorted = [...rows].sort((a, b) => {
    const pa = physicalOf(a.machineKey!);
    const pb = physicalOf(b.machineKey!);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.sequence! - b.sequence!;
  });
  const engineCombos: EngineCombination[] = sorted.map((r) => ({
    machineKey: r.machineKey!,
    items: [],
    sequence: r.sequence!,
    meters: r.meters!,
  }));
  const resequenced = resequence(engineCombos);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].sequence !== resequenced[i].sequence) {
      await combinationDao.applySequencing(trx, [
        { id: sorted[i].id!, sequence: resequenced[i].sequence },
      ]);
    }
  }
}

export async function addCombination(
  companyId: number,
  uuid: string,
  body: {
    machineKey: string;
    items: { orderUuid: string; count: number; rotated?: boolean }[];
    meters?: number;
  },
): Promise<ServiceResult<ICorrugatorPlan>> {
  const gate = await requireSolved(companyId, uuid);
  if (!gate.ok) return gate;
  const plan = gate.plan;
  if (!body.items?.length)
    return {
      ok: false,
      status: 400,
      message: "items must have at least one entry",
    };

  const orders = await orderDao.listByPlanId(plan.id!);
  const orderByUuid = new Map(orders.map((o) => [o.uuid!, o]));
  for (const it of body.items) {
    if (!orderByUuid.has(it.orderUuid))
      return {
        ok: false,
        status: 400,
        message: `Unknown order ${it.orderUuid}`,
      };
  }
  const validKeys = new Set(
    engineMachines(plan.machines ?? []).map((m) => m.key),
  );
  if (!validKeys.has(body.machineKey))
    return { ok: false, status: 400, message: "Unknown machine/width" };

  const input = buildEngineInput(plan, orders);
  const candidate: Candidate = {
    machineKey: body.machineKey,
    items: body.items.map((it) => ({
      orderKey: it.orderUuid,
      count: it.count,
      rotated: !!it.rotated,
    })),
  };
  const feasible = checkFeasible(input, candidate);
  if (!feasible.ok) {
    return {
      ok: false,
      status: 400,
      message: `Infeasible combination: ${feasible.rule}`,
      code: feasible.rule,
    };
  }

  await db("tenant").transaction(async (trx) => {
    const nextSeq =
      (await combinationDao.maxSequence(
        trx,
        plan.id!,
        physicalOf(body.machineKey),
      )) + 1;
    const inserted = await combinationDao.insertCombination(trx, {
      uuid: uuidv4(),
      companyId,
      planId: plan.id!,
      machineKey: body.machineKey,
      sequence: nextSeq,
      meters: body.meters ?? 0,
    });
    const itemRows = body.items.map((it, i) => ({
      uuid: uuidv4(),
      companyId,
      combinationId: inserted.id!,
      planOrderId: orderByUuid.get(it.orderUuid)!.id!,
      position: i,
      count: it.count,
      rotated: !!it.rotated,
    }));
    await combinationDao.insertItems(trx, itemRows);
  });

  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

async function moveSequence(
  trx: Knex.Transaction,
  planId: number,
  combo: ICorrugatorPlanCombination,
  targetSequence: number,
): Promise<void> {
  const physical = physicalOf(combo.machineKey!);
  const all = await combinationDao.listByPlanId(planId, trx);
  const group = all
    .filter((c) => physicalOf(c.machineKey!) === physical)
    .sort((a, b) => a.sequence! - b.sequence!);
  const without = group.filter((c) => c.id !== combo.id);
  const idx = Math.max(0, Math.min(without.length, targetSequence - 1));
  without.splice(idx, 0, combo);
  for (let i = 0; i < without.length; i++) {
    if (without[i].sequence !== i + 1) {
      await combinationDao.applySequencing(trx, [
        { id: without[i].id!, sequence: i + 1 },
      ]);
    }
  }
}

export async function updateCombination(
  companyId: number,
  uuid: string,
  cuuid: string,
  body: {
    meters?: number;
    plannedSheets?: { itemUuid: string; value: number };
    sequence?: number;
    machineKey?: string;
  },
): Promise<ServiceResult<ICorrugatorPlan>> {
  const gate = await requireSolved(companyId, uuid);
  if (!gate.ok) return gate;
  const plan = gate.plan;

  const outcome = await db("tenant").transaction(async (trx) => {
    const combo = await combinationDao.getByUuid(cuuid, plan.id!, trx);
    if (!combo)
      return {
        ok: false as const,
        status: 404,
        message: "Combination not found",
      };

    const orders = await orderDao.listByPlanId(plan.id!, trx);
    const input = buildEngineInput(plan, orders);
    const orderUuidById = new Map(orders.map((o) => [o.id!, o.uuid!]));

    if (body.machineKey !== undefined) {
      const validKeys = new Set(
        engineMachines(plan.machines ?? []).map((m) => m.key),
      );
      if (!validKeys.has(body.machineKey))
        return {
          ok: false as const,
          status: 400,
          message: "Unknown machine/width",
        };
      const items = await combinationDao.listItemsByCombinationIds(
        [combo.id!],
        trx,
      );
      const candidate: Candidate = {
        machineKey: body.machineKey,
        items: items.map((it) => ({
          orderKey: orderUuidById.get(it.planOrderId!)!,
          count: it.count!,
          rotated: it.rotated!,
        })),
      };
      const feasible = checkFeasible(input, candidate);
      if (!feasible.ok) {
        return {
          ok: false as const,
          status: 400,
          message: `Infeasible combination: ${feasible.rule}`,
          code: feasible.rule,
        };
      }
      const samePhysical =
        physicalOf(combo.machineKey!) === physicalOf(body.machineKey);
      await combinationDao.updateCombination(trx, combo.id!, {
        machineKey: body.machineKey,
        sequence: samePhysical ? undefined : 1_000_000_000,
      });
      if (!samePhysical) await renumberCombinations(trx, plan.id!);
    } else if (body.sequence !== undefined) {
      await moveSequence(trx, plan.id!, combo, body.sequence);
    } else if (body.plannedSheets !== undefined) {
      const item = await combinationDao.getItemByUuid(
        body.plannedSheets.itemUuid,
        combo.id!,
        trx,
      );
      if (!item)
        return { ok: false as const, status: 400, message: "Unknown item" };
      const items = await combinationDao.listItemsByCombinationIds(
        [combo.id!],
        trx,
      );
      const candidate: Candidate = {
        machineKey: combo.machineKey!,
        items: items.map((it) => ({
          orderKey: orderUuidById.get(it.planOrderId!)!,
          count: it.count!,
          rotated: it.rotated!,
        })),
      };
      const orderUuid = orderUuidById.get(item.planOrderId!)!;
      const meters = metersForPlannedSheets(
        input,
        candidate,
        orderUuid,
        body.plannedSheets.value,
      );
      await combinationDao.updateCombination(trx, combo.id!, { meters });
    } else if (body.meters !== undefined) {
      await combinationDao.updateCombination(trx, combo.id!, {
        meters: body.meters,
      });
    } else {
      return {
        ok: false as const,
        status: 400,
        message: "No recognized field in body",
      };
    }
    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

export async function deleteCombination(
  companyId: number,
  uuid: string,
  cuuid: string,
): Promise<ServiceResult<ICorrugatorPlan>> {
  const gate = await requireSolved(companyId, uuid);
  if (!gate.ok) return gate;
  const plan = gate.plan;

  const found = await db("tenant").transaction(async (trx) => {
    const combo = await combinationDao.getByUuid(cuuid, plan.id!, trx);
    if (!combo) return false;
    await combinationDao.deleteCombination(trx, combo.id!);
    await renumberCombinations(trx, plan.id!);
    return true;
  });
  if (!found)
    return { ok: false, status: 404, message: "Combination not found" };
  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

export async function deleteItem(
  companyId: number,
  uuid: string,
  cuuid: string,
  iuuid: string,
): Promise<ServiceResult<ICorrugatorPlan>> {
  const gate = await requireSolved(companyId, uuid);
  if (!gate.ok) return gate;
  const plan = gate.plan;

  const outcome = await db("tenant").transaction(async (trx) => {
    const combo = await combinationDao.getByUuid(cuuid, plan.id!, trx);
    if (!combo)
      return {
        ok: false as const,
        status: 404,
        message: "Combination not found",
      };
    const item = await combinationDao.getItemByUuid(iuuid, combo.id!, trx);
    if (!item)
      return { ok: false as const, status: 404, message: "Item not found" };
    await combinationDao.deleteItem(trx, item.id!);
    const remaining = await combinationDao.countItems(trx, combo.id!);
    if (remaining === 0) {
      // Editor.cs:59-67 — an emptied combination is removed, not left empty (I-4).
      await combinationDao.deleteCombination(trx, combo.id!);
      await renumberCombinations(trx, plan.id!);
    } else {
      await combinationDao.repackItemPositions(trx, combo.id!);
    }
    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

// ── Register / unregister (card 3, I-11/I-13) ───────────────────────────

export async function register(
  companyId: number,
  uuid: string,
  registeredByUser: string | null,
  force: boolean,
): Promise<ServiceResult<ICorrugatorPlan>> {
  const outcome = await db("tenant").transaction(async (trx) => {
    const planRow = await trx(TABLE)
      .where({ uuid, companyId })
      .forUpdate()
      .first();
    if (!planRow)
      return { ok: false as const, status: 404, message: "Plan not found" };
    if (planRow.status === "registered") {
      return {
        ok: false as const,
        status: 409,
        message: "Plan already registered",
        code: "PLAN_REGISTERED",
      };
    }
    if (planRow.status === "solving") {
      return {
        ok: false as const,
        status: 409,
        message: "Plan is solving",
        code: "PLAN_SOLVING",
      };
    }
    if (planRow.status !== "solved") {
      return {
        ok: false as const,
        status: 409,
        message: "Plan is not solved",
        code: "PLAN_DRAFT",
      };
    }
    const plan = planDao.mapToInterface(planRow);

    const orders = await orderDao.listByPlanId(plan.id!, trx);
    const poIds = orders.map((o) => o.productionOrderId!);
    const poRows = poIds.length
      ? await trx("production_orders")
          .whereIn("id", poIds)
          .forUpdate()
          .select("id", "schedulingApprovedAt", "voidedAt", "completedAt")
      : [];
    const poById = new Map(poRows.map((r: any) => [r.id, r]));

    const notEligible = orders.filter((o) => {
      const po = poById.get(o.productionOrderId!);
      return (
        !po ||
        po.schedulingApprovedAt == null ||
        po.voidedAt != null ||
        po.completedAt != null
      );
    });
    if (notEligible.length) {
      return {
        ok: false as const,
        status: 400,
        message: `Order(s) not eligible: ${notEligible.map((o) => o.number).join(", ")}`,
        code: "ORDER_NOT_ELIGIBLE",
      };
    }

    const engineCombos = await loadEngineCombinations(plan.id!, orders, trx);
    const figures = engineCombos.length
      ? evaluate(buildEngineInput(plan, orders), engineCombos)
      : null;
    const plannedByOrder = new Map(
      (figures?.perOrder ?? []).map((f) => [f.orderKey, f.plannedSheets]),
    );

    const allocatedMap = await loadAllocatedElsewhereBatch(
      poIds,
      trx,
      plan.id!,
    );
    const absolute = await appConfig.getNumber(
      companyId,
      "ToleranciaProgramacion",
    );
    const relative = await appConfig.getNumber(
      companyId,
      "ToleranciaRelativaProgramacion",
    );

    const stale: {
      uuid: string;
      number: string;
      pendingSheets: number;
      pendingNow: number;
    }[] = [];
    const overAllocated: {
      uuid: string;
      number: string;
      planned: number;
      limit: number;
    }[] = [];
    const writes: { id: number; planned: number; pendingNow: number }[] = [];

    for (const o of orders) {
      const allocatedElsewhere = allocatedMap.get(o.productionOrderId!) ?? 0;
      const pendingNow = pendingSheets(o.requiredSheets!, allocatedElsewhere, {
        absolute,
        relative,
        underrunPercentage: o.underrunPercentage!,
      });
      const planned = plannedByOrder.get(o.uuid!) ?? 0;
      const limit = Math.trunc(
        pendingNow * (1 + o.overrunPercentage! / 100) + 0.5,
      );
      if (pendingNow !== o.pendingSheets && !force) {
        stale.push({
          uuid: o.uuid!,
          number: o.number!,
          pendingSheets: o.pendingSheets!,
          pendingNow,
        });
      }
      if (planned > limit && !force) {
        overAllocated.push({
          uuid: o.uuid!,
          number: o.number!,
          planned,
          limit,
        });
      }
      writes.push({ id: o.id!, planned, pendingNow });
    }
    if (stale.length) {
      return {
        ok: false as const,
        status: 409,
        message: "Pending quantities changed since this plan was solved",
        code: "STALE_PENDING",
        details: { orders: stale },
      };
    }
    if (overAllocated.length) {
      return {
        ok: false as const,
        status: 409,
        message: "Some orders would be over-allocated",
        code: "OVER_ALLOCATED",
        details: { orders: overAllocated },
      };
    }

    for (const w of writes) {
      await orderDao.setAllocation(trx, w.id, w.planned, w.pendingNow);
    }
    await trx(TABLE).where("id", plan.id).update({
      status: "registered",
      registeredAt: trx.fn.now(),
      registeredByUser,
      updatedAt: trx.fn.now(),
    });
    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}

export async function unregister(
  companyId: number,
  uuid: string,
): Promise<ServiceResult<ICorrugatorPlan>> {
  const planId = await db("tenant").transaction(async (trx) => {
    const rows = await trx(TABLE)
      .where({ uuid, companyId, status: "registered" })
      .update({
        status: "solved",
        registeredAt: null,
        registeredByUser: null,
        updatedAt: trx.fn.now(),
      })
      .returning("id");
    if (rows.length === 0) return null;
    await trx("corrugator_plan_orders")
      .where("planId", rows[0].id)
      .update({ allocatedSheets: null, updatedAt: trx.fn.now() });
    return rows[0].id as number;
  });
  if (!planId)
    return { ok: false, status: 409, message: "Plan is not registered" };
  return { ok: true, data: (await getPlanDetail(companyId, uuid))! };
}
