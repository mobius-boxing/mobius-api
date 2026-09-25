/**
 * corrugator-planning schema (docs/dev/corrugator-planning/model.md
 * §Persistence + Amendments D-5/D-23). Shared by the tenant migration and its
 * core mirror (pattern: `parts-fold.ts` /
 * `20260916120000_fold_parts_into_products_expand.ts`).
 *
 * Expand-only, one deploy: every new table is created from scratch and the
 * six `machines` columns are additive with `DEFAULT 0`, so there is no
 * backfill step and no companion contract migration. Each function still
 * guards on its own `hasColumn`/`hasTable` so re-running the migration body
 * (core mirror against a database that already has it) is a no-op.
 */
import type { Knex } from "knex";
import { attachAudit } from "./audit-triggers";

/** Amendment D-5 (revised): six `Factible`/`Imposible` limits, 0 = unlimited. */
const MACHINE_COLUMNS: readonly [string, "double" | "integer"][] = [
  ["trim", "double"], // mm · Corrugadora.Refile
  ["maxElements", "integer"], // Elementos
  ["tableCount", "integer"], // Mesas
  ["formatsPerTable", "integer"], // FormatosPorMesa
  ["ordersPerFormat", "integer"], // PedidosPorFormato
  ["ordersPerTable", "integer"], // PedidosPorMesa
];

export async function addMachineColumns(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("machines", "trim")) return;
  await knex.schema.alterTable("machines", (table) => {
    for (const [name, type] of MACHINE_COLUMNS) {
      if (type === "double") {
        table.double(name).notNullable().defaultTo(0);
      } else {
        table.integer(name).notNullable().defaultTo(0);
      }
    }
  });
}

/** `id`/`uuid`/`companyId` — every new table's identity columns (existing convention). */
function idColumns(knex: Knex, table: Knex.CreateTableBuilder): void {
  table.increments("id").primary();
  table
    .uuid("uuid")
    .unique()
    .notNullable()
    .defaultTo(knex.raw("gen_random_uuid()"));
  // U-5 / Amendment C-3: tenant DBs never have a local `companies` table
  // (db-per-company split) — every existing tenant table's `companyId` is a
  // plain indexed integer, not an FK, and that convention is shared as-is by
  // the core mirror rather than diverging per plane.
  table.integer("companyId").unsigned().notNullable();
  table.index(["companyId"]);
}

function withTimestamps(knex: Knex, table: Knex.CreateTableBuilder): void {
  table
    .timestamp("createdAt", { useTz: true })
    .notNullable()
    .defaultTo(knex.fn.now());
  table
    .timestamp("updatedAt", { useTz: true })
    .notNullable()
    .defaultTo(knex.fn.now());
}

export async function createCorrugatorPlansTable(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("corrugator_plans")) {
    await attachAudit(knex, "corrugator_plans");
    return;
  }
  await knex.schema.createTable("corrugator_plans", (table) => {
    idColumns(knex, table);
    table.integer("number").notNullable();
    table.text("name");
    table.text("notes");
    table.text("status").notNullable().defaultTo("draft");
    table.jsonb("board").notNullable();
    table.jsonb("machines").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb("parameters").notNullable();
    table.uuid("solveToken");
    table.timestamp("solveStartedAt", { useTz: true });
    table.timestamp("solveFinishedAt", { useTz: true });
    table.text("solveStatus");
    // Amendment C-8: counts/status only, truncated to 20 000 chars by the writer.
    table.text("solveLog");
    table.integer("combinationsGenerated");
    table.timestamp("registeredAt", { useTz: true });
    table.text("registeredByUser");
    table.text("createdByUser");
    withTimestamps(knex, table);

    table.unique(["companyId", "number"]);
    table.index(["companyId", "status"]);
  });
  await attachAudit(knex, "corrugator_plans");
}

