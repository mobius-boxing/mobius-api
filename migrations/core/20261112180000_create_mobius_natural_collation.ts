import type { Knex } from "knex";
import { up as tenantUp } from "../tenant/20261112180000_create_mobius_natural_collation";

// Unconditional, unlike business-table mirrors: core's own lists (users, companies,
// audit logs, devices, files, node-files) sort with the collation too.
export async function up(knex: Knex): Promise<void> {
  await tenantUp(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
