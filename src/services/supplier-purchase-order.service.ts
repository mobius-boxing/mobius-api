/**
 * Terminadora supplier purchase orders (docs/dev/terminadora-order-flow/model.md).
 *
 * The pool predicate is D-28's own — a production order that is not voided,
 * not completed and not on a line of a sent/completed PO; the corrugator pool
 * (`schedulingApprovedAt`) is untouched. Only `buildOrderContexts` is borrowed
 * from the corrugator service, for sheet length/width/board and sheets per unit.
 */
import { Request } from "express";
import type { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { IDataPaginator } from "../database/d.types";
import {
  buildOrderContexts,
  type OrderContext,
  type RawOrderRow,
} from "./corrugator/plan.service";
import {
  LineView,
  SupplierOrderRow,
  SupplierPurchaseOrderDAO,
} from "../dao/supplier-purchase-order/supplier-purchase-order.dao";
import { SupplierReceiptDAO } from "../dao/supplier-receipt/supplier-receipt.dao";
import { ProductStockDAO } from "../dao/product-stock/product-stock.dao";
import { rejectUnknownListParams } from "../dao/quotation/quotation.dao";
import {
  ISupplierMachineRef,
  ISupplierPoolRow,
  ISupplierPurchaseOrder,
  ISupplierPurchaseOrderLine,
  ISupplierReceipt,
  SUPPLIER_POOL_STATUSES,
  SupplierPoolNotReady,
} from "../interfaces/supplier-purchase-order/supplier-purchase-order.interfaces";
import {
  IPurchaseOrderLineInput,
  SupplierPurchaseOrderCreateInputDTO,
  SupplierPurchaseOrderUpdateInputDTO,
  SupplierReceiptCreateInputDTO,
} from "../dto/input/supplier-purchase-order";
import { parseQueryParams } from "../utils/queryBuilder";
import { assertUuidParam, parseEnumParam } from "../utils/query-params";

export type ServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      message: string;
      code?: string;
      details?: unknown;
    };

const fail = (
  status: number,
  message: string,
  code?: string,
  details?: unknown,
): {
  ok: false;
  status: number;
  message: string;
  code?: string;
  details?: unknown;
} => ({
  ok: false,
  status,
  message,
  ...(code ? { code } : {}),
  ...(details !== undefined ? { details } : {}),
});

const dao = new SupplierPurchaseOrderDAO();
const receipts = new SupplierReceiptDAO();
const productStock = new ProductStockDAO();

const POOL_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "status",
  "supplierUuid",
  "companyId",
] as const;
const POOL_SORT_KEYS = [
  "number",
  "deliveryDate",
  "customerName",
  "productCode",
] as const;

const natural = (a: string | null, b: string | null): number =>
  (a ?? "").localeCompare(b ?? "", undefined, {
    numeric: true,
    sensitivity: "base",
  });

// ── Eligible production orders (D-28) ────────────────────────────────────

const boardCodeOf = (ctx: OrderContext): string | null =>
  ctx.board?.corrugations[0]?.code ?? null;

const scoreLinesOf = (row: RawOrderRow): string | null => {
  const raw = row.corrugationScoreLines;
  return raw != null && raw.trim() !== "" ? raw : null;
};

function notReadyOf(ctx: OrderContext): SupplierPoolNotReady | null {
  if (!((ctx.sheetLength ?? 0) > 0 && (ctx.sheetWidth ?? 0) > 0)) {
    return "no-sheet-dimensions";
  }
  return ctx.board === null ? "no-corrugation" : null;
}

/** D-25: the supplier is asked for whole sheets. */
const defaultQuantityOf = (ctx: OrderContext): number =>
  Math.max(1, Math.ceil(ctx.requiredSheets));

// ── Pool ────────────────────────────────────────────────────────────────