export async function createCorrugatorPlanOrdersTable(
  knex: Knex,
): Promise<void> {
  if (await knex.schema.hasTable("corrugator_plan_orders")) {
    await attachAudit(knex, "corrugator_plan_orders", {
      parent: { parent: "corrugator_plans", fk: "planId" },
    });
    return;
  }
  await knex.schema.createTable("corrugator_plan_orders", (table) => {
    idColumns(knex, table);
    table
      .integer("planId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("corrugator_plans")
      .onDelete("CASCADE");
    // D-20: RESTRICT — a registered programme must never lose its order.
    table
      .integer("productionOrderId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("production_orders")
      .onDelete("RESTRICT");
    table.integer("position").notNullable();
    table.text("number").notNullable();
    table.text("customerName");
    table.text("productCode");
    table.text("productDescription");
    table.timestamp("deliveryDate", { useTz: true });
    table.double("sheetLength").notNullable();
    table.double("sheetWidth").notNullable();
    table.boolean("allowsRotation").notNullable().defaultTo(false);
    table.integer("scoreLineCount").notNullable().defaultTo(0);
    table.double("orderQuantity").notNullable();
    table.double("sheetsPerUnit").notNullable().defaultTo(1);
    table.text("sheetsSource").notNullable();
    table.double("requiredSheets").notNullable();
    table.integer("pendingSheets").notNullable();
    table.integer("requestedSheets").notNullable();
    table.double("underrunPercentage").notNullable().defaultTo(0);
    table.double("overrunPercentage").notNullable().defaultTo(0);
    table.text("priority").notNullable().defaultTo("normal");
    table.boolean("partialProduction").notNullable().defaultTo(true);
    // D-8: the allocation ledger — NULL unless the plan is registered (I-11).
    table.integer("allocatedSheets");
    withTimestamps(knex, table);

    table.index(["planId"]);
    table.index(["productionOrderId"]);
    table.unique(["planId", "productionOrderId"]);
    table.unique(["planId", "position"]);
  });
  await attachAudit(knex, "corrugator_plan_orders", {
    parent: { parent: "corrugator_plans", fk: "planId" },
  });
}

export async function createCorrugatorPlanCombinationsTable(
  knex: Knex,
): Promise<void> {
  if (await knex.schema.hasTable("corrugator_plan_combinations")) {
    await attachAudit(knex, "corrugator_plan_combinations", {
      parent: { parent: "corrugator_plans", fk: "planId" },
    });
    return;
  }
  await knex.schema.createTable("corrugator_plan_combinations", (table) => {
    idColumns(knex, table);
    table
      .integer("planId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("corrugator_plans")
      .onDelete("CASCADE");
    // Amendment D-23: TEXT `"<machineUuid>:<width>"`, not the plain machine uuid.
    table.text("machineKey").notNullable();
    table.integer("sequence").notNullable();
    table.double("meters").notNullable().defaultTo(0);
    withTimestamps(knex, table);

    table.index(["planId"]);
    table.unique(["planId", "machineKey", "sequence"]);
  });
  await attachAudit(knex, "corrugator_plan_combinations", {
    parent: { parent: "corrugator_plans", fk: "planId" },
  });
}

export async function createCorrugatorPlanItemsTable(
  knex: Knex,
): Promise<void> {
  if (await knex.schema.hasTable("corrugator_plan_items")) {
    await attachAudit(knex, "corrugator_plan_items", {
      parent: {
        parent: "corrugator_plan_combinations",
        fk: "combinationId",
        grand: "corrugator_plans",
        grandFk: "planId",
      },
    });
    return;
  }
  await knex.schema.createTable("corrugator_plan_items", (table) => {
    idColumns(knex, table);
    table
      .integer("combinationId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("corrugator_plan_combinations")
      .onDelete("CASCADE");
    // D-30 (post-approval): CASCADE, not RESTRICT — I-6 always deletes every
    // combination before a line can be removed, so this FK never blocks a
    // real delete; CASCADE just avoids a needless ordering dependency in the
    // line-delete DAO code.
    table
      .integer("planOrderId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("corrugator_plan_orders")
      .onDelete("CASCADE");
    table.integer("position").notNullable();
    table.integer("count").notNullable();
    table.boolean("rotated").notNullable().defaultTo(false);
    withTimestamps(knex, table);

    table.index(["combinationId"]);
    table.unique(["combinationId", "position"]);
  });
  await attachAudit(knex, "corrugator_plan_items", {
    parent: {
      parent: "corrugator_plan_combinations",
      fk: "combinationId",
      grand: "corrugator_plans",
      grandFk: "planId",
    },
  });
}

export async function up(knex: Knex): Promise<void> {
  await addMachineColumns(knex);
  await createCorrugatorPlansTable(knex);
  await createCorrugatorPlanOrdersTable(knex);
  await createCorrugatorPlanCombinationsTable(knex);
  await createCorrugatorPlanItemsTable(knex);
}
