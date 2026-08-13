import type { Knex } from "knex";

/**
 * `countdown_documents.reminderDays` — the per-document reminder threshold.
 *
 * Reminders used to fire on a fixed 7/3/1/0 escalation shared by every document
 * of every company. From here on a document carries its own threshold and is in
 * scope on every send day where `dueDate - today <= reminderDays`, with no lower
 * bound, so an overdue document keeps being reported until it is resolved.
 *
 * No CHECK constraint (host rule): the 0..365 bounds live in the create/update
 * DTOs, which are the only writers.
 *
 * NOT NULL DEFAULT 7 in a single `ADD COLUMN`: Postgres ≥ 11 materialises the
 * default for every existing row as part of the DDL, so pre-existing documents
 * come out of this migration on the same 7-day front edge they had before. A
 * follow-up UPDATE would be dead code.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("countdown_documents", (table) => {
    table.integer("reminderDays").notNullable().defaultTo(7);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("countdown_documents", (table) => {
    table.dropColumn("reminderDays");
  });
}
