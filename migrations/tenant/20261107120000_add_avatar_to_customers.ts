import type { Knex } from "knex";

const AUDIT_CONTEXT = JSON.stringify({
  source: "migration",
  action: "customers.add_avatar",
});

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("customers", "avatarUuid")) {
    return;
  }
  await knex.raw("select set_config('mobius.audit', ?, true)", [AUDIT_CONTEXT]);

  await knex.schema.alterTable("customers", (table) => {
    table.uuid("avatarUuid").nullable();
    table.text("avatarContentType").nullable();
  });
  await knex.raw(
    `CREATE UNIQUE INDEX "customers_avatarUuid_unique" ON "customers" ("avatarUuid") WHERE "avatarUuid" IS NOT NULL`,
  );
  await knex.raw(
    `ALTER TABLE "customers" ADD CONSTRAINT "customers_avatar_pair_check" CHECK (("avatarUuid" IS NULL) = ("avatarContentType" IS NULL))`,
  );
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
