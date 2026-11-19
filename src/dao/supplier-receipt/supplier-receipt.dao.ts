import type { Knex } from "knex";
import { db } from "../../database/registry";
import { ISupplierReceipt } from "../../interfaces/supplier-purchase-order/supplier-purchase-order.interfaces";

const TABLE = "supplier_receipts";

/** Append-only (D-18): no update or delete here. */
export class SupplierReceiptDAO {
  async insertTrx(
    trx: Knex.Transaction,
    item: {
      uuid: string;
      companyId: number;
      lineId: number;
      quantity: number;
      unitQuantity: number;
      receivedAt: Date | string;
      receivedByUser: string;
      warehouseId: number;
      productStockId: number;
      notes: string | null;
    },
  ): Promise<string> {
    const [row] = await trx(TABLE).insert(item).returning("uuid");
    return row.uuid;
  }

  async listByLineIds(
    lineIds: number[],
  ): Promise<Map<number, ISupplierReceipt[]>> {
    const result = new Map<number, ISupplierReceipt[]>();
    if (lineIds.length === 0) return result;
    const rows = await db("tenant")(TABLE)
      .join("warehouses as wh", `${TABLE}.warehouseId`, "wh.id")
      .join("product_stock as ps", `${TABLE}.productStockId`, "ps.id")
      .whereIn(`${TABLE}.lineId`, lineIds)
      .orderBy([`${TABLE}.receivedAt`, `${TABLE}.id`])
      .select(
        `${TABLE}.*`,
        "wh.uuid as warehouseUuid",
        "wh.name as warehouseName",
        "ps.uuid as productStockUuid",
      );
    for (const row of rows) {
      const list = result.get(row.lineId) ?? [];
      list.push(this.map(row));
      result.set(row.lineId, list);
    }
    return result;
  }

  async getByUuidTrx(
    trx: Knex.Transaction,
    uuid: string,
  ): Promise<ISupplierReceipt> {
    const row = await trx(TABLE)
      .join("warehouses as wh", `${TABLE}.warehouseId`, "wh.id")
      .join("product_stock as ps", `${TABLE}.productStockId`, "ps.id")
      .where(`${TABLE}.uuid`, uuid)
      .select(
        `${TABLE}.*`,
        "wh.uuid as warehouseUuid",
        "wh.name as warehouseName",
        "ps.uuid as productStockUuid",
      )
      .first();
    return this.map(row);
  }

  /** Receipts on any line of the purchase order — the unsend guard (D-15). */
  async countByPurchaseOrder(purchaseOrderId: number): Promise<number> {
    const row = await db("tenant")(TABLE)
      .join("supplier_purchase_order_lines as l", `${TABLE}.lineId`, "l.id")
      .where("l.purchaseOrderId", purchaseOrderId)
      .count("* as count")
      .first();
    return parseInt(row?.count as string) || 0;
  }

  private map(row: any): ISupplierReceipt {
    return {
      uuid: row.uuid,
      quantity: row.quantity,
      unitQuantity: Number(row.unitQuantity),
      receivedAt: row.receivedAt,
      receivedByUser: row.receivedByUser,
      warehouse: { uuid: row.warehouseUuid, name: row.warehouseName },
      productStock: { uuid: row.productStockUuid },
      notes: row.notes ?? null,
      createdAt: row.createdAt,
    };
  }
}
