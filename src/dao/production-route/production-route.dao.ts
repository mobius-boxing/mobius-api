import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  SUPPLY_TABLES,
  IProductionRoute,
  IRouteStage,
  IStageMachine,
  IStageSupply,
} from "../../interfaces/production-route/production-route.interfaces";
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
import { diffKeyedRows } from "../../utils/setDiff";
import { v4 as uuidv4 } from "uuid";

// Re-exported for existing importers; the definition lives in the interfaces
// (single source with the type union and the DTO/validator lists).
export { SUPPLY_TABLES };

const ROUTE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  name: { column: "name", operator: "ILIKE" },
  isGlobal: {
    column: "isGlobal",
    operator: "=",
    transform: (v: string) => v === "true",
  },
  active: {
    column: "active",
    operator: "=",
    transform: (v: string) => v === "true",
  },
  isDefault: {
    column: "isDefault",
    operator: "=",
    transform: (v: string) => v === "true",
  },
};

const ROUTE_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
};

const ROUTE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "production_routes",
  {
    filters: ROUTE_FILTERS,
    sorting: ROUTE_SORTING,
    search: { columns: ["name"], operator: "ILIKE" },
    defaultSort: { column: "name", order: "asc" },
  },
);

// ── Stage-tree diff helpers (audit P1b) ─────────────────────────────────────
// Pure and module-level: one mapper per table produces the column values a row
// must end up with, and the *same* mapper produces them from a stored row. Both
// the INSERT payload and the UPDATE patch come from it, so "what we write" and
// "what we compare" can never drift — if they did, a freshly inserted row would
// look changed on the very next save and every PUT would write forever.

/** An incoming stage plus the `number` its array position assigns it. */
type DesiredStage = { stage: IRouteStage; number: number };
/** An incoming supply plus the `position` its array position assigns it. */
type DesiredSupply = { supply: IStageSupply; position: number };

/**
 * Sentinel for the pairing pass. `diffKeyedRows` reports a matched pair only
 * when its `changedColumns` are non-empty, but an *unchanged* stage can still
 * own a changed supply, so the caller needs every pair back and computes the
 * real patch itself with {@link diffColumns}.
 */
const PAIRED = { paired: true } as const;

/** `undefined` and `null` are the same absent value once a row is stored. */
const orNull = (value: unknown): unknown => value ?? null;

