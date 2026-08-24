import { v4 as uuidv4 } from "uuid";
import { IOrderData } from "../../interfaces/sales-order/sales-order.interfaces";
import { toNumberOut } from "../../utils/numbers";

/**
 * DatosPedido (`DatosPedidos`, module 03 §10) — the production-side header
 * carried 1:1 from a Pedido.
 *
 * There is deliberately NO endpoint, no `getAllWithFilters` and no
 * connection-owning method here: every write is part of `SalesOrderDAO`'s
 * single transaction (L-006), so all three writers TAKE the caller's `trx`.
 * Reads happen through the order's joins.
 */
const SCALAR_COLUMNS = [
  "number",
  "quantity",
  "notes",
  "dispatchNotes",
  "conversionNotes",
  "deliveryLocationId",
  "customerId",
] as const;

export class OrderDataDAO {
  private tableName = "order_data";

  /** Insert inside the caller's transaction; returns the raw row (id included). */
  async createTrx(trx: any, item: Partial<IOrderData>): Promise<any> {
    const insertData: Record<string, unknown> = {
      uuid: uuidv4(),
      companyId: item.companyId,
      quantity: item.quantity ?? 0,
    };
    for (const key of SCALAR_COLUMNS) {
      if (item[key] !== undefined) insertData[key] = item[key];
    }
    const [row] = await trx(this.tableName).insert(insertData).returning("*");
    return row;
  }

  /** Patch inside the caller's transaction; a no-op patch issues no UPDATE. */
  async updateTrx(
    trx: any,
    id: number,
    patch: Partial<IOrderData>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};
    for (const key of SCALAR_COLUMNS) {
      if (patch[key] !== undefined) updateData[key] = patch[key];
    }
    if (Object.keys(updateData).length === 0) return;
    updateData.updatedAt = trx.fn.now();
    await trx(this.tableName).where("id", id).update(updateData);
  }

  /** Delete inside the caller's transaction. */
  async deleteTrx(trx: any, id: number): Promise<boolean> {
    const deleted = await trx(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  /**
   * SECURITY: uuid-only surface. `record` is the `to_jsonb(od)` blob from the
   * order's join, with the delivery location supplied separately.
   */
  mapToInterface(record: any, deliveryLocation?: any): IOrderData | null {
    if (!record) return null;
    return {
      uuid: record.uuid,
      number: record.number ?? null,
      quantity: toNumberOut(record.quantity) ?? 0,
      notes: record.notes ?? null,
      dispatchNotes: record.dispatchNotes ?? null,
      conversionNotes: record.conversionNotes ?? null,
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deliveryLocation: deliveryLocation
        ? { uuid: deliveryLocation.uuid, address: deliveryLocation.address }
        : null,
    };
  }
}
