import type { Knex } from "knex";

/**
 * db-per-company T6 (model D-7, D-49) — `tenant_migration_runs`: the fleet
 * migration log. Writes live on `tenant-database.dao.ts`
 * (`startMigrationRun`/`finishMigrationRun`), not a third DAO.
 *
 * `ON DELETE CASCADE` from `tenant_databases` (L-006, stated once): a run log
 * is detail *of* a tenant database, meaningless once the registry row itself
 * is gone, unlike `tenant_databases` → `companies`/`db_servers`, which RESTRICT.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tenant_migration_runs", (table) => {
    table.bigIncrements("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("tenantDatabaseId")
      .notNullable()
      .references("id")
      .inTable("tenant_databases")
      .onDelete("CASCADE");
    table.text("fromVersion");
    table.text("toVersion").notNullable();
    table.text("status").notNullable().defaultTo("running");
    table.text("triggeredBy").notNullable();
    table
      .timestamp("startedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp("finishedAt", { useTz: true });
    table.text("error");

    table.check(
      "status IN ('running','succeeded','failed')",
      [],
      "tenant_migration_runs_status_check",
    );
    table.check(
      `(status = 'running') = ("finishedAt" IS NULL)`,
      [],
      "tenant_migration_runs_finished_at_check",
    );
  });

  await knex.raw(
    `CREATE INDEX tenant_migration_runs_tenant_started_idx ON tenant_migration_runs ("tenantDatabaseId", "startedAt" DESC)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DROP INDEX IF EXISTS tenant_migration_runs_tenant_started_idx`,
  );
  await knex.schema.dropTableIfExists("tenant_migration_runs");
}
