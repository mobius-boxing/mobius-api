import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import {
  ApprovalMachine,
  BULK_APPROVAL_MACHINES,
  IPart,
} from "../../interfaces/part/part.interfaces";
import { toNumberOut } from "../../utils/numbers";
import {
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type ParsedQuery,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { applyCompanyUuidScope } from "../../utils/daoScope";
import {
  PartCalculator,
  CascadeField,
  IFluteAdjustments,
} from "../../services/part-calculator/part-calculator.service";

const PART_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
  revision: {
    column: "revision",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
  productId: {
    column: "productId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
  corrugationId: {
    column: "corrugationId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
};

const PART_SORTING: SortConfigs = {
  code: { column: "code" },
  revision: { column: "revision" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
};

const PART_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("parts", {
  filters: PART_FILTERS,
  sorting: PART_SORTING,
  search: { columns: ["code", "description", "clientCode"], operator: "ILIKE" },
  defaultSort: { column: "code", order: "asc" },
});

/** Approval machine → column prefixes (08-approvals.md). */
const MACHINE_COLUMNS: Record<
  ApprovalMachine,
  { approvedAt: string; approvedBy: string; cancelledAt: string; cancelledBy: string }
> = {
  dimensions: {
    approvedAt: "dimensionsApprovalAt",
    approvedBy: "dimensionsApprovalBy",
    cancelledAt: "dimensionsCancelledAt",
    cancelledBy: "dimensionsCancelledBy",
  },
  technical: {
    approvedAt: "technicalApprovalAt",
    approvedBy: "technicalApprovalBy",
    cancelledAt: "technicalCancelledAt",
    cancelledBy: "technicalCancelledBy",
  },
  sketch: {
    approvedAt: "sketchApprovalAt",
    approvedBy: "sketchApprovalBy",
    cancelledAt: "sketchCancelledAt",
    cancelledBy: "sketchCancelledBy",
  },
  part: {
    approvedAt: "partApprovalAt",
    approvedBy: "partApprovalBy",
    cancelledAt: "partCancelledAt",
    cancelledBy: "partCancelledBy",
  },
};

// Bulk machines come from the shared single source (part.interfaces).
const BULK_MACHINES = BULK_APPROVAL_MACHINES;

/** Rows per part_approval_events INSERT (bind-param cap safety margin). */
const EVENT_INSERT_CHUNK = 500;

const SCALAR_COLUMNS = [
  "code",
  "revision",
  "clientCode",
  "description",
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "sheetLength",
  "sheetWidth",
  "additionalSheetLength",
  "preferredWidth",
  "flap",
  "lowerFlap",
  "upperFlap",
  "flapOverlap",
  "corrugationScoreLines",
  "printScoreLines",
  "symmetricScoreLines",
  "colorCount",
  "printSides",
  "inks",
  "labelsPerPallet",
  "labelText",
  "printCode",
  "printDate",
  "printRecyclable",
  "printWarranty",
  "printLogo",
  "printNationalIndustry",
  "printExport",
  "compressionTest",
  "burstTest",
  "cobbTest",
  "ect",
  "grammage",
  "lengthUpperTolerance",
  "lengthLowerTolerance",
  "widthUpperTolerance",
  "widthLowerTolerance",
  "overrunPercentage",
  "underrunPercentage",
  "corrugationOverproduction",
  "allowsRotation",
  "allowsPartialRotation",
  "mandatoryRotation",
  "boxSurface",
  "boxWeight",
  "averageWeight",
  "allowsGluing",
  "claspClosure",
  "associatedQuantity",
  "foodSafetyNumber",
  "blueprintRef",
  "notes",
  "quotingNotes",
  "dataSheetFileUuid",
  "sketchFileUuid",
  "blueprintFileUuid",
  "imageFileUuid",
  "corrugationId",
  "productionRouteId",
  "palletizationId",
  "modelId",
  "flapTypeId",
  "glueTypeId",
  "strappingTypeId",
  "traceTypeId",
  "complementId",
  "registeredAt",
] as const;

export class PartDAO {
  private tableName = "parts";
  private queryConfig = PART_QUERY_CONFIG;
  private calculator = new PartCalculator();

  // ── Code generation ──────────────────────────────────────────────────────
  /**
   * Default rule `{Producto.Codigo}/{n}` (09-code-generation.md) with the
   * decided divergence: n = MAX(existing numeric suffix)+1 rather than
   * Procusto's IndexOf/Count+1 (which duplicates after a middle deletion).
   */
  async generateCode(productId: number, trx?: any): Promise<string> {
    const knex = trx ?? KnexManager.getConnection();
    const product = await knex("products")
      .where("id", productId)
      .select("code")
      .first();
    if (!product) throw new Error("Product not found for code generation");
    const rows = await knex(this.tableName)
      .where("productId", productId)
      .select("code");
    let max = 0;
    // Anchored strict match per 09-code-generation.md — foreign-shaped codes
    // ("BOX/3-old", "BOX/3/2") must NOT advance the counter; parseInt would
    // accept them and miscompute MAX, recreating the duplicate-code bug.
    const escaped = product.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped}/(\\d+)$`);
    for (const row of rows as Array<{ code: string | null }>) {
      const match = row.code ? pattern.exec(row.code) : null;
      if (!match) continue;
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
    return `${product.code}/${max + 1}`;
  }

  // ── Create (transactional; RUTA PROPIA auto-create) ──────────────────────
  /**
   * When no productionRouteId is supplied, auto-creates the private
   * "RUTA PROPIA" (13-production-routes.md: Global=false, name
   * `{description} (RUTA PROPIA)`), inside the same transaction.
   */
  async create(item: IPart & { createdByUsername?: string | null }): Promise<IPart> {
    const knex = KnexManager.getConnection();
    const created = await knex.transaction(async (trx) => {
      let routeId = item.productionRouteId;
      if (!routeId) {
        // 13-production-routes.md edge case 2: prefer the company's default
        // global active route; only fall back to a private RUTA PROPIA when
        // none is configured.
        const defaultRoute = await trx("production_routes")
          .where({
            companyId: item.companyId,
            isDefault: true,
            isGlobal: true,
            active: true,
          })
          .select("id")
          .first();
        if (defaultRoute) {
          routeId = defaultRoute.id;
        } else {
          const [route] = await trx("production_routes")
            .insert({
              uuid: uuidv4(),
              companyId: item.companyId,
              // Empty-prefix parity: Procusto names it from Descripcion only.
              name: `${item.description ?? ""} (RUTA PROPIA)`,
              isGlobal: false,
              active: true,
              isDefault: false,
            })
            .returning("id");
          routeId = (route as any).id ?? route;
        }
      }

      const code = item.code ?? (await this.generateCode(item.productId!, trx));

      const insertData: any = {
        uuid: item.uuid ?? uuidv4(),
        companyId: item.companyId,
        productId: item.productId,
        productionRouteId: routeId,
        code,
        createdBy: item.createdByUsername ?? null,
      };
      for (const key of SCALAR_COLUMNS) {
        if (key === "code" || key === "productionRouteId") continue;
        if ((item as any)[key] !== undefined) insertData[key] = (item as any)[key];
      }

      const [row] = await trx(this.tableName).insert(insertData).returning("*");
      return row;
    });
    return (await this.getByUuid(created.uuid)) ?? (created as IPart);
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`CASE WHEN prod.id IS NOT NULL THEN to_jsonb(prod) END as "product"`),
        knex.raw(`CASE WHEN cust.id IS NOT NULL THEN to_jsonb(cust) END as "productCustomer"`),
        knex.raw(`CASE WHEN corr.id IS NOT NULL THEN to_jsonb(corr) END as "corrugation"`),
        knex.raw(`CASE WHEN route.id IS NOT NULL THEN to_jsonb(route) END as "productionRoute"`),
        knex.raw(`CASE WHEN pall.id IS NOT NULL THEN to_jsonb(pall) END as "palletization"`),
        knex.raw(`CASE WHEN ft.id IS NOT NULL THEN to_jsonb(ft) END as "flapType"`),
        knex.raw(`CASE WHEN gt.id IS NOT NULL THEN to_jsonb(gt) END as "glueType"`),
        knex.raw(`CASE WHEN st.id IS NOT NULL THEN to_jsonb(st) END as "strappingType"`),
        knex.raw(`CASE WHEN tt.id IS NOT NULL THEN to_jsonb(tt) END as "traceType"`),
        knex.raw(`CASE WHEN comp.id IS NOT NULL THEN to_jsonb(comp) END as "complement"`),
      )
      .leftJoin("products as prod", `${this.tableName}.productId`, "prod.id")
      .leftJoin("customers as cust", "prod.customerId", "cust.id")
      .leftJoin("corrugations as corr", `${this.tableName}.corrugationId`, "corr.id")
      .leftJoin("production_routes as route", `${this.tableName}.productionRouteId`, "route.id")
      .leftJoin("palletizations as pall", `${this.tableName}.palletizationId`, "pall.id")
      .leftJoin("flap_types as ft", `${this.tableName}.flapTypeId`, "ft.id")
      .leftJoin("glue_types as gt", `${this.tableName}.glueTypeId`, "gt.id")
      .leftJoin("strapping_types as st", `${this.tableName}.strappingTypeId`, "st.id")
      .leftJoin("trace_types as tt", `${this.tableName}.traceTypeId`, "tt.id")
      .leftJoin("complements as comp", `${this.tableName}.complementId`, "comp.id");
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IPart | null> {
    const knex = KnexManager.getConnection();
    const query = this.selectWithJoins(knex).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(id: number, item: Partial<IPart>): Promise<IPart | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};
    for (const key of SCALAR_COLUMNS) {
      if ((item as any)[key] !== undefined) updateData[key] = (item as any)[key];
    }
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? await this.getByUuid(row.uuid) : null;
  }

  /**
   * Delete a part; if it owned a private (non-global) RUTA PROPIA that no
   * other part references, the route goes with it.
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    return knex.transaction(async (trx) => {
      const part = await trx(this.tableName)
        .where("id", id)
        .select("productionRouteId")
        .first();
      if (!part) return false;
      const deleted = await trx(this.tableName).where("id", id).delete();
      if (deleted > 0 && part.productionRouteId) {
        // forUpdate: concurrent deletes of parts sharing a private route
        // serialize here, so the second deleter sees the first's committed
        // part removal and the stillUsed check can't race to a leaked route.
        const route = await trx("production_routes")
          .where("id", part.productionRouteId)
          .select("id", "isGlobal")
          .forUpdate()
          .first();
        if (route && route.isGlobal === false) {
          const stillUsed = await trx(this.tableName)
            .where("productionRouteId", route.id)
            .first();
          if (!stillUsed) {
            await trx("production_routes").where("id", route.id).delete();
          }
        }
      }
      return deleted > 0;
    });
  }

  // ── Approvals (08-approvals.md pair semantics + event log) ───────────────
  async setApproval(
    id: number,
    machine: ApprovalMachine,
    action: "approve" | "cancel",
    username: string,
  ): Promise<IPart | null> {
    const knex = KnexManager.getConnection();
    const cols = MACHINE_COLUMNS[machine];
    const updateData: any = { updatedAt: knex.fn.now() };
    if (action === "approve") {
      updateData[cols.approvedAt] = knex.fn.now();
      updateData[cols.approvedBy] = username;
      updateData[cols.cancelledAt] = null;
      updateData[cols.cancelledBy] = null;
    } else {
      updateData[cols.cancelledAt] = knex.fn.now();
      updateData[cols.cancelledBy] = username;
      updateData[cols.approvedAt] = null;
      updateData[cols.approvedBy] = null;
    }
    const [row] = await knex.transaction(async (trx) => {
      const updated = await trx(this.tableName)
        .where("id", id)
        .update(updateData)
        .returning("*");
      await trx("part_approval_events").insert({
        partId: id,
        stateMachine: machine,
        action,
        performedBy: username,
      });
      return updated;
    });
    return row ? await this.getByUuid(row.uuid) : null;
  }

  /**
   * Bulk approve — 3 machines, never sketch; BYPASSES pair semantics (does
   * not clear Cancelacion) exactly like Procusto's Listar.Aprobar.
   */
  async bulkApprove(ids: number[], username: string): Promise<number> {
    if (!ids.length) return 0;
    const knex = KnexManager.getConnection();
    return knex.transaction(async (trx) => {
      const updateData: any = { updatedAt: trx.fn.now() };
      for (const machine of BULK_MACHINES) {
        const cols = MACHINE_COLUMNS[machine];
        updateData[cols.approvedAt] = trx.fn.now();
        updateData[cols.approvedBy] = username;
      }
      const count = await trx(this.tableName).whereIn("id", ids).update(updateData);
      // Chunked like every other event fan-out — a large bulk selection must
      // not blow the bind-parameter cap in one insert.
      await this.insertEventsChunked(
        trx,
        ids.flatMap((partId) =>
          BULK_MACHINES.map((machine) => ({
            partId,
            stateMachine: machine,
            action: "approve",
            performedBy: username,
          })),
        ),
      );
      return count;
    });
  }

  /** Bulk unapprove — nulls approvals leaving PENDING, not CANCELLED (quirk kept). */
  async bulkUnapprove(ids: number[], username: string): Promise<number> {
    if (!ids.length) return 0;
    const knex = KnexManager.getConnection();
    return knex.transaction(async (trx) => {
      const updateData: any = { updatedAt: trx.fn.now() };
      for (const machine of BULK_MACHINES) {
        const cols = MACHINE_COLUMNS[machine];
        updateData[cols.approvedAt] = null;
        updateData[cols.approvedBy] = "";
      }
      const count = await trx(this.tableName).whereIn("id", ids).update(updateData);
      // 'unapprove', not 'cancel': the resulting state is PENDING (approvals
      // nulled, cancellations untouched) — logging 'cancel' would over-count
      // cancellations in history reconstruction.
      await this.insertEventsChunked(
        trx,
        ids.flatMap((partId) =>
          BULK_MACHINES.map((machine) => ({
            partId,
            stateMachine: machine,
            action: "unapprove",
            performedBy: username,
          })),
        ),
      );
      return count;
    });
  }

  /** part_approval_events inserts chunked to stay far below the bind-param cap. */
  private async insertEventsChunked(trx: any, rows: any[]): Promise<void> {
    for (let i = 0; i < rows.length; i += EVENT_INSERT_CHUNK) {
      await trx("part_approval_events").insert(rows.slice(i, i + EVENT_INSERT_CHUNK));
    }
  }

  /**
   * Product-approval cascade core (module 06 §04) — runs inside the CALLER's
   * transaction. Approve targets currently-UNAPPROVED parts; cancel targets
   * currently-APPROVED parts (a PENDING part must never be driven to
   * CANCELLED). Full pair semantics per part + chunked event rows.
   * Returns the affected part ids.
   */
  async cascadeApprovalTrx(
    trx: any,
    productId: number,
    action: "approve" | "cancel",
    username: string,
  ): Promise<number[]> {
    const cols = MACHINE_COLUMNS.part;
    const targets = await trx(this.tableName)
      .where("productId", productId)
      .modify((q: any) =>
        action === "approve"
          ? q.whereNull(cols.approvedAt)
          : q.whereNotNull(cols.approvedAt),
      )
      .select("id");
    const ids = targets.map((t: any) => t.id);
    if (!ids.length) return ids;

    const updateData: any = { updatedAt: trx.fn.now() };
    if (action === "approve") {
      updateData[cols.approvedAt] = trx.fn.now();
      updateData[cols.approvedBy] = username;
      updateData[cols.cancelledAt] = null;
      updateData[cols.cancelledBy] = null;
    } else {
      updateData[cols.cancelledAt] = trx.fn.now();
      updateData[cols.cancelledBy] = username;
      updateData[cols.approvedAt] = null;
      updateData[cols.approvedBy] = null;
    }
    await trx(this.tableName).whereIn("id", ids).update(updateData);
    await this.insertEventsChunked(
      trx,
      ids.map((partId: number) => ({
        partId,
        stateMachine: "part",
        action,
        performedBy: username,
      })),
    );
    return ids;
  }

  // ── Cascade (06-cascade-and-dimensions.md, Modelo-less paths) ────────────
  async cascade(
    id: number,
    field: CascadeField,
    value: number | null,
  ): Promise<IPart | null> {
    const knex = KnexManager.getConnection();
    // Transaction + row lock: two concurrent cascades on the same part must
    // serialize, or each computes from the pre-other-write state and the
    // second silently clobbers the first's cascaded values.
    const updated = await knex.transaction(async (trx) => {
      const row = await trx(this.tableName).where("id", id).forUpdate().first();
      if (!row) return null;

      // The corrugation's FIRST flute (lowest-position layer with a flute type).
      // QA-VERIFY: Procusto reads TiposDeOnda().First() — collection order
      // assumed to be layer position; see review finding on multi-wall boards.
      const flute = await trx("corrugation_layers as cl")
        .join("flute_types as ft", "cl.fluteTypeId", "ft.id")
        .where("cl.corrugationId", row.corrugationId)
        .whereNotNull("cl.fluteTypeId")
        .orderBy("cl.position", "asc")
        .select("ft.length", "ft.width", "ft.height")
        .first();
      const corrugation = await trx("corrugations")
        .where("id", row.corrugationId)
        .select("theoreticalGrammage")
        .first();

      const adjustments: IFluteAdjustments | null = flute
        ? {
            length: flute.length != null ? parseFloat(flute.length) : null,
            width: flute.width != null ? parseFloat(flute.width) : null,
            height: flute.height != null ? parseFloat(flute.height) : null,
          }
        : null;

      const part = this.calculator.applyEdit(
        { ...row },
        field,
        value,
        adjustments,
        corrugation?.theoreticalGrammage != null
          ? parseFloat(corrugation.theoreticalGrammage)
          : null,
      );

      const changed: any = { updatedAt: trx.fn.now() };
      for (const key of [
        "boxLength",
        "boxWidth",
        "boxHeight",
        "externalLength",
        "externalWidth",
        "externalHeight",
        "boxSurface",
        "boxWeight",
        "grammage",
      ] as const) {
        if ((part as any)[key] !== row[key]) changed[key] = (part as any)[key];
      }
      const [result] = await trx(this.tableName)
        .where("id", id)
        .update(changed)
        .returning("*");
      return result ?? null;
    });
    return updated ? await this.getByUuid(updated.uuid) : null;
  }

  // ── List ─────────────────────────────────────────────────────────────────
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPart>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const productUuid = parsedQuery.filters.productUuid as string | undefined;
    delete parsedQuery.filters.productUuid;
    if (productUuid) {
      const product = await knex("products")
        .where("uuid", productUuid)
        .select("id")
        .first();
      parsedQuery.filters.productId = String(product?.id ?? -1);
    }

    // approvalState filter on the FINAL (part) machine: pending|approved|cancelled
    const approvalState = parsedQuery.filters.approvalState as string | undefined;
    delete parsedQuery.filters.approvalState;

    const customerUuid = parsedQuery.filters.customerUuid as string | undefined;
    delete parsedQuery.filters.customerUuid;

    const applyExtra = (q: any) => {
      if (approvalState === "approved") q.whereNotNull(`${this.tableName}.partApprovalAt`);
      else if (approvalState === "cancelled") q.whereNotNull(`${this.tableName}.partCancelledAt`);
      else if (approvalState === "pending")
        q.whereNull(`${this.tableName}.partApprovalAt`).whereNull(
          `${this.tableName}.partCancelledAt`,
        );
      if (customerUuid) {
        q.whereIn(
          `${this.tableName}.productId`,
          knex("products")
            .join("customers", "products.customerId", "customers.id")
            .where("customers.uuid", customerUuid)
            .select("products.id"),
        );
      }
      if (companyUuid) {
        q.join("companies", `${this.tableName}.companyId`, "companies.id").where(
          "companies.uuid",
          companyUuid,
        );
      }
      return q;
    };

    const dataQuery = applyExtra(this.selectWithJoins(knex));
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = applyExtra(knex(this.tableName));
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  // ── Mapping ──────────────────────────────────────────────────────────────
  // SECURITY: uuid-only surface; numeric ids stripped from nested objects.
  private mapToInterface(record: any): IPart {
    const num = toNumberOut;
    const pick = (obj: any, fields: string[]) => {
      if (!obj) return null;
      const out: any = { uuid: obj.uuid };
      for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
      return out;
    };

    const product = pick(record.product, ["code", "description"]);
    if (product && record.productCustomer) {
      product.customer = pick(record.productCustomer, ["name"]);
    }

    const part: IPart = { uuid: record.uuid, companyId: record.companyId };
    // FK id columns stay internal — the response surface is uuid-only via the
    // nested objects below (matches every other Sprint-2 DAO).
    const FK_ID_COLUMNS = new Set([
      "corrugationId",
      "productionRouteId",
      "palletizationId",
      "modelId",
      "flapTypeId",
      "glueTypeId",
      "strappingTypeId",
      "traceTypeId",
      "complementId",
    ]);
    for (const key of SCALAR_COLUMNS) {
      if (FK_ID_COLUMNS.has(key)) continue;
      (part as any)[key] = record[key];
    }
    // Transients (01-entity.md computed properties)
    part.effectiveGrammage =
      num(record.grammage) ?? num(record.corrugation?.theoreticalGrammage) ?? null;
    part.sheetSurface =
      record.sheetLength != null && record.sheetWidth != null
        ? (parseFloat(record.sheetLength) * parseFloat(record.sheetWidth)) / 1_000_000
        : null;
    part.longDescription = [
      record.code,
      record.revision > 0 ? `Rev. ${record.revision}` : null,
      record.description,
    ]
      .filter(Boolean)
      .join(" - ");

    for (const machine of Object.keys(MACHINE_COLUMNS) as ApprovalMachine[]) {
      const cols = MACHINE_COLUMNS[machine];
      (part as any)[cols.approvedAt] = record[cols.approvedAt];
      (part as any)[cols.approvedBy] = record[cols.approvedBy];
      (part as any)[cols.cancelledAt] = record[cols.cancelledAt];
      (part as any)[cols.cancelledBy] = record[cols.cancelledBy];
    }

    part.code = record.code;
    part.revision = record.revision;
    part.createdAt = record.createdAt;
    part.createdBy = record.createdBy;
    part.updatedAt = record.updatedAt;
    part.legacyId = record.legacyId;
    part.product = product;
    part.corrugation = pick(record.corrugation, ["code", "theoreticalGrammage"]);
    part.productionRoute = pick(record.productionRoute, ["name", "isGlobal"]);
    part.palletization = pick(record.palletization, ["code", "name"]);
    part.flapType = pick(record.flapType, ["code"]);
    part.glueType = pick(record.glueType, ["code"]);
    part.strappingType = pick(record.strappingType, ["code"]);
    part.traceType = pick(record.traceType, ["code"]);
    part.complement = pick(record.complement, ["code"]);
    return part;
  }
}
