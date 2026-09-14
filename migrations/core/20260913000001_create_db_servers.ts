import type { Knex } from "knex";

/**
 * db-per-company T6 (model D-7) — `db_servers`: where databases can be
 * placed. Exact columns/CHECKs/index per `model.md`'s "New central tables —
 * column detail".
 *
 * The one row every environment needs — the shared container this API
 * already talks to (D-26: `host`/`port` NULL means "same server as core") —
 * is seeded here with `adminUser` NULL (D-32): admin identity is
 * environment-specific and cannot live in a migration, so a later
 * `tenant:register-shared` fills it in where the core role has
 * CREATEDB/CREATEROLE. The row is otherwise identical everywhere, which is
 * the point of D-26.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("db_servers", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.text("name").notNullable().unique();
    table.text("kind").notNullable();
    table.text("host");
    table.integer("port");
    table.text("sslMode").notNullable().defaultTo("disable");
    table.text("adminUser");
    table.text("adminCredentialRef");
    table.binary("adminCredentialCiphertext");
    table.integer("connectionBudget").notNullable();
    table.boolean("isDefaultPlacement").notNullable().defaultTo(false);
    table.text("status").notNullable().defaultTo("active");
    table
      .timestamp("createdAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp("updatedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.check(
      "kind IN ('shared_container','rds','external')",
      [],
      "db_servers_kind_check",
    );
    table.check(
      `"port" IS NULL OR "port" BETWEEN 1 AND 65535`,
      [],
      "db_servers_port_range_check",
    );
    table.check(
      "\"sslMode\" IN ('disable','require','verify-full')",
      [],
      "db_servers_ssl_mode_check",
    );
    table.check(
      `"adminCredentialRef" IS NULL OR "adminCredentialRef" ~ '^(env|enc|secretsmanager):'`,
      [],
      "db_servers_admin_credential_ref_scheme_check",
    );
    // "required iff adminUser set" (model, verbatim) — a true biconditional.
    table.check(
      `("adminUser" IS NULL) = ("adminCredentialRef" IS NULL)`,
      [],
      "db_servers_admin_user_requires_credential_check",
    );
    // COALESCE(..., false), not a bare LIKE: adminCredentialRef is nullable
    // here (unlike tenant_databases.credentialRef), and `NULL = anything` is
    // NULL — which Postgres treats as satisfied regardless of the right-hand
    // side. Without the COALESCE a ciphertext could be smuggled onto a row
    // with no admin credential at all and the CHECK would still pass.
    table.check(
      `(COALESCE("adminCredentialRef" LIKE 'enc:%', false)) = ("adminCredentialCiphertext" IS NOT NULL)`,
      [],
      "db_servers_admin_credential_ciphertext_check",
    );
    table.check(
      `"connectionBudget" > 0`,
      [],
      "db_servers_connection_budget_check",
    );
    table.check(
      "status IN ('active','draining','retired')",
      [],
      "db_servers_status_check",
    );
  });

  // Partial unique index — knex's table builder has no partial-index method.
  await knex.raw(
    `CREATE UNIQUE INDEX db_servers_default_uidx ON db_servers ("isDefaultPlacement") WHERE "isDefaultPlacement"`,
  );

  // D-32: env-relative, so this literal row is correct in every environment.
  await knex("db_servers").insert({
    name: "mobius-postgres (shared)",
    kind: "shared_container",
    host: null,
    port: null,
    sslMode: "disable",
    adminUser: null,
    adminCredentialRef: null,
    adminCredentialCiphertext: null,
    connectionBudget: 30,
    isDefaultPlacement: true,
    status: "active",
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS db_servers_default_uidx`);
  await knex.schema.dropTableIfExists("db_servers");
}
