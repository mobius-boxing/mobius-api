import { Knex } from "knex";
import { db } from "../../database/registry";
import { ICorrugatorPlanOrder } from "../../interfaces/corrugator-plan/corrugator-plan.interfaces";

const TABLE = "corrugator_plan_orders";

/** Plan lines — Pandora `Pedido` snapshot rows. Thin table facade; sequencing
 * (I-3), invalidation (I-6) and seeding all live in `plan.service.ts`. */
export class CorrugatorPlanOrderDAO {
  private tableName = TABLE;

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? db("tenant");
  }

  async listByPlanId(
    planId: number,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlanOrder[]> {
    const knex = this.conn(trx);
    const rows = await knex(this.tableName)
      .where("planId", planId)
      .orderBy("position", "asc");
    return rows.map((r) => this.mapToInterface(r));
  }

  async getByUuid(
    uuid: string,
    planId: number,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlanOrder | null> {
    const knex = this.conn(trx);
    const row = await knex(this.tableName).where({ uuid, planId }).first();
    return row ? this.mapToInterface(row) : null;
  }

  async maxPosition(trx: Knex.Transaction, planId: number): Promise<number> {
    const row = await trx(this.tableName)
      .where("planId", planId)
      .max("position as max")
      .first();
    return row?.max ?? -1;
  }

  async insertMany(
    trx: Knex.Transaction,
    rows: ICorrugatorPlanOrder[],
  ): Promise<ICorrugatorPlanOrder[]> {
    if (rows.length === 0) return [];
    const inserted = await trx(this.tableName)
      .insert(
        rows.map((r) => ({
          uuid: r.uuid,
          companyId: r.companyId,
          planId: r.planId,
          productionOrderId: r.productionOrderId,
          position: r.position,
          number: r.number,
          customerName: r.customerName ?? null,
          productCode: r.productCode ?? null,
          productDescription: r.productDescription ?? null,
          deliveryDate: r.deliveryDate ?? null,
          sheetLength: r.sheetLength,
          sheetWidth: r.sheetWidth,
          allowsRotation: r.allowsRotation ?? false,
          scoreLineCount: r.scoreLineCount ?? 0,
          orderQuantity: r.orderQuantity,
          sheetsPerUnit: r.sheetsPerUnit ?? 1,
          sheetsSource: r.sheetsSource,
          requiredSheets: r.requiredSheets,
          pendingSheets: r.pendingSheets,
          requestedSheets: r.requestedSheets,
          underrunPercentage: r.underrunPercentage ?? 0,
          overrunPercentage: r.overrunPercentage ?? 0,
          priority: r.priority ?? "normal",
          partialProduction: r.partialProduction ?? true,
        })),
      )
      .returning("*");
    return inserted.map((r: any) => this.mapToInterface(r));
  }

  async update(
    trx: Knex.Transaction,
    id: number,
    item: Partial<ICorrugatorPlanOrder>,
  ): Promise<ICorrugatorPlanOrder | null> {
    const updateData: Record<string, unknown> = {};
    for (const key of [
      "position",
      "sheetsPerUnit",
      "sheetsSource",
      "requiredSheets",
      "pendingSheets",
      "requestedSheets",
      "underrunPercentage",
      "overrunPercentage",
      "priority",
      "partialProduction",
      "allowsRotation",
      "allocatedSheets",
    ] as const) {
      if (item[key] !== undefined) updateData[key] = item[key];
    }
    updateData.updatedAt = trx.fn.now();
    const [row] = await trx(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  /** Register/unregister: bulk-set `allocatedSheets`/`pendingSheets` for a set of ids in one round trip. */
  async setAllocation(
    trx: Knex.Transaction,
    id: number,
    allocatedSheets: number | null,
    pendingSheets?: number,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      allocatedSheets,
      updatedAt: trx.fn.now(),
    };
    if (pendingSheets !== undefined) updateData.pendingSheets = pendingSheets;
    await trx(this.tableName).where("id", id).update(updateData);
  }

  async delete(trx: Knex.Transaction, id: number): Promise<boolean> {
    const deleted = await trx(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async deleteAllForPlan(trx: Knex.Transaction, planId: number): Promise<void> {
    await trx(this.tableName).where("planId", planId).delete();
  }

  /** I-3: renumber `position` contiguous `0..n-1`, preserving relative order. */
  async repackPositions(trx: Knex.Transaction, planId: number): Promise<void> {
    const rows = await trx(this.tableName)
      .where("planId", planId)
      .orderBy("position", "asc")
      .select("id");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].position === i) continue;
      await trx(this.tableName).where("id", rows[i].id).update({ position: i });
    }
  }

  mapToInterface(record: any): ICorrugatorPlanOrder {
    return {
      id: record.id,
      companyId: record.companyId,
      uuid: record.uuid,
      planId: record.planId,
      productionOrderId: record.productionOrderId,
      position: record.position,
      number: record.number,
      customerName: record.customerName ?? null,
      productCode: record.productCode ?? null,
      productDescription: record.productDescription ?? null,
      deliveryDate: record.deliveryDate ?? null,
      sheetLength: Number(record.sheetLength),
      sheetWidth: Number(record.sheetWidth),
      allowsRotation: record.allowsRotation,
      scoreLineCount: record.scoreLineCount,
      orderQuantity: Number(record.orderQuantity),
      sheetsPerUnit: Number(record.sheetsPerUnit),
      sheetsSource: record.sheetsSource,
      requiredSheets: Number(record.requiredSheets),
      pendingSheets: record.pendingSheets,
      requestedSheets: record.requestedSheets,
      underrunPercentage: Number(record.underrunPercentage),
      overrunPercentage: Number(record.overrunPercentage),
      priority: record.priority,
      partialProduction: record.partialProduction,
      allocatedSheets: record.allocatedSheets ?? null,
    };
  }
}
