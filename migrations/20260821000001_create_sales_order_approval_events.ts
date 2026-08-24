import type { Knex } from "knex";

/**
 * sales_order_approval_events — append-only history of every commercial /
 * financial approval action on a pedido (divergence D-4).
 *
 * Procusto keeps only the LAST action in the order's timestamp+user pairs;
 * Mobius already made this exact divergence for Parts
 * (20260721000004_create_parts_tables.ts:219-246) and this table is that shape
 * minus the `unapprove` action value — there is no bulk approve/unapprove path
 * for pedidos, so the only two verbs are `approve` and `cancel`.
 *
 * DELETION (L-006 re-check, mandatory because this adds a NEW cascade):
 * `salesOrderId` is ON DELETE CASCADE while the sibling feature deletes
 * `sales_orders` + `order_data` in one DAO transaction with no cascade between
 * them. Mixed strategies are what L-006 warns about, so the decision is stated
 * here: this table is pure append-only history — no child rows, no side files,
 * no DAO cleanup logic of its own — therefore the DB-level cascade is the WHOLE
 * deletion story for it. `SalesOrderDAO.delete` is deliberately NOT modified
 * and must never grow an events cleanup, which would be the second strategy.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable(
    "sales_order_approval_events",
    function (table) {
      table.increments("id").primary();
      table
        .uuid("uuid")
        .unique()
        .notNullable()
        .defaultTo(knex.raw("gen_random_uuid()"));
      table
        .integer("salesOrderId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("sales_orders")
        .onDelete("CASCADE");
      table.enu("stateMachine", ["commercial", "financial"]).notNullable();
      table.enu("action", ["approve", "cancel"]).notNullable();
      table.text("performedBy");
      table
        .timestamp("performedAt", { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table.index(["salesOrderId", "performedAt"]);
    },
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("sales_order_approval_events");
}