export async function getPool(
  req: Request,
  companyId: number,
): Promise<IDataPaginator<ISupplierPoolRow>> {
  rejectUnknownListParams(req, POOL_PARAMS, POOL_SORT_KEYS);
  const query = parseQueryParams(req);
  const status = parseEnumParam(
    "status",
    query.filters.status,
    SUPPLIER_POOL_STATUSES,
  );
  const supplierUuid = assertUuidParam(
    "supplierUuid",
    query.filters.supplierUuid,
  );

  const rows = await dao.loadOrderRows(companyId, {
    search: query.search?.trim() || undefined,
    excludeOnSentPo: true,
  });
  const routeIds = [
    ...new Set(
      rows
        .map((r) => r.routeId ?? r.productionRouteId)
        .filter((x): x is number => x != null),
    ),
  ];
  const [machinesByRoute, assignments] = await Promise.all([
    dao.loadSupplierMachinesByRoute(routeIds),
    dao.getAssignments(
      rows.map((r) => r.id),
      companyId,
    ),
  ]);

  const entries = rows.map((row) => {
    const routeId = row.routeId ?? row.productionRouteId;
    const candidates =
      (routeId != null ? machinesByRoute.get(routeId) : null) ?? [];
    const assignment = assignments.get(row.id);
    const draft = assignment?.poStatus === "draft" ? assignment : null;
    return { row, candidates, draft };
  });

  const filtered = entries.filter(({ candidates, draft }) => {
    if (status === "unassigned" && draft) return false;
    if (status === "in-draft" && !draft) return false;
    if (supplierUuid) {
      return draft
        ? draft.supplier.uuid === supplierUuid
        : candidates.some((c) => c.supplier.uuid === supplierUuid);
    }
    return true;
  });

  const dir = query.sortOrder === "desc" ? -1 : 1;
  const sortKey = query.sortBy ?? "number";
  const keyOf = ({ row }: (typeof entries)[number]): string | null => {
    switch (sortKey) {
      case "deliveryDate":
        return row.deliveryDate
          ? new Date(row.deliveryDate).toISOString()
          : null;
      case "customerName":
        return row.customerName;
      case "productCode":
        return row.productCode;
      default:
        return row.number;
    }
  };
  filtered.sort(
    (a, b) =>
      dir * natural(keyOf(a), keyOf(b)) || natural(a.row.number, b.row.number),
  );

  const totalCount = filtered.length;
  const start = (query.page - 1) * query.limit;
  const pageEntries = filtered.slice(start, start + query.limit);
  const contexts = new Map(
    (
      await buildOrderContexts(
        companyId,
        pageEntries.map((e) => e.row),
      )
    ).map((c) => [c.productionOrderId, c]),
  );

  const data = pageEntries.map(
    ({ row, candidates, draft }): ISupplierPoolRow => {
      const ctx = contexts.get(row.id)!;
      return {
        productionOrder: { uuid: row.uuid, number: row.number },
        customer: row.customerUuid
          ? { uuid: row.customerUuid, name: row.customerName ?? "" }
          : null,
        product: {
          uuid: row.productUuid,
          code: row.productCode,
          description: row.productDescription,
        },
        orderQuantity: row.orderQuantity,
        requiredSheets: ctx.requiredSheets,
        deliveryDate: row.deliveryDate,
        boardCode: boardCodeOf(ctx),
        sheetLength: ctx.sheetLength,
        sheetWidth: ctx.sheetWidth,
        scoreLines: scoreLinesOf(row),
        status: draft ? "in-draft" : "unassigned",
        purchaseOrder: draft
          ? {
              uuid: draft.poUuid,
              number: draft.poNumber,
              supplier: draft.supplier,
            }
          : null,
        suggestedMachine: candidates[0] ?? null,
        candidateMachines: candidates,
        notReady: notReadyOf(ctx),
      };
    },
  );

  return {
    success: true,
    data,
    page: query.page,
    limit: query.limit,
    count: data.length,
    totalCount,
    totalPages: Math.ceil(totalCount / query.limit),
  };
}

// ── Reads ────────────────────────────────────────────────────────────────

