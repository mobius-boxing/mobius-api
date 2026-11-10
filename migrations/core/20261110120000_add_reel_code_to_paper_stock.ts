import type { Knex } from "knex";
import { up as tenantUp } from "../tenant/20261110120000_add_reel_code_to_paper_stock";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("paper_stock"))) {
    console.log(
      "add_reel_code_to_paper_stock: skipped — business tables are not live in this database",
    );
    return;
  }
  await tenantUp(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
