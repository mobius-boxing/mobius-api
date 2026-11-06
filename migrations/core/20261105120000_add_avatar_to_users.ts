import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.uuid("avatarUuid").nullable();
    table.text("avatarContentType").nullable();
  });
  await knex.raw(
    `CREATE UNIQUE INDEX "users_avatarUuid_unique" ON "users" ("avatarUuid") WHERE "avatarUuid" IS NOT NULL`,
  );
  await knex.raw(
    `ALTER TABLE "users" ADD CONSTRAINT "users_avatar_pair_check" CHECK (("avatarUuid" IS NULL) = ("avatarContentType" IS NULL))`,
  );
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