/** Drafts show live values in the snapshot fields (D-14). */
async function overlayLive(
  companyId: number,
  views: LineView[],
): Promise<void> {
  if (views.length === 0) return;
  const rows = await dao.loadOrderRows(companyId, {
    ids: views.map((v) => v.productionOrderId),
    onlyEligible: false,
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const contexts = new Map(
    (await buildOrderContexts(companyId, rows)).map((c) => [
      c.productionOrderId,
      c,
    ]),
  );
  for (const { line, productionOrderId } of views) {
    const row = rowById.get(productionOrderId);
    const ctx = contexts.get(productionOrderId);
    if (!row || !ctx) continue;
    line.orderNumber = row.number;
    line.boardCode = boardCodeOf(ctx);
    line.sheetLength = ctx.sheetLength;
    line.sheetWidth = ctx.sheetWidth;
    line.scoreLines = scoreLinesOf(row);
  }
}

export async function getDetail(
  companyId: number,
  uuid: string,
): Promise<ISupplierPurchaseOrder | null> {
  const header = await dao.getHeaderByUuid(uuid, companyId);
  if (!header) return null;
  const poRow = await dao.getRowByUuid(uuid, companyId);
  const views = await dao.getLinesOf(poRow!.id);
  if (header.status === "draft") await overlayLive(companyId, views);
  const byLine = await receipts.listByLineIds(views.map((v) => v.lineId));
  header.lines = views.map(({ line, lineId }) => ({
    ...line,
    receipts: byLine.get(lineId) ?? [],
  }));
  return header;
}

export const listPurchaseOrders = (req: Request, companyId: number) =>
  dao.getAllWithFilters(req, companyId);

export const listLines = (req: Request, companyId: number) =>
  dao.listLines(req, companyId);

// ── Draft lifecycle ──────────────────────────────────────────────────────

const orderNumbers = (rows: { number: string }[]): string =>
  rows.map((r) => r.number).join(", ");

/**
 * Resolves the requested production orders inside the company and enforces
 * eligibility (400) and exclusivity (409, I-7). `allowedPoId` lets a draft keep
 * the orders it already holds when its line set is replaced.
 */
async function resolveOrders(
  companyId: number,
  uuids: string[],
  allowedPoId: number | null,
): Promise<
  ServiceResult<{
    rows: SupplierOrderRow[];
    contexts: Map<number, OrderContext>;
  }>
> {
  if (new Set(uuids).size !== uuids.length) {
    return fail(
      400,
      "A production order appears more than once",
      "ORDER_NOT_ELIGIBLE",
    );
  }
  const found = await dao.getOrdersByUuids(uuids, companyId);
  const foundUuids = new Set(found.map((r: any) => r.uuid));
  const missing = uuids.filter((u) => !foundUuids.has(u));
  if (missing.length) {
    return fail(404, `Production order not found: ${missing.join(", ")}`);
  }

  const rows = await dao.loadOrderRows(companyId, {
    ids: found.map((r: any) => r.id),
  });
  const eligible = new Set(rows.map((r) => r.id));
  const ineligible = found.filter((r: any) => !eligible.has(r.id));
  if (ineligible.length) {
    return fail(
      400,
      `Production order(s) not eligible: ${orderNumbers(ineligible)}`,
      "ORDER_NOT_ELIGIBLE",
    );
  }

  const assignments = await dao.getAssignments(
    found.map((r: any) => r.id),
    companyId,
  );
  const taken: string[] = [];
  for (const r of found) {
    const a = assignments.get(r.id);
    if (!a || (allowedPoId !== null && a.poId === allowedPoId)) continue;
    taken.push(`${r.number} (PO ${a.poNumber})`);
  }
  if (taken.length) {
    return fail(
      409,
      `Production order(s) already on a purchase order: ${taken.join(", ")}`,
      "ORDER_ALREADY_ASSIGNED",
    );
  }

  const contexts = new Map(
    (await buildOrderContexts(companyId, rows)).map((c) => [
      c.productionOrderId,
      c,
    ]),
  );
  return { ok: true, data: { rows, contexts } };
}

const isUniqueViolation = (e: unknown): boolean =>
  (e as { code?: string })?.code === "23505";

export async function createPurchaseOrder(
  companyId: number,
  username: string | null,
  dto: SupplierPurchaseOrderCreateInputDTO,
): Promise<ServiceResult<ISupplierPurchaseOrder>> {
  const machine = await dao.getSupplierMachine(dto.machineUuid, companyId);
  if (!machine) return fail(404, "Machine not found");
  if (!machine.isSupplier) {
    return fail(
      400,
      "The machine is not of a supplier type",
      "MACHINE_NOT_SUPPLIER",
    );
  }
  if (machine.supplierId == null) {
    return fail(
      400,
      "The machine is not mapped to a supplier",
      "MACHINE_WITHOUT_SUPPLIER",
    );
  }

  const supplierId = machine.supplierId;

  const orders = await resolveOrders(companyId, dto.productionOrderUuids, null);
  if (!orders.ok) return orders;
  const rowByUuid = new Map(orders.data.rows.map((r) => [r.uuid, r]));

  const uuid = uuidv4();
  const number = await dao.nextNumber(companyId);
  try {
    await dao.transaction(async (trx) => {
      const poId = await dao.insertHeaderTrx(trx, {
        uuid,
        companyId,
        number,
        machineId: machine.id,
        supplierId,
        notes: dto.notes ?? null,
        createdByUser: username,
      });
      await dao.insertLinesTrx(
        trx,
        dto.productionOrderUuids.map((orderUuid, i) => {
          const row = rowByUuid.get(orderUuid)!;
          return {
            uuid: uuidv4(),
            companyId,
            purchaseOrderId: poId,
            productionOrderId: row.id,
            position: i + 1,
            quantity: defaultQuantityOf(orders.data.contexts.get(row.id)!),
            deliveryDate: row.orderDate,
          };
        }),
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return fail(
        409,
        "A production order is already on a purchase order",
        "ORDER_ALREADY_ASSIGNED",
      );
    }
    throw e;
  }
  return { ok: true, data: (await getDetail(companyId, uuid))! };
}

export async function updatePurchaseOrder(
  companyId: number,
  uuid: string,
  dto: SupplierPurchaseOrderUpdateInputDTO,
): Promise<ServiceResult<ISupplierPurchaseOrder>> {
  const po = await dao.getRowByUuid(uuid, companyId);
  if (!po) return fail(404, "Purchase order not found");
  if (po.status !== "draft") {
    return fail(
      409,
      "Only a draft purchase order can be edited",
      "PURCHASE_ORDER_NOT_DRAFT",
    );
  }
  if (dto.lines !== undefined && dto.lines.length === 0) {
    return fail(400, "A purchase order needs at least one line", "LINES_EMPTY");
  }

  let lineRows: {
    line: IPurchaseOrderLineInput;
    row: SupplierOrderRow;
    ctx: OrderContext;
  }[] = [];
  if (dto.lines) {
    const orders = await resolveOrders(
      companyId,
      dto.lines.map((l) => l.productionOrderUuid),
      po.id,
    );
    if (!orders.ok) return orders;
    const rowByUuid = new Map(orders.data.rows.map((r) => [r.uuid, r]));
    lineRows = dto.lines.map((line) => {
      const row = rowByUuid.get(line.productionOrderUuid)!;
      return { line, row, ctx: orders.data.contexts.get(row.id)! };
    });
  }

  try {
    await dao.transaction(async (trx) => {
      if (dto.notes !== undefined)
        await dao.updateHeaderTrx(trx, po.id, { notes: dto.notes });
      if (dto.lines) {
        await dao.deleteLinesTrx(trx, po.id);
        await dao.insertLinesTrx(
          trx,
          lineRows.map(({ line, row, ctx }, i) => ({
            uuid: uuidv4(),
            companyId,
            purchaseOrderId: po.id,
            productionOrderId: row.id,
            position: i + 1,
            quantity: line.quantity ?? defaultQuantityOf(ctx),
            deliveryDate:
              line.deliveryDate === undefined
                ? row.orderDate
                : line.deliveryDate === null
                  ? null
                  : new Date(line.deliveryDate),
          })),
        );
        await dao.updateHeaderTrx(trx, po.id, {});
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return fail(
        409,
        "A production order is already on a purchase order",
        "ORDER_ALREADY_ASSIGNED",
      );
    }
    throw e;
  }
  return { ok: true, data: (await getDetail(companyId, uuid))! };
}

export async function deletePurchaseOrder(
  companyId: number,
  uuid: string,
): Promise<ServiceResult<null>> {
  const po = await dao.getRowByUuid(uuid, companyId);
  if (!po) return fail(404, "Purchase order not found");
  if (po.status !== "draft") {
    return fail(
      409,
      "Only a draft purchase order can be deleted",
      "PURCHASE_ORDER_NOT_DRAFT",
    );
  }
  // The draft's lines go by the FK CASCADE; nothing else hangs off a draft (L-006).
  await dao.delete(po.id);
  return { ok: true, data: null };
}

export async function sendPurchaseOrder(
  companyId: number,
  uuid: string,
  username: string | null,
): Promise<ServiceResult<ISupplierPurchaseOrder>> {
  const po = await dao.getRowByUuid(uuid, companyId);
  if (!po) return fail(404, "Purchase order not found");
  if (po.status !== "draft") {
    return fail(
      409,
      "Only a draft purchase order can be sent",
      "PURCHASE_ORDER_NOT_DRAFT",
    );
  }
  const views = await dao.getLinesOf(po.id);
  const rows = await dao.loadOrderRows(companyId, {
    ids: views.map((v) => v.productionOrderId),
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const contexts = new Map(
    (await buildOrderContexts(companyId, rows)).map((c) => [
      c.productionOrderId,
      c,
    ]),
  );

  const problems: { productionOrderNumber: string; reason: string }[] = [];
  const snapshots: { lineId: number; patch: Record<string, unknown> }[] = [];
  for (const { line, productionOrderId, lineId } of views) {
    const row = rowById.get(productionOrderId);
    const ctx = contexts.get(productionOrderId);
    const number = line.productionOrder!.number;
    if (!row || !ctx) {
      problems.push({ productionOrderNumber: number, reason: "not-eligible" });
      continue;
    }
    const notReady = notReadyOf(ctx);
    if (notReady) {
      problems.push({ productionOrderNumber: number, reason: notReady });
      continue;
    }
    if (!(ctx.sheetsPerUnit > 0)) {
      problems.push({
        productionOrderNumber: number,
        reason: "no-sheets-per-unit",
      });
      continue;
    }
    snapshots.push({
      lineId,
      patch: {
        orderNumber: row.number,
        boardCode: boardCodeOf(ctx),
        sheetLength: ctx.sheetLength,
        sheetWidth: ctx.sheetWidth,
        scoreLines: scoreLinesOf(row),
        sheetsPerUnit: ctx.sheetsPerUnit,
      },
    });
  }
  if (problems.length) {
    return fail(
      422,
      "Some lines cannot be sent yet",
      "LINES_NOT_READY",
      problems,
    );
  }

  await dao.transaction(async (trx) => {
    for (const { lineId, patch } of snapshots)
      await dao.updateLineTrx(trx, lineId, patch);
    await dao.updateHeaderTrx(trx, po.id, {
      status: "sent",
      sentAt: trx.fn.now(),
      sentByUser: username,
    });
  });
  return { ok: true, data: (await getDetail(companyId, uuid))! };
}

export async function unsendPurchaseOrder(
  companyId: number,
  uuid: string,
): Promise<ServiceResult<ISupplierPurchaseOrder>> {
  const po = await dao.getRowByUuid(uuid, companyId);
  if (!po) return fail(404, "Purchase order not found");
  if (po.status !== "sent") {
    return fail(
      409,
      "Only a sent purchase order can be unsent",
      "PURCHASE_ORDER_NOT_SENT",
    );
  }
  const views = await dao.getLinesOf(po.id);
  const closed = views.some((v) => v.line.completedAt != null);
  if (closed || (await receipts.countByPurchaseOrder(po.id)) > 0) {
    return fail(
      409,
      "A purchase order with receipts or closed lines cannot be unsent",
      "PURCHASE_ORDER_HAS_RECEIPTS",
    );
  }
  await dao.transaction(async (trx) => {
    await dao.clearSnapshotsTrx(trx, po.id);
    await dao.updateHeaderTrx(trx, po.id, {
      status: "draft",
      sentAt: null,
      sentByUser: null,
    });
  });
  return { ok: true, data: (await getDetail(companyId, uuid))! };
}

// ── Receipts (I-9 … I-14) ────────────────────────────────────────────────

const RECEIVED_AT_TOLERANCE_MS = 60_000;

type LineOutcome = {
  line: ISupplierPurchaseOrderLine;
  purchaseOrder: { uuid: string; number: number; status: string };
};

/** Completes the PO in the same transaction as its last line (I-14). */
async function settlePurchaseOrderTrx(
  trx: Knex.Transaction,
  purchaseOrderId: number,
  current: string,
): Promise<string> {
  if (
    current === "sent" &&
    (await dao.allLinesCompletedTrx(trx, purchaseOrderId))
  ) {
    await dao.updateHeaderTrx(trx, purchaseOrderId, {
      status: "completed",
      completedAt: trx.fn.now(),
    });
    return "completed";
  }
  return current;
}

export async function registerReceipt(
  companyId: number,
  lineUuid: string,
  username: string,
  dto: SupplierReceiptCreateInputDTO,
): Promise<ServiceResult<{ receipt: ISupplierReceipt } & LineOutcome>> {
  const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
  if (receivedAt.getTime() > Date.now() + RECEIVED_AT_TOLERANCE_MS) {
    return fail(400, "receivedAt cannot be in the future");
  }
  const warehouseId = await dao.getWarehouseId(dto.warehouseUuid, companyId);
  if (warehouseId === null) return fail(404, "Warehouse not found");

  return dao.transaction(
    async (
      trx,
    ): Promise<ServiceResult<{ receipt: ISupplierReceipt } & LineOutcome>> => {
      const line = await dao.lockLineTrx(trx, lineUuid, companyId);
      if (!line) return fail(404, "Line not found");
      if (line.poStatus !== "sent") {
        return fail(
          409,
          "The purchase order is not sent",
          "PURCHASE_ORDER_NOT_SENT",
        );
      }
      if (line.completedAt != null) {
        return fail(409, "The line is already completed", "LINE_COMPLETED");
      }
      const total = line.receivedQuantity + dto.quantity;
      if (total !== line.quantity && dto.confirmMismatch !== true) {
        return fail(
          409,
          "The received total differs from the ordered quantity",
          "QUANTITY_MISMATCH",
          {
            ordered: line.quantity,
            alreadyReceived: line.receivedQuantity,
            receiving: dto.quantity,
          },
        );
      }

      // I-22: sent lines always carry the snapshot; 1 only covers lines sent before round 2.
      const unitQuantity = dto.quantity / (line.sheetsPerUnit ?? 1);
      const stock = await productStock.insertTrx(trx, {
        uuid: uuidv4(),
        companyId,
        warehouseId,
        productId: line.productId,
        productionOrderId: line.productionOrderId,
        quantity: unitQuantity,
      });
      const receiptUuid = await receipts.insertTrx(trx, {
        uuid: uuidv4(),
        companyId,
        lineId: line.id,
        quantity: dto.quantity,
        unitQuantity,
        receivedAt,
        receivedByUser: username,
        warehouseId,
        productStockId: stock.id,
        notes: dto.notes ?? null,
      });

      const completes = total >= line.quantity || dto.closeLine === true;
      await dao.updateLineTrx(trx, line.id, {
        receivedQuantity: total,
        ...(completes
          ? { completedAt: trx.fn.now(), completedByUser: username }
          : {}),
      });
      const poStatus = completes
        ? await settlePurchaseOrderTrx(trx, line.purchaseOrderId, line.poStatus)
        : line.poStatus;

      return {
        ok: true,
        data: {
          receipt: await receipts.getByUuidTrx(trx, receiptUuid),
          line: (await dao.getLineViewTrx(trx, line.id)).line,
          purchaseOrder: {
            uuid: line.poUuid,
            number: line.poNumber,
            status: poStatus,
          },
        },
      };
    },
  );
}

export async function closeLine(
  companyId: number,
  lineUuid: string,
  username: string,
): Promise<ServiceResult<LineOutcome>> {
  return dao.transaction(async (trx): Promise<ServiceResult<LineOutcome>> => {
    const line = await dao.lockLineTrx(trx, lineUuid, companyId);
    if (!line) return fail(404, "Line not found");
    if (line.poStatus !== "sent") {
      return fail(
        409,
        "The purchase order is not sent",
        "PURCHASE_ORDER_NOT_SENT",
      );
    }
    if (line.completedAt != null) {
      return fail(409, "The line is already completed", "LINE_COMPLETED");
    }
    await dao.updateLineTrx(trx, line.id, {
      completedAt: trx.fn.now(),
      completedByUser: username,
    });
    const poStatus = await settlePurchaseOrderTrx(
      trx,
      line.purchaseOrderId,
      line.poStatus,
    );
    return {
      ok: true,
      data: {
        line: (await dao.getLineViewTrx(trx, line.id)).line,
        purchaseOrder: {
          uuid: line.poUuid,
          number: line.poNumber,
          status: poStatus,
        },
      },
    };
  });
}
