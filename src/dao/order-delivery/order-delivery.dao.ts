import { v4 as uuidv4 } from "uuid";
import type { Knex } from "knex";
import { db } from "../../database/registry";
import {
  DeliveryParentColumn,
  IDelivery,
  IDeliveryRow,
  IDeliveryStoredRow,
} from "../../interfaces/order-delivery/order-delivery.interfaces";

const TABLE = "order_deliveries";

/**
 * Owned children of a quotation or a sales order: the parent's FK is
 * `ON DELETE CASCADE`, so no DAO deletes them on parent removal (L-006). Reads
 * and the full-replace write live here; validation, resolution and derivation
 * are in `OrderDeliveryService`.
 */
export class OrderDeliveryDAO {
  /** Delivery locations of the given customer, by uuid, inside the company. */
  async locationsByUuid(
    uuids: string[],
    companyId: number,
  ): Promise<Map<string, { id: number; customerId: number }>> {
    const result = new Map<string, { id: number; customerId: number }>();
    if (uuids.length === 0) return result;
    const rows = await db("tenant")("delivery_locations")
      .where({ companyId })
      .whereIn("uuid", uuids)
      .select("id", "uuid", "customerId");
    for (const row of rows) {
      result.set(String(row.uuid).toLowerCase(), {
        id: row.id,
        customerId: row.customerId,
      });
    }
    return result;
  }

  /** Delete + insert, positions 0-based in input order. */
  async replaceTrx(
    trx: Knex.Transaction,
    parent: { column: DeliveryParentColumn; id: number },
    companyId: number,
    rows: IDeliveryRow[],
  ): Promise<void> {
    await trx(TABLE).where(parent.column, parent.id).delete();
    if (rows.length === 0) return;
    await trx(TABLE).insert(
      rows.map((row, position) => ({
        uuid: uuidv4(),
        companyId,
        [parent.column]: parent.id,
        position,
        deliveryDate: row.deliveryDate,
        deliveryLocationId: row.deliveryLocationId,
        amountType: row.amountType,
        amount: row.amount,
      })),
    );
  }

  /** Stored rows of one parent, by position — the copy source and the derivation input. */
  async rowsOf(
    parent: { column: DeliveryParentColumn; id: number },
    trx?: Knex.Transaction,
  ): Promise<IDeliveryStoredRow[]> {
    const rows = await (trx ?? db("tenant"))(TABLE)
      .where(parent.column, parent.id)
      .orderBy("position");
    return rows.map((row: any) => ({
      id: row.id,
      position: row.position,
      deliveryDate: row.deliveryDate,
      deliveryLocationId: row.deliveryLocationId ?? null,
      amountType: row.amountType,
      amount: Number(row.amount),
    }));
  }

  /** Response objects for many parents at once, `quantity` left for the service to fill. */
  async listByParents(
    column: DeliveryParentColumn,
    ids: number[],
  ): Promise<Map<number, Omit<IDelivery, "quantity">[]>> {
    const result = new Map<number, Omit<IDelivery, "quantity">[]>();
    if (ids.length === 0) return result;
    const rows = await db("tenant")(TABLE)
      .leftJoin(
        "delivery_locations as dl",
        `${TABLE}.deliveryLocationId`,
        "dl.id",
      )
      .whereIn(`${TABLE}.${column}`, ids)
      .orderBy([`${TABLE}.${column}`, `${TABLE}.position`])
      .select(
        `${TABLE}.*`,
        "dl.uuid as locationUuid",
        "dl.address as locationAddress",
      );
    for (const row of rows) {
      const list = result.get(row[column]) ?? [];
      list.push({
        uuid: row.uuid,
        position: row.position,
        deliveryDate: row.deliveryDate,
        deliveryLocation: row.locationUuid
          ? { uuid: row.locationUuid, address: row.locationAddress }
          : null,
        amountType: row.amountType,
        amount: Number(row.amount),
      });
      result.set(row[column], list);
    }
    return result;
  }
}
