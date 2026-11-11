import type { Knex } from "knex";

/**
 * `refresh_sessions` — one row per browser sign-in (refresh-token-sessions D-1).
 *
 * The row holds the hash of the current refresh token and of the one it replaced;
 * the previous hash only matters inside the rotation grace window. `uuid` is the
 * access JWT's `sid` and the raw token's prefix, so a stale token of any age still
 * names its session and can revoke it (A-1).
 *
 * No audit trigger (D-13): a row rotates every few minutes per open browser, and
 * the actions that revoke in bulk are audited on `users` / `user_devices`.
 *
 * `down()` drops the table. Dev only — production is roll-forward (L-003).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("refresh_sessions", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("userId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .integer("deviceId")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("user_devices")
      .onDelete("CASCADE");
    table.string("tokenHash", 64).notNullable().unique();
    table.string("previousTokenHash", 64).nullable();
    table
      .timestamp("rotatedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp("expiresAt", { useTz: true }).notNullable();
    table.timestamp("absoluteExpiresAt", { useTz: true }).notNullable();
    table.timestamp("revokedAt", { useTz: true }).nullable();
    table
      .enu("revokedReason", [
        "logout",
        "reuse",
        "password_change",
        "password_reset",
        "user_deactivated",
        "device_revoked",
        "admin",
      ])
      .nullable();
    table.timestamps(true, true);
    table.index(["userId"]);
    table.index(["deviceId"]);
    table.index(["expiresAt"]);
  });

  // `table.timestamps` writes snake_case; the schema is camelCase throughout.
  await knex.schema.raw(
    'ALTER TABLE refresh_sessions RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE refresh_sessions RENAME COLUMN updated_at TO "updatedAt"',
  );

  await knex.schema.raw(
    `ALTER TABLE refresh_sessions ADD CONSTRAINT refresh_sessions_expiry_check
       CHECK ("expiresAt" <= "absoluteExpiresAt")`,
  );
  await knex.schema.raw(
    `ALTER TABLE refresh_sessions ADD CONSTRAINT refresh_sessions_revoked_check
       CHECK (("revokedAt" IS NULL) = ("revokedReason" IS NULL))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("refresh_sessions");
}
