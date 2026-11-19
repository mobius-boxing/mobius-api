import { Request } from "express";
import type { Knex } from "knex";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  deriveLineStatus,
  ISupplierMachineRef,
  ISupplierPurchaseOrder,
  ISupplierPurchaseOrderLine,
  ISupplierPurchaseOrderLineRow,
  ISupplierPurchaseOrderRow,
  SUPPLIER_PO_LINE_STATUSES,
  SUPPLIER_PO_STATUSES,
} from "../../interfaces/supplier-purchase-order/supplier-purchase-order.interfaces";
import {
  buildCountQuery,
  buildQuery,
  createQueryConfig,
  parseQueryParams,
  type ParsedQuery,
  type QueryBuilderConfig,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { applyCompanyScope } from "../../utils/daoScope";
import { assertUuidParam, parseEnumParam } from "../../utils/query-params";
import type { RawOrderRow } from "../../services/corrugator/plan.service";

/** The corrugator loader's row plus the production order date the PO "Fecha" snapshots. */
export type SupplierOrderRow = RawOrderRow & { orderDate: Date | null };
import { CodeGeneratorService } from "../../services/code-generator.service";
import { rejectUnknownListParams } from "../quotation/quotation.dao";

/** `code_sequences.scope` for the purchase-order counter (D-8). */
export const SUPPLIER_PO_SCOPE = "supplier_purchase_order";

const PO = "supplier_purchase_orders";
const LINE = "supplier_purchase_order_lines";

const PO_SORTING: SortConfigs = {
  number: { column: "number" },
  sentAt: { column: "sentAt" },
  createdAt: { column: "createdAt" },
  status: { column: "status" },
  supplierCode: { table: "sup", column: "code", natural: true },
};
const PO_CONFIG: QueryBuilderConfig = createQueryConfig(PO, {
  sorting: PO_SORTING,
  defaultSort: { column: "number", order: "desc" },
});
const PO_LIST_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "status",
  "supplierUuid",
  "companyId",
] as const;

const LINE_SORTING: SortConfigs = {
  purchaseOrderNumber: { table: PO, column: "number" },
  orderNumber: { column: "orderNumber", natural: true },
  deliveryDate: { column: "deliveryDate" },
  supplierCode: { table: "sup", column: "code", natural: true },
  // Computed from completedAt/receivedQuantity — handled by the DAO, listed so it is accepted.
  status: { column: "completedAt" },
};
const LINE_CONFIG: QueryBuilderConfig = createQueryConfig(LINE, {
  sorting: LINE_SORTING,
  defaultSort: {
    table: PO,
    column: "number",
    order: "desc",
    thenBy: [{ column: "position", order: "asc" }],
  },
});
const LINE_LIST_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "status",
  "supplierUuid",
  "purchaseOrderUuid",
  "companyId",
] as const;

const LINE_STATUS_SQL = `CASE WHEN "${LINE}"."completedAt" IS NOT NULL THEN 'completed' WHEN "${LINE}"."receivedQuantity" > 0 THEN 'partial' ELSE 'pending' END`;

export type LineView = {
  line: ISupplierPurchaseOrderLine;
  productionOrderId: number;
  lineId: number;
};

export class SupplierPurchaseOrderDAO {
  private codeGenerator = new CodeGeneratorService();

  nextNumber(companyId: number): Promise<number> {
    return this.codeGenerator.nextValue(companyId, SUPPLIER_PO_SCOPE);
  }

  private headerSelect(knex: Knex) {
    return knex(PO)
      .select(
        `${PO}.*`,
        knex.raw(
          `jsonb_build_object('uuid', m.uuid, 'code', m.code, 'destinationWarehouse', CASE WHEN dw.id IS NOT NULL THEN jsonb_build_object('uuid', dw.uuid, 'name', dw.name) END) as "machine"`,
        ),
        knex.raw(
          `jsonb_build_object('uuid', sup.uuid, 'code', sup.code) as "supplier"`,
        ),
      )
      .join("machines as m", `${PO}.machineId`, "m.id")
      .leftJoin("warehouses as dw", "m.destinationWarehouseId", "dw.id")
      .join("suppliers as sup", `${PO}.supplierId`, "sup.id");
  }

