import type { Knex } from "knex";
import { attachAudit } from "../../src/database/audit-triggers";

/**
 * `user_devices` — one row per (user, browser) for the device-approval gate.
 *
 * The trigger is attached here rather than by the v2 audit migration: that one
 * iterates `auditedTablesOf(key)` at *its* run time and has already run, so a
 * table added later carries no trigger until its own migration calls the same
 * helper. `exclude`/`parent` are literal here, not imported from
 * `audit-coverage.ts` (db-per-company T6/D-orch-1, enforced by
 * `migrations-frozen-registry.test.ts`): a core migration must never derive its
 * DDL from a live registry, since a from-scratch replay runs this file before
 * any later track's addition to that registry exists. They must still match
 * `AUDIT_REDACT.user_devices` / `AUDIT_PARENT.user_devices` exactly —
 * `audit-coverage.schema.test.ts` guards that from the application side.
 *
 * The two CHECK constraints buy what the application cannot: a row that claims
 * to be `approved` or `revoked` without the matching timestamp is a failed
 * write, not a row the list has to defend against.
 *
 * `down()` drops the table, and the trigger goes with it. Dev only — production
 * is roll-forward (L-003).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("user_devices", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    // CASCADE is the single deletion strategy for this table (D-6, L-006): a
    // device has no meaning without its user, and no DAO cleanup exists.
    table
      .integer("userId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("tokenHash", 64).notNullable();
    table
      .enu("status", ["pending", "approved", "revoked"])
      .notNullable()
      .defaultTo("pending");
    table.string("userAgent", 512);
    table.string("requestIp", 45);
    table
      .timestamp("requestedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp("approvedAt", { useTz: true });
    // SET NULL (D-7): deleting an admin must not delete the devices they
    // approved; the audit ledger still names the actor.
    table
      .integer("approvedBy")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.timestamp("revokedAt", { useTz: true });
    table
      .integer("revokedBy")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.timestamps(true, true);

    table.unique(["userId", "tokenHash"], {
      indexName: "user_devices_user_id_token_hash_unique",
    });
    table.index(["tokenHash"]);
    table.index(["status"]);
  });

  // `table.timestamps` writes snake_case; the schema is camelCase throughout.
  // Same migration, not a follow-up one: a deploy that applied only the create
  // would leave the API reading columns that do not exist.
  await knex.schema.raw(
    'ALTER TABLE user_devices RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE user_devices RENAME COLUMN updated_at TO "updatedAt"',
  );

  await knex.schema.raw(
    `ALTER TABLE user_devices ADD CONSTRAINT user_devices_approved_at_check
       CHECK (status <> 'approved' OR "approvedAt" IS NOT NULL)`,
  );
  await knex.schema.raw(
    `ALTER TABLE user_devices ADD CONSTRAINT user_devices_revoked_at_check
       CHECK (status <> 'revoked' OR "revokedAt" IS NOT NULL)`,
  );

  await attachAudit(knex, "user_devices", {
    exclude: ["tokenHash"],
    parent: { parent: "users", fk: "userId" },
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_devices");
}
