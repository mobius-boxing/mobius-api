import type { Knex } from "knex";

/**
 * db-per-company T6 (model D-7) — `tenant_databases`: where one company's
 * data lives. Exact columns/CHECKs/indexes per `model.md`.
 *
 * `companyId`/`serverId` are plain FK columns with `ON DELETE RESTRICT`
 * (model I-14, L-006): a tenant's registry row must never disappear as a
 * side effect of deleting the company or the server it sits on — decommission
 * is an explicit, orchestrated delete of this row first.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tenant_databases", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("RESTRICT");
    table
      .integer("serverId")
      .notNullable()
      .references("id")
      .inTable("db_servers")
      .onDelete("RESTRICT");
    table.text("databaseName").notNullable();
    table.text("dbUser").notNullable();
    table.text("credentialRef").notNullable();
    table.binary("credentialCiphertext");
    table.integer("poolMax").notNullable().defaultTo(3);
    table.integer("poolMin").notNullable().defaultTo(0);
    table.text("status").notNullable().defaultTo("provisioning");
    table.text("schemaVersion");
    table.text("migrationState").notNullable().defaultTo("unknown");
    table.timestamp("lastMigrationAt", { useTz: true });
    table.text("lastMigrationError");
    table.timestamp("provisionedAt", { useTz: true });
    table.timestamp("suspendedAt", { useTz: true });
    table.text("suspendReason");
    table
      .timestamp("createdAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp("updatedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["serverId"]);

    const identifierCheck = (column: string): string =>
      `"${column}" ~ '^[a-z][a-z0-9_]{0,62}$'`;
    table.check(
      identifierCheck("databaseName"),
      [],
      "tenant_databases_database_name_format_check",
    );
    table.check(
      identifierCheck("dbUser"),
      [],
      "tenant_databases_db_user_format_check",
    );
    table.check(
      `"credentialRef" ~ '^(env|enc|secretsmanager):'`,
      [],
      "tenant_databases_credential_ref_scheme_check",
    );
    table.check(
      `("credentialRef" LIKE 'enc:%') = ("credentialCiphertext" IS NOT NULL)`,
      [],
      "tenant_databases_credential_ciphertext_check",
    );
    table.check(
      `"poolMax" BETWEEN 1 AND 50`,
      [],
      "tenant_databases_pool_max_check",
    );
    table.check(
      `"poolMin" >= 0 AND "poolMin" <= "poolMax"`,
      [],
      "tenant_databases_pool_min_check",
    );
    table.check(
      "status IN ('provisioning','failed','active','suspended','decommissioning','retired')",
      [],
      "tenant_databases_status_check",
    );
    table.check(
      "\"migrationState\" IN ('unknown','current','behind','running','failed')",
      [],
      "tenant_databases_migration_state_check",
    );
    table.check(
      `(status = 'suspended') = ("suspendedAt" IS NOT NULL)`,
      [],
      "tenant_databases_suspended_at_check",
    );
  });

  // Partial unique indexes (model I-1) — knex's table builder has no partial-index method.
  await knex.raw(
    `CREATE UNIQUE INDEX tenant_databases_company_live_uidx ON tenant_databases ("companyId")
       WHERE status IN ('active','suspended','decommissioning')`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX tenant_databases_company_build_uidx ON tenant_databases ("companyId")
       WHERE status IN ('provisioning','failed')`,
  );
  // Orchestrator T7/D-orch-1: the uniqueness applies only to DEDICATED tenant
  // databases (D-70 names them `tenant_<id>_<slug>`); C1's shared-target rows
  // (`databaseName` = the core database's own name) intentionally share one
  // `(serverId, databaseName)` pair across every company (D-21/D-31) — a
  // bare unique constraint on the pair is incompatible with that by
  // construction. Partial, same name, so nothing downstream needs to know it
  // changed shape.
  await knex.raw(
    `CREATE UNIQUE INDEX tenant_databases_server_database_name_unique ON tenant_databases ("serverId", "databaseName")
       WHERE "databaseName" LIKE 'tenant\\_%'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS tenant_databases_company_live_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_databases_company_build_uidx`);
  await knex.raw(
    `DROP INDEX IF EXISTS tenant_databases_server_database_name_unique`,
  );
  await knex.schema.dropTableIfExists("tenant_databases");
}
