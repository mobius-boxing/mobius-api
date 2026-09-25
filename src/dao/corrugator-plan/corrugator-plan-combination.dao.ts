import { Knex } from "knex";
import { db } from "../../database/registry";
import {
  ICorrugatorPlanCombination,
  ICorrugatorPlanItem,
} from "../../interfaces/corrugator-plan/corrugator-plan.interfaces";

const COMBINATIONS = "corrugator_plan_combinations";
const ITEMS = "corrugator_plan_items";

/** Combinations (runs) + items (lanes). Figures are never stored — `evaluate()`
 * computes them fresh every read; this DAO only persists the geometry-free
 * columns (`machineKey`, `sequence`, `meters`, `count`, `rotated`). */
export class CorrugatorPlanCombinationDAO {
  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? db("tenant");
  }

  async listByPlanId(
    planId: number,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlanCombination[]> {
    const knex = this.conn(trx);
    const rows = await knex(COMBINATIONS)
      .where("planId", planId)
      .orderBy(["machineKey", "sequence"]);
    return rows.map((r) => this.mapCombination(r));
  }

  async listItemsByCombinationIds(
    combinationIds: number[],
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlanItem[]> {
    if (combinationIds.length === 0) return [];
    const knex = this.conn(trx);
    const rows = await knex(ITEMS)
      .whereIn("combinationId", combinationIds)
      .orderBy(["combinationId", "position"]);
    return rows.map((r) => this.mapItem(r));
  }

  async getByUuid(
    uuid: string,
    planId: number,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlanCombination | null> {
    const knex = this.conn(trx);
    const row = await knex(COMBINATIONS).where({ uuid, planId }).first();
    return row ? this.mapCombination(row) : null;
  }

  async getItemByUuid(
    uuid: string,
    combinationId: number,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlanItem | null> {
    const knex = this.conn(trx);
    const row = await knex(ITEMS).where({ uuid, combinationId }).first();
    return row ? this.mapItem(row) : null;
  }

  async deleteAllForPlan(trx: Knex.Transaction, planId: number): Promise<void> {
    // Items cascade with their combination (FK ON DELETE CASCADE).
    await trx(COMBINATIONS).where("planId", planId).delete();
  }

  async insertCombination(
    trx: Knex.Transaction,
    row: ICorrugatorPlanCombination & { companyId: number },
  ): Promise<ICorrugatorPlanCombination> {
    const [inserted] = await trx(COMBINATIONS)
      .insert({
        uuid: row.uuid,
        companyId: row.companyId,
        planId: row.planId,
        machineKey: row.machineKey,
        sequence: row.sequence,
        meters: row.meters ?? 0,
      })
      .returning("*");
    return this.mapCombination(inserted);
  }

  async insertItems(
    trx: Knex.Transaction,
    rows: (ICorrugatorPlanItem & { companyId: number })[],
  ): Promise<ICorrugatorPlanItem[]> {
    if (rows.length === 0) return [];
    const inserted = await trx(ITEMS)
      .insert(
        rows.map((r) => ({
          uuid: r.uuid,
          companyId: r.companyId,
          combinationId: r.combinationId,
          planOrderId: r.planOrderId,
          position: r.position,
          count: r.count,
          rotated: r.rotated ?? false,
        })),
      )
      .returning("*");
    return inserted.map((r: any) => this.mapItem(r));
  }

  async updateCombination(
    trx: Knex.Transaction,
    id: number,
    patch: Partial<ICorrugatorPlanCombination>,
  ): Promise<ICorrugatorPlanCombination | null> {
    const updateData: Record<string, unknown> = {};
    if (patch.meters !== undefined) updateData.meters = patch.meters;
    if (patch.sequence !== undefined) updateData.sequence = patch.sequence;
    if (patch.machineKey !== undefined)
      updateData.machineKey = patch.machineKey;
    updateData.updatedAt = trx.fn.now();
    const [row] = await trx(COMBINATIONS)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapCombination(row) : null;
  }

  async deleteCombination(trx: Knex.Transaction, id: number): Promise<boolean> {
    const deleted = await trx(COMBINATIONS).where("id", id).delete();
    return deleted > 0;
  }

  async deleteItem(trx: Knex.Transaction, id: number): Promise<boolean> {
    const deleted = await trx(ITEMS).where("id", id).delete();
    return deleted > 0;
  }

  async countItems(
    trx: Knex.Transaction,
    combinationId: number,
  ): Promise<number> {
    const row = await trx(ITEMS)
      .where("combinationId", combinationId)
      .count("* as count")
      .first();
    return Number(row?.count ?? 0);
  }

  async maxSequence(
    trx: Knex.Transaction,
    planId: number,
    physicalMachineUuid: string,
  ): Promise<number> {
    const rows: { machineKey: string; sequence: number }[] = await trx(
      COMBINATIONS,
    )
      .where("planId", planId)
      .select("machineKey", "sequence");
    let max = 0;
    for (const r of rows) {
      const physical = r.machineKey.slice(0, r.machineKey.lastIndexOf(":"));
      if (physical === physicalMachineUuid) max = Math.max(max, r.sequence);
    }
    return max;
  }

  /** I-3: renumber `sequence` 1.. per physical machine (`resequence()`'s DB write). */
  async applySequencing(
    trx: Knex.Transaction,
    updates: { id: number; sequence: number }[],
  ): Promise<void> {
    for (const u of updates) {
      await trx(COMBINATIONS)
        .where("id", u.id)
        .update({ sequence: u.sequence });
    }
  }

  async repackItemPositions(
    trx: Knex.Transaction,
    combinationId: number,
  ): Promise<void> {
    const rows = await trx(ITEMS)
      .where("combinationId", combinationId)
      .orderBy("position", "asc")
      .select("id");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].position === i) continue;
      await trx(ITEMS).where("id", rows[i].id).update({ position: i });
    }
  }

  mapCombination(record: any): ICorrugatorPlanCombination {
    return {
      id: record.id,
      uuid: record.uuid,
      planId: record.planId,
      machineKey: record.machineKey,
      sequence: record.sequence,
      meters: Number(record.meters),
    };
  }

  mapItem(record: any): ICorrugatorPlanItem {
    return {
      id: record.id,
      uuid: record.uuid,
      combinationId: record.combinationId,
      planOrderId: record.planOrderId,
      position: record.position,
      count: record.count,
      rotated: record.rotated,
    };
  }
}