  private mapHeader(row: any): ISupplierPurchaseOrder {
    return {
      uuid: row.uuid,
      number: row.number,
      status: row.status,
      machine: {
        uuid: row.machine.uuid,
        code: row.machine.code ?? null,
        destinationWarehouse: row.machine.destinationWarehouse ?? null,
      },
      supplier: row.supplier,
      notes: row.notes ?? null,
      sentAt: row.sentAt ?? null,
      sentByUser: row.sentByUser ?? null,
      completedAt: row.completedAt ?? null,
      createdByUser: row.createdByUser ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getHeaderByUuid(
    uuid: string,
    companyId: number,
  ): Promise<ISupplierPurchaseOrder | null> {
    const query = this.headerSelect(db("tenant")).where(`${PO}.uuid`, uuid);
    applyCompanyScope(query, PO, companyId);
    const row = await query.first();
    return row ? this.mapHeader(row) : null;
  }

  async getRowByUuid(
    uuid: string,
    companyId: number,
    trx?: Knex.Transaction,
  ): Promise<ISupplierPurchaseOrderRow | null> {
    const query = (trx ?? db("tenant"))(PO).where(`${PO}.uuid`, uuid);
    applyCompanyScope(query, PO, companyId);
    return (await query.first()) ?? null;
  }

  private lineSelect(knex: Knex) {
    return knex(LINE)
      .select(
        `${LINE}.*`,
        knex.raw(
          `jsonb_build_object('uuid', po.uuid, 'number', po.number) as "productionOrder"`,
        ),
        knex.raw(
          `CASE WHEN cust.id IS NOT NULL THEN jsonb_build_object('uuid', cust.uuid, 'name', cust.name) END as "customer"`,
        ),
        knex.raw(
          `jsonb_build_object('uuid', prod.uuid, 'code', prod.code, 'description', prod.description) as "product"`,
        ),
      )
      .join("production_orders as po", `${LINE}.productionOrderId`, "po.id")
      .join("products as prod", "po.productId", "prod.id")
      .leftJoin("customers as cust", "prod.customerId", "cust.id");
  }

  private mapLine(row: any): ISupplierPurchaseOrderLine {
    return {
      uuid: row.uuid,
      position: row.position,
      productionOrder: row.productionOrder,
      customer: row.customer ?? null,
      product: row.product,
      deliveryDate: row.deliveryDate ?? null,
      orderNumber: row.orderNumber ?? null,
      boardCode: row.boardCode ?? null,
      quantity: row.quantity,
      sheetLength: row.sheetLength != null ? Number(row.sheetLength) : null,
      sheetWidth: row.sheetWidth != null ? Number(row.sheetWidth) : null,
      scoreLines: row.scoreLines ?? null,
      sheetsPerUnit:
        row.sheetsPerUnit != null ? Number(row.sheetsPerUnit) : null,
      receivedQuantity: row.receivedQuantity,
      status: deriveLineStatus(row),
      completedAt: row.completedAt ?? null,
      completedByUser: row.completedByUser ?? null,
    };
  }

  async getLinesOf(purchaseOrderId: number): Promise<LineView[]> {
    const rows = await this.lineSelect(db("tenant"))
      .where(`${LINE}.purchaseOrderId`, purchaseOrderId)
      .orderBy(`${LINE}.position`);
    return rows.map((row: any) => ({
      line: this.mapLine(row),
      productionOrderId: row.productionOrderId,
      lineId: row.id,
    }));
  }

  /** Lines of the purchase orders that hold the given production orders (assignment checks). */
  async getAssignments(
    productionOrderIds: number[],
    companyId: number,
  ): Promise<
    Map<
      number,
      {
        poId: number;
        poUuid: string;
        poNumber: number;
        poStatus: string;
        supplier: { uuid: string; code: string };
      }
    >
  > {
    const result = new Map<number, any>();
    if (productionOrderIds.length === 0) return result;
    const rows = await db("tenant")(LINE)
      .join(PO, `${LINE}.purchaseOrderId`, `${PO}.id`)
      .join("suppliers as sup", `${PO}.supplierId`, "sup.id")
      .where(`${LINE}.companyId`, companyId)
      .whereIn(`${LINE}.productionOrderId`, productionOrderIds)
      .select(
        `${LINE}.productionOrderId as productionOrderId`,
        `${PO}.id as poId`,
        `${PO}.uuid as poUuid`,
        `${PO}.number as poNumber`,
        `${PO}.status as poStatus`,
        "sup.uuid as supplierUuid",
        "sup.code as supplierCode",
      );
    for (const r of rows) {
      result.set(r.productionOrderId, {
        poId: r.poId,
        poUuid: r.poUuid,
        poNumber: r.poNumber,
        poStatus: r.poStatus,
        supplier: { uuid: r.supplierUuid, code: r.supplierCode },
      });
    }
    return result;
  }

  async insertHeaderTrx(
    trx: Knex.Transaction,
    item: {
      uuid: string;
      companyId: number;
      number: number;
      machineId: number;
      supplierId: number;
      notes: string | null;
      createdByUser: string | null;
    },
  ): Promise<number> {
    const [row] = await trx(PO).insert(item).returning("id");
    return row.id;
  }

  async insertLinesTrx(
    trx: Knex.Transaction,
    lines: {
      uuid: string;
      companyId: number;
      purchaseOrderId: number;
      productionOrderId: number;
      position: number;
      quantity: number;
      deliveryDate: Date | null;
    }[],
  ): Promise<void> {
    if (lines.length) await trx(LINE).insert(lines);
  }

  async deleteLinesTrx(
    trx: Knex.Transaction,
    purchaseOrderId: number,
  ): Promise<void> {
    await trx(LINE).where({ purchaseOrderId }).delete();
  }

  async updateHeaderTrx(
    trx: Knex.Transaction,
    id: number,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await trx(PO)
      .where({ id })
      .update({ ...patch, updatedAt: trx.fn.now() });
  }

  async updateLineTrx(
    trx: Knex.Transaction,
    id: number,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await trx(LINE)
      .where({ id })
      .update({ ...patch, updatedAt: trx.fn.now() });
  }

  async clearSnapshotsTrx(
    trx: Knex.Transaction,
    purchaseOrderId: number,
  ): Promise<void> {
    await trx(LINE).where({ purchaseOrderId }).update({
      orderNumber: null,
      boardCode: null,
      sheetLength: null,
      sheetWidth: null,
      scoreLines: null,
      sheetsPerUnit: null,
      updatedAt: trx.fn.now(),
    });
  }

  async delete(id: number): Promise<boolean> {
    return (await db("tenant")(PO).where({ id }).delete()) > 0;
  }

  async linesOfTrx(
    trx: Knex.Transaction,
    purchaseOrderId: number,
  ): Promise<ISupplierPurchaseOrderLineRow[]> {
    return trx(LINE).where({ purchaseOrderId }).orderBy("position");
  }

  /** `FOR UPDATE` on the line (I-9) with its purchase order's status, inside the receipt transaction. */
  async lockLineTrx(
    trx: Knex.Transaction,
    lineUuid: string,
    companyId: number,
  ): Promise<
    | (ISupplierPurchaseOrderLineRow & {
        poStatus: string;
        poUuid: string;
        poNumber: number;
        productId: number;
      })
    | null
  > {
    const row = await trx(LINE)
      .join(PO, `${LINE}.purchaseOrderId`, `${PO}.id`)
      .join("production_orders as po", `${LINE}.productionOrderId`, "po.id")
      .where(`${LINE}.uuid`, lineUuid)
      .where(`${LINE}.companyId`, companyId)
      .forUpdate(LINE)
      .select(
        `${LINE}.*`,
        `${PO}.status as poStatus`,
        `${PO}.uuid as poUuid`,
        `${PO}.number as poNumber`,
        "po.productId as productId",
      )
      .first();
    return row ?? null;
  }

  async getLineViewTrx(
    trx: Knex.Transaction,
    lineId: number,
  ): Promise<LineView> {
    const row = await this.lineSelect(trx).where(`${LINE}.id`, lineId).first();
    return {
      line: this.mapLine(row),
      productionOrderId: row.productionOrderId,
      lineId,
    };
  }

  async getLineByUuid(
    lineUuid: string,
    companyId: number,
  ): Promise<LineView | null> {
    const row = await this.lineSelect(db("tenant"))
      .where(`${LINE}.uuid`, lineUuid)
      .where(`${LINE}.companyId`, companyId)
      .first();
    return row
      ? {
          line: this.mapLine(row),
          productionOrderId: row.productionOrderId,
          lineId: row.id,
        }
      : null;
  }

  async allLinesCompletedTrx(
    trx: Knex.Transaction,
    purchaseOrderId: number,
  ): Promise<boolean> {
    const row = await trx(LINE)
      .where({ purchaseOrderId })
      .whereNull("completedAt")
      .count("* as count")
      .first();
    return (parseInt(row?.count as string) || 0) === 0;
  }

  /**
   * Same row shape as the corrugator's loader (so `buildOrderContexts` takes it)
   * under the D-28 predicate. `onlyEligible: false` is for display of orders
   * already on a PO line.
   */
  async loadOrderRows(
    companyId: number,
    opts: {
      ids?: number[];
      search?: string;
      onlyEligible?: boolean;
      excludeOnSentPo?: boolean;
    },
  ): Promise<SupplierOrderRow[]> {
    const knex = db("tenant");
    const q = knex("production_orders as po")
      .join("products as pr", "pr.id", "po.productId")
      .leftJoin("customers as cu", "cu.id", "pr.customerId")
      .where("po.companyId", companyId)
      .select(
        "po.id as id",
        "po.uuid as uuid",
        "po.number as number",
        "po.deliveryDate as deliveryDate",
        "po.orderDate as orderDate",
        "po.quantity as orderQuantity",
        "po.routeId as routeId",
        "pr.id as productId",
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
    if (opts.onlyEligible !== false) {
      q.whereNull("po.voidedAt").whereNull("po.completedAt");
    }
    if (opts.excludeOnSentPo) {
      q.whereNotExists(
        knex("supplier_purchase_order_lines as l")
          .join("supplier_purchase_orders as p", "p.id", "l.purchaseOrderId")
          .select(knex.raw("1"))
          .whereRaw(`l."productionOrderId" = po.id`)
          .whereIn("p.status", ["sent", "completed"]),
      );
    }
    if (opts.ids) q.whereIn("po.id", opts.ids);
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

  /** Supplier machines of each route's stages, in stage order, primary first. */
  async loadSupplierMachinesByRoute(
    routeIds: number[],
  ): Promise<Map<number, ISupplierMachineRef[]>> {
    const result = new Map<number, ISupplierMachineRef[]>();
    if (routeIds.length === 0) return result;
    const rows = await db("tenant")("production_route_stages as s")
      .join("production_route_stage_machines as sm", "sm.stageId", "s.id")
      .join("machines as m", "m.id", "sm.machineId")
      .join("machine_types as mt", "mt.id", "m.machineTypeId")
      .join("suppliers as sup", "sup.id", "m.supplierId")
      .whereIn("s.routeId", routeIds)
      .andWhere("mt.isSupplier", true)
      .orderBy([
        { column: "s.routeId" },
        { column: "s.number" },
        { column: "sm.isPrimary", order: "desc" },
        { column: "m.id" },
      ])
      .select(
        "s.routeId as routeId",
        "m.uuid as machineUuid",
        "m.code as machineCode",
        "sup.uuid as supplierUuid",
        "sup.code as supplierCode",
      );
    for (const r of rows) {
      const list = result.get(r.routeId) ?? [];
      if (!list.some((m) => m.uuid === r.machineUuid)) {
        list.push({
          uuid: r.machineUuid,
          code: r.machineCode ?? null,
          supplier: { uuid: r.supplierUuid, code: r.supplierCode },
        });
      }
      result.set(r.routeId, list);
    }
    return result;
  }

  async getOrdersByUuids(
    uuids: string[],
    companyId: number,
  ): Promise<{ id: number; uuid: string; number: string }[]> {
    return db("tenant")("production_orders")
      .where("companyId", companyId)
      .whereIn("uuid", uuids)
      .select("id", "uuid", "number");
  }

  async getSupplierMachine(
    uuid: string,
    companyId: number,
  ): Promise<{
    id: number;
    supplierId: number | null;
    isSupplier: boolean;
  } | null> {
    const row = await db("tenant")("machines as m")
      .join("machine_types as mt", "mt.id", "m.machineTypeId")
      .where({ "m.uuid": uuid, "m.companyId": companyId })
      .select("m.id", "m.supplierId", "mt.isSupplier")
      .first();
    return row ?? null;
  }

  async getWarehouseId(
    uuid: string,
    companyId: number,
  ): Promise<number | null> {
    const row = await db("tenant")("warehouses")
      .where({ uuid, company_id: companyId })
      .select("id")
      .first();
    return row?.id ?? null;
  }

  transaction<T>(body: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return db("tenant").transaction(body);
  }

  async getAllWithFilters(
    req: Request,
    companyId: number,
  ): Promise<IDataPaginator<ISupplierPurchaseOrder>> {
    rejectUnknownListParams(req, PO_LIST_PARAMS, Object.keys(PO_SORTING));
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    delete parsedQuery.filters.companyId;

    parseEnumParam("status", parsedQuery.filters.status, SUPPLIER_PO_STATUSES);
    const status = parsedQuery.filters.status as string | undefined;
    delete parsedQuery.filters.status;
    const supplierId = await this.takeSupplier(parsedQuery, companyId);
    const search = parsedQuery.search?.trim();
    delete parsedQuery.search;

    const applyExtra = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      applyCompanyScope(q, PO, companyId);
      if (status) q.where(`${PO}.status`, status);
      if (supplierId !== undefined) q.where(`${PO}.supplierId`, supplierId);
      if (search) {
        const pattern = `%${search}%`;
        q.where((b) => {
          b.whereRaw(`${PO}."number"::text ILIKE ?`, [pattern]).orWhereExists(
            knex("suppliers")
              .select(knex.raw("1"))
              .whereRaw(`suppliers.id = ${PO}."supplierId"`)
              .andWhere("suppliers.code", "ILIKE", pattern),
          );
        });
      }
      return q;
    };

    const dataQuery = applyExtra(
      this.headerSelect(knex).select(
        knex.raw(
          `(SELECT count(*) FROM ${LINE} l WHERE l."purchaseOrderId" = ${PO}.id) as "lineCount"`,
        ),
        knex.raw(
          `(SELECT COALESCE(sum(l.quantity), 0) FROM ${LINE} l WHERE l."purchaseOrderId" = ${PO}.id) as "orderedQuantity"`,
        ),
        knex.raw(
          `(SELECT COALESCE(sum(l."receivedQuantity"), 0) FROM ${LINE} l WHERE l."purchaseOrderId" = ${PO}.id) as "receivedQuantity"`,
        ),
      ),
    );
    buildQuery(dataQuery, parsedQuery, PO_CONFIG);
    const countQuery = applyExtra(knex(PO));
    buildCountQuery(countQuery, parsedQuery, PO_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;
    return {
      success: true,
      data: rows.map((row: any) => ({
        ...this.mapHeader(row),
        lineCount: Number(row.lineCount),
        orderedQuantity: Number(row.orderedQuantity),
        receivedQuantity: Number(row.receivedQuantity),
      })),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private async takeSupplier(
    parsedQuery: ParsedQuery,
    companyId: number,
  ): Promise<number | undefined> {
    const uuid = assertUuidParam(
      "supplierUuid",
      parsedQuery.filters.supplierUuid,
    );
    delete parsedQuery.filters.supplierUuid;
    if (!uuid) return undefined;
    const row = await db("tenant")("suppliers")
      .where({ uuid, companyId })
      .select("id")
      .first();
    return row?.id ?? -1;
  }

  /** `GET /lines` — Seguimiento: lines of `sent` and `completed` purchase orders. */
  async listLines(
    req: Request,
    companyId: number,
  ): Promise<
    IDataPaginator<ISupplierPurchaseOrderLine & Record<string, unknown>>
  > {
    rejectUnknownListParams(req, LINE_LIST_PARAMS, Object.keys(LINE_SORTING));
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    delete parsedQuery.filters.companyId;

    const status = parseEnumParam(
      "status",
      parsedQuery.filters.status,
      SUPPLIER_PO_LINE_STATUSES,
    );
    delete parsedQuery.filters.status;
    const supplierId = await this.takeSupplier(parsedQuery, companyId);
    const poUuid = assertUuidParam(
      "purchaseOrderUuid",
      parsedQuery.filters.purchaseOrderUuid,
    );
    delete parsedQuery.filters.purchaseOrderUuid;
    const search = parsedQuery.search?.trim();
    delete parsedQuery.search;
    const sortByStatus = parsedQuery.sortBy === "status";
    if (sortByStatus) delete parsedQuery.sortBy;

    const applyExtra = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      applyCompanyScope(q, LINE, companyId);
      q.whereIn(`${PO}.status`, ["sent", "completed"]);
      if (status) q.whereRaw(`${LINE_STATUS_SQL} = ?`, [status]);
      if (supplierId !== undefined) q.where(`${PO}.supplierId`, supplierId);
      if (poUuid) q.where(`${PO}.uuid`, poUuid);
      if (search) {
        const pattern = `%${search}%`;
        q.where((b) => {
          b.where(`${LINE}.orderNumber`, "ILIKE", pattern)
            .orWhereRaw(`${PO}."number"::text ILIKE ?`, [pattern])
            .orWhereExists(
              knex("production_orders as po")
                .join("products as prod", "po.productId", "prod.id")
                .leftJoin("customers as cust", "prod.customerId", "cust.id")
                .select(knex.raw("1"))
                .whereRaw(`po.id = ${LINE}."productionOrderId"`)
                .andWhere((p) =>
                  p
                    .where("prod.code", "ILIKE", pattern)
                    .orWhere("cust.name", "ILIKE", pattern),
                ),
            );
        });
      }
      return q;
    };

    const dataQuery = applyExtra(
      this.lineSelect(knex)
        .select(
          knex.raw(
            `jsonb_build_object('uuid', ${PO}.uuid, 'number', ${PO}.number, 'status', ${PO}.status) as "purchaseOrder"`,
          ),
          knex.raw(`${PO}."sentAt" as "poSentAt"`),
          knex.raw(
            `(SELECT COALESCE(sum(r."unitQuantity"), 0) FROM supplier_receipts r WHERE r."lineId" = ${LINE}.id) as "receivedUnits"`,
          ),
          knex.raw(
            `jsonb_build_object('uuid', sup.uuid, 'code', sup.code) as "supplier"`,
          ),
          knex.raw(
            `CASE WHEN dw.id IS NOT NULL THEN jsonb_build_object('uuid', dw.uuid, 'name', dw.name) END as "defaultWarehouse"`,
          ),
        )
        .join(PO, `${LINE}.purchaseOrderId`, `${PO}.id`)
        .join("machines as m", `${PO}.machineId`, "m.id")
        .leftJoin("warehouses as dw", "m.destinationWarehouseId", "dw.id")
        .join("suppliers as sup", `${PO}.supplierId`, "sup.id"),
    );
    if (sortByStatus) {
      const dir =
        String(req.query.sortOrder).toLowerCase() === "desc" ? "desc" : "asc";
      dataQuery.orderByRaw(`${LINE_STATUS_SQL} ${dir}`);
    }
    buildQuery(dataQuery, parsedQuery, LINE_CONFIG);
    const countQuery = applyExtra(
      knex(LINE).join(PO, `${LINE}.purchaseOrderId`, `${PO}.id`),
    );
    buildCountQuery(countQuery, parsedQuery, LINE_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;
    return {
      success: true,
      data: rows.map((row: any) => ({
        ...this.mapLine(row),
        receivedUnits: Number(row.receivedUnits),
        purchaseOrder: { ...row.purchaseOrder, sentAt: row.poSentAt ?? null },
        supplier: row.supplier,
        defaultWarehouse: row.defaultWarehouse ?? null,
      })),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }
}