/** float8/int columns can arrive as strings depending on the driver path. */
const toNumber = (value: unknown, fallback: number | null): number | null => {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Columns whose stored value differs from the desired one; `{}` ⇒ nothing to do. */
const diffColumns = (
  desired: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(desired).filter(
      ([column, value]) => value !== stored[column],
    ),
  );

const stageColumns = (target: DesiredStage): Record<string, unknown> => ({
  number: target.number,
  description: orNull(target.stage.description),
  isCorrugation: orNull(target.stage.isCorrugation),
  setupTimeMinutes: toNumber(target.stage.setupTimeMinutes, 0),
  machineTypeId: toNumber(target.stage.machineTypeId, null),
});

const storedStageColumns = (row: any): Record<string, unknown> => ({
  number: toNumber(row.number, null),
  description: orNull(row.description),
  isCorrugation: orNull(row.isCorrugation),
  setupTimeMinutes: toNumber(row.setupTimeMinutes, 0),
  machineTypeId: toNumber(row.machineTypeId, null),
});

const machineKey = (stageId: number, machineId: unknown): string =>
  `${stageId}:${machineId}`;

const machineColumns = (machine: IStageMachine): Record<string, unknown> => ({
  isPrimary: machine.isPrimary ?? true,
});

const storedMachineColumns = (row: any): Record<string, unknown> => ({
  isPrimary: row.isPrimary,
});

const supplyColumns = (target: DesiredSupply): Record<string, unknown> => ({
  position: target.position,
  direction: target.supply.direction,
  supplyType: target.supply.supplyType,
  supplyId: toNumber(target.supply.supplyId, null),
  quantity: toNumber(target.supply.quantity, null),
  quantityType: orNull(target.supply.quantityType),
  repetitionsWidth: toNumber(target.supply.repetitionsWidth, 1.0),
  repetitionsLength: toNumber(target.supply.repetitionsLength, 1.0),
  allowsSimilar: target.supply.allowsSimilar ?? false,
  notes: orNull(target.supply.notes),
});

const storedSupplyColumns = (row: any): Record<string, unknown> => ({
  position: toNumber(row.position, null),
  direction: row.direction,
  supplyType: row.supplyType,
  supplyId: toNumber(row.supplyId, null),
  quantity: toNumber(row.quantity, null),
  quantityType: orNull(row.quantityType),
  repetitionsWidth: toNumber(row.repetitionsWidth, 1.0),
  repetitionsLength: toNumber(row.repetitionsLength, 1.0),
  allowsSimilar: row.allowsSimilar ?? false,
  notes: orNull(row.notes),
});

export class ProductionRouteDAO {
  private tableName = "production_routes";
  private queryConfig = ROUTE_QUERY_CONFIG;

  // ── Create / update (stages replaced wholesale, transactional) ────────────

  async create(item: IProductionRoute): Promise<IProductionRoute> {
    const knex = db("erp");
    const uuid = item.uuid ?? uuidv4();
    await knex.transaction(async (trx) => {
      if (item.isDefault) await this.clearDefault(trx, item.companyId!);
      const [route] = await trx(this.tableName)
        .insert({
          uuid,
          companyId: item.companyId,
          name: item.name,
          isGlobal: item.isGlobal ?? false,
          active: item.active ?? true,
          isDefault: item.isDefault ?? false,
        })
        .returning("*");
      await this.insertStages(trx, route.id, item.stages ?? []);
    });
    return (await this.getByUuid(uuid))!;
  }

  async update(
    id: number,
    item: Partial<IProductionRoute>,
  ): Promise<IProductionRoute | null> {
    const knex = db("erp");
    const existing = await knex(this.tableName).where("id", id).first();
    if (!existing) return null;

    await knex.transaction(async (trx) => {
      if (item.isDefault === true) {
        await this.clearDefault(trx, existing.companyId);
      }
      const updateData: any = { updatedAt: trx.fn.now() };
      for (const key of ["name", "isGlobal", "active", "isDefault"] as const) {
        if (item[key] !== undefined) updateData[key] = item[key];
      }
      await trx(this.tableName).where("id", id).update(updateData);

      if (item.stages !== undefined) {
        await this.syncStages(trx, id, item.stages);
      }
    });
    return this.getByUuid(existing.uuid);
  }

  // ── Stage-tree upsert (audit P1b) ─────────────────────────────────────────

  /**
   * Reconcile the stored stage tree with `stages` instead of deleting and
   * re-inserting it. Survivors keep their `id` and their `uuid`, so an
   * identical payload writes nothing and a later row-level audit trigger
   * records the column the user actually edited instead of a full rewrite.
   *
   * The statement order is mandatory, not stylistic:
   *  (i)   DELETE the stages no incoming row claimed. Their machines and
   *        supplies ride `ON DELETE CASCADE` — never delete those explicitly
   *        (L-006); it doubles the very ledger rows this exists to shrink.
   *  (ii)  If any survivor has to move, negate `number` for all movers in one
   *        bulk UPDATE. `UNIQUE("routeId", "number")` is non-deferrable, so the
   *        range must be vacated first; negatives are always free because real
   *        numbers are 1..N.
   *  (iii) Per-row UPDATE with the final `number` plus whatever else changed.
   *  (iv)  INSERT the new stages, each with a server-generated `uuidv4()`.
   *  (v)   Recurse into machines, then supplies.
   *
   * A client uuid is an identity *reference*: one that matches no stored stage
   * is a brand-new row and gets a fresh server uuid, never the client's value.
   * When the payload carries no uuids at all (today's web app) `diffKeyedRows`
   * falls back to array ordinals against the `number`-ordered read.
   */
  private async syncStages(
    trx: any,
    routeId: number,
    stages: IRouteStage[],
  ): Promise<void> {
    // Array order is the stage order (Procusto renumber semantics), exactly as
    // in insertStages — `number` is derived here, never trusted from input.
    const desired: DesiredStage[] = stages.map((stage, index) => ({
      stage,
      number: index + 1,
    }));
    const existing = await trx("production_route_stages")
      .where("routeId", routeId)
      .orderBy("number", "asc");

    const paired = diffKeyedRows<DesiredStage, any>(desired, existing, {
      keyOfIncoming: (target) => target.stage.uuid,
      keyOfExisting: (row) => row.uuid,
      changedColumns: () => PAIRED,
    });
    const matches = paired.updates.map((pair) => ({
      target: pair.incoming,
      row: pair.existing,
      changes: diffColumns(
        stageColumns(pair.incoming),
        storedStageColumns(pair.existing),
      ),
    }));

    // (i) removed stages — machines and supplies cascade (L-006).
    if (paired.deletes.length) {
      await trx("production_route_stages")
        .whereIn(
          "id",
          paired.deletes.map((row: any) => row.id),
        )
        .delete();
    }

    // (ii) vacate the number range for every mover, in one statement.
    const movers = matches
      .filter((match) => match.changes.number !== undefined)
      .map((match) => match.row.id);
    if (movers.length) {
      await trx("production_route_stages")
        .where("routeId", routeId)
        .whereIn("id", movers)
        .update({ number: trx.raw('-"number"') });
    }

    // (iii) survivors: only the columns that differ, plus updatedAt — which is
    // never a change on its own, or every save manufactures an audit row.
    for (const match of matches) {
      if (!Object.keys(match.changes).length) continue;
      await trx("production_route_stages")
        .where("id", match.row.id)
        .update({ ...match.changes, updatedAt: trx.fn.now() });
    }

    // (iv) new stages.
    const created: Array<{ stageId: number; target: DesiredStage }> = [];
    for (const insert of paired.inserts) {
      const [row] = await trx("production_route_stages")
        .insert({
          uuid: uuidv4(),
          routeId,
          ...stageColumns(insert.incoming),
        })
        .returning("id");
      created.push({ stageId: row.id ?? row, target: insert.incoming });
    }

    // (v) children. Read both child tables once for the survivors; the stages
    // just inserted have none by construction.
    const survivorIds = matches.map((match) => match.row.id);
    const existingMachines = survivorIds.length
      ? await trx("production_route_stage_machines").whereIn(
          "stageId",
          survivorIds,
        )
      : [];
    const existingSupplies = survivorIds.length
      ? await trx("production_route_stage_supplies")
          .whereIn("stageId", survivorIds)
          .orderBy("position", "asc")
      : [];
    const ofStage = (rows: any[], stageId: number) =>
      rows.filter((row: any) => row.stageId === stageId);

    for (const match of matches) {
      await this.syncStageMachines(
        trx,
        match.row.id,
        match.target.stage.machines ?? [],
        ofStage(existingMachines, match.row.id),
      );
      await this.syncStageSupplies(
        trx,
        match.row.id,
        match.target.stage.supplies ?? [],
        ofStage(existingSupplies, match.row.id),
      );
    }
    for (const stage of created) {
      await this.syncStageMachines(
        trx,
        stage.stageId,
        stage.target.stage.machines ?? [],
        [],
      );
      await this.syncStageSupplies(
        trx,
        stage.stageId,
        stage.target.stage.supplies ?? [],
        [],
      );
    }
  }

  /**
   * `(stageId, machineId)` identity, no uuid and no `updatedAt` on the table.
   * A keyed diff rather than a plain set because `isPrimary` is updatable —
   * demoting the primary machine must be one UPDATE, not a delete + insert.
   * No vacate pass: `UNIQUE("stageId", "machineId")` cannot be hit, since the
   * inserted keys are by definition the ones no stored row holds.
   */
  private async syncStageMachines(
    trx: any,
    stageId: number,
    machines: IStageMachine[],
    existing: any[],
  ): Promise<void> {
    const diff = diffKeyedRows<IStageMachine, any>(machines, existing, {
      keyOfIncoming: (machine) => machineKey(stageId, machine.machineId),
      keyOfExisting: (row) => machineKey(stageId, row.machineId),
      changedColumns: (machine, row) =>
        diffColumns(machineColumns(machine), storedMachineColumns(row)),
      // Ordinals are meaningless for a set-valued table: an unkeyed row is new.
      ordinalFallback: false,
    });

    if (diff.deletes.length) {
      await trx("production_route_stage_machines")
        .whereIn(
          "id",
          diff.deletes.map((row: any) => row.id),
        )
        .delete();
    }
    for (const update of diff.updates) {
      await trx("production_route_stage_machines")
        .where("id", update.existing.id)
        .update(update.changes);
    }
    if (diff.inserts.length) {
      await trx("production_route_stage_machines").insert(
        diff.inserts.map((insert) => ({
          stageId,
          machineId: insert.incoming.machineId,
          ...machineColumns(insert.incoming),
        })),
      );
    }
  }

  /**
   * Same five steps as the stages themselves, vacating `position` instead of
   * `number`: since T2a the table carries a NOT NULL `position` with a
   * non-deferrable `UNIQUE("stageId", "position")`. `position` is derived from
   * the array index inside the stage and is never accepted from a client. The
   * table has no `updatedAt`, so a survivor's UPDATE carries only real columns.
   */
  private async syncStageSupplies(
    trx: any,
    stageId: number,
    supplies: IStageSupply[],
    existing: any[],
  ): Promise<void> {
    const desired: DesiredSupply[] = supplies.map((supply, index) => ({
      supply,
      position: index + 1,
    }));

    const paired = diffKeyedRows<DesiredSupply, any>(desired, existing, {
      keyOfIncoming: (target) => target.supply.uuid,
      keyOfExisting: (row) => row.uuid,
      changedColumns: () => PAIRED,
    });
    const matches = paired.updates.map((pair) => ({
      row: pair.existing,
      changes: diffColumns(
        supplyColumns(pair.incoming),
        storedSupplyColumns(pair.existing),
      ),
    }));

    if (paired.deletes.length) {
      await trx("production_route_stage_supplies")
        .whereIn(
          "id",
          paired.deletes.map((row: any) => row.id),
        )
        .delete();
    }

    const movers = matches
      .filter((match) => match.changes.position !== undefined)
      .map((match) => match.row.id);
    if (movers.length) {
      await trx("production_route_stage_supplies")
        .where("stageId", stageId)
        .whereIn("id", movers)
        .update({ position: trx.raw('-"position"') });
    }

    for (const match of matches) {
      if (!Object.keys(match.changes).length) continue;
      await trx("production_route_stage_supplies")
        .where("id", match.row.id)
        .update(match.changes);
    }

    if (paired.inserts.length) {
      await trx("production_route_stage_supplies").insert(
        paired.inserts.map((insert) => ({
          uuid: uuidv4(),
          stageId,
          ...supplyColumns(insert.incoming),
        })),
      );
    }
  }

  /** Single-default invariant (app-level, per spec — not a DB constraint). */
  private async clearDefault(trx: any, companyId: number): Promise<void> {
    await trx(this.tableName)
      .where({ companyId, isDefault: true })
      .update({ isDefault: false, updatedAt: trx.fn.now() });
  }

  /**
   * Stages renumbered 1..N by array order (Procusto renumber semantics);
   * each stage's supplies get `position` 1..N the same way.
   */
  private async insertStages(
    trx: any,
    routeId: number,
    stages: IRouteStage[],
  ): Promise<void> {
    for (const [index, stage] of stages.entries()) {
      const [created] = await trx("production_route_stages")
        .insert({
          uuid: uuidv4(),
          routeId,
          number: index + 1,
          description: stage.description ?? null,
          isCorrugation: stage.isCorrugation ?? false,
          setupTimeMinutes: stage.setupTimeMinutes ?? 0,
          machineTypeId: stage.machineTypeId ?? null,
        })
        .returning("id");
      const stageId = created.id ?? created;

      if (stage.machines?.length) {
        await trx("production_route_stage_machines").insert(
          stage.machines.map((m) => ({
            stageId,
            machineId: m.machineId,
            isPrimary: m.isPrimary ?? true,
          })),
        );
      }
      if (stage.supplies?.length) {
        await trx("production_route_stage_supplies").insert(
          stage.supplies.map((s, supplyIndex) => ({
            uuid: uuidv4(),
            stageId,
            // NOT NULL since 20260831000001; array order is the display order.
            position: supplyIndex + 1,
            direction: s.direction,
            supplyType: s.supplyType,
            supplyId: s.supplyId,
            quantity: s.quantity ?? null,
            quantityType: s.quantityType ?? null,
            repetitionsWidth: s.repetitionsWidth ?? 1.0,
            repetitionsLength: s.repetitionsLength ?? 1.0,
            allowsSimilar: s.allowsSimilar ?? false,
            notes: s.notes ?? null,
          })),
        );
      }
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProductionRoute | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const route = await query.select(`${this.tableName}.*`).first();
    if (!route) return null;

    const stages = await this.loadStages(route.id);
    return { ...this.mapRoute(route), id: route.id, stages };
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  private async loadStages(routeId: number): Promise<IRouteStage[]> {
    const knex = db("erp");
    const stages = await knex("production_route_stages as st")
      .select(
        "st.*",
        knex.raw(
          `CASE WHEN mt.id IS NOT NULL THEN to_jsonb(mt) END as "machineType"`,
        ),
      )
      .leftJoin("machine_types as mt", "st.machineTypeId", "mt.id")
      .where("st.routeId", routeId)
      .orderBy("st.number", "asc");
    if (!stages.length) return [];

    const stageIds = stages.map((s: any) => s.id);
    const machines = await knex("production_route_stage_machines as sm")
      .select("sm.stageId", "sm.isPrimary", knex.raw(`to_jsonb(m) as machine`))
      .join("machines as m", "sm.machineId", "m.id")
      .whereIn("sm.stageId", stageIds);
    const supplies = await knex("production_route_stage_supplies")
      .whereIn("stageId", stageIds)
      .orderBy("position", "asc");

    // Batch-resolve supply display objects per type.
    const supplyRefs = new Map<
      string,
      { uuid: string; code?: string; name?: string }
    >();
    for (const [type, table] of Object.entries(SUPPLY_TABLES)) {
      const ids = [
        ...new Set(
          supplies
            .filter((s: any) => s.supplyType === type)
            .map((s: any) => s.supplyId),
        ),
      ];
      if (!ids.length) continue;
      const rows = await knex(table)
        .whereIn("id", ids)
        .select("id", "uuid", "code", "name");
      rows.forEach((r: any) =>
        supplyRefs.set(`${type}:${r.id}`, {
          uuid: r.uuid,
          code: r.code,
          name: r.name,
        }),
      );
    }

    return stages.map((stage: any) => ({
      uuid: stage.uuid,
      number: stage.number,
      description: stage.description,
      isCorrugation: stage.isCorrugation,
      setupTimeMinutes: parseFloat(stage.setupTimeMinutes) || 0,
      machineTypeId: stage.machineTypeId,
      machineType: stage.machineType
        ? {
            uuid: stage.machineType.uuid,
            name: stage.machineType.name,
            corrugated: stage.machineType.corrugated,
          }
        : null,
      machines: machines
        .filter((m: any) => m.stageId === stage.id)
        .map((m: any) => ({
          isPrimary: m.isPrimary,
          machine: {
            uuid: m.machine.uuid,
            code: m.machine.code,
            description: m.machine.description,
          },
        })),
      supplies: supplies
        .filter((s: any) => s.stageId === stage.id)
        .map((s: any) => ({
          uuid: s.uuid,
          direction: s.direction,
          supplyType: s.supplyType,
          supplyId: s.supplyId,
          quantity: s.quantity != null ? parseFloat(s.quantity) : null,
          quantityType: s.quantityType,
          repetitionsWidth: parseFloat(s.repetitionsWidth),
          repetitionsLength: parseFloat(s.repetitionsLength),
          allowsSimilar: s.allowsSimilar,
          notes: s.notes,
          supply: supplyRefs.get(`${s.supplyType}:${s.supplyId}`) ?? null,
        })),
    }));
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  /** True when any part references this route (delete guard, spec 04). */
  async isReferencedByParts(id: number): Promise<boolean> {
    const knex = db("erp");
    const hasParts = await knex.schema.hasTable("parts");
    if (!hasParts) return false;
    const row = await knex("parts")
      .where("productionRouteId", id)
      .select("id")
      .first();
    return !!row;
  }

  // ── Clone / copy-stages (Clonar / CopiarEtapas) ───────────────────────────

  /** Clonar(): full copy; isDefault forced false. */
  async clone(sourceId: number, name: string): Promise<IProductionRoute> {
    const knex = db("erp");
    const source = await knex(this.tableName).where("id", sourceId).first();
    if (!source) throw new Error("Source route not found");
    const stages = await this.loadStagesForCopy(sourceId);
    return this.create({
      companyId: source.companyId,
      name,
      isGlobal: source.isGlobal,
      active: source.active,
      isDefault: false,
      stages,
    });
  }

  /** CopiarEtapas(src): clear own stages, deep-copy the source's. */
  async copyStages(targetId: number, sourceId: number): Promise<void> {
    const knex = db("erp");
    const stages = await this.loadStagesForCopy(sourceId);
    await knex.transaction(async (trx) => {
      await trx("production_route_stages").where("routeId", targetId).delete();
      await this.insertStages(trx, targetId, stages);
      await trx(this.tableName)
        .where("id", targetId)
        .update({ updatedAt: trx.fn.now() });
    });
  }

  /** Raw stage tree with numeric ids, ready for insertStages. */
  private async loadStagesForCopy(routeId: number): Promise<IRouteStage[]> {
    const knex = db("erp");
    const stages = await knex("production_route_stages")
      .where("routeId", routeId)
      .orderBy("number", "asc");
    const stageIds = stages.map((s: any) => s.id);
    const machines = stageIds.length
      ? await knex("production_route_stage_machines").whereIn(
          "stageId",
          stageIds,
        )
      : [];
    const supplies = stageIds.length
      ? await knex("production_route_stage_supplies")
          .whereIn("stageId", stageIds)
          .orderBy("position", "asc")
      : [];
    return stages.map((stage: any) => ({
      number: stage.number,
      description: stage.description,
      isCorrugation: stage.isCorrugation,
      setupTimeMinutes: parseFloat(stage.setupTimeMinutes) || 0,
      machineTypeId: stage.machineTypeId,
      machines: machines
        .filter((m: any) => m.stageId === stage.id)
        .map((m: any) => ({ machineId: m.machineId, isPrimary: m.isPrimary })),
      supplies: supplies
        .filter((s: any) => s.stageId === stage.id)
        .map((s: any) => ({
          direction: s.direction,
          supplyType: s.supplyType,
          supplyId: s.supplyId,
          quantity: s.quantity != null ? parseFloat(s.quantity) : null,
          quantityType: s.quantityType,
          repetitionsWidth: parseFloat(s.repetitionsWidth),
          repetitionsLength: parseFloat(s.repetitionsLength),
          allowsSimilar: s.allowsSimilar,
          notes: s.notes,
        })),
    }));
  }

  async nameExists(companyId: number, name: string): Promise<boolean> {
    const knex = db("erp");
    const row = await knex(this.tableName)
      .where({ companyId, name })
      .select("id")
      .first();
    return !!row;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IProductionRoute>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(
      `${this.tableName}.*`,
      knex.raw(
        `(select count(*) from production_route_stages st where st."routeId" = ${this.tableName}.id) as "stageCount"`,
      ),
    );
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => ({
        ...this.mapRoute(row),
        stageCount: parseInt(row.stageCount, 10) || 0,
      })),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapRoute(record: any): IProductionRoute {
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      name: record.name,
      isGlobal: record.isGlobal,
      active: record.active,
      isDefault: record.isDefault,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
