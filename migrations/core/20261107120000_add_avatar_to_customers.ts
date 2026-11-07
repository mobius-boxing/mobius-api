import type { Knex } from "knex";
import { up as tenantUp } from "../tenant/20261107120000_add_avatar_to_customers";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("customers"))) {
    console.log(
      "add_avatar_to_customers: skipped — business tables are not live in this database",
    );
    return;
  }
  await tenantUp(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
