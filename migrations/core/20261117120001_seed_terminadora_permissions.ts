// See 20260925120001_seed_corrugator_permissions.ts for why this reference exists.
/// <reference path="../../src/types.d.ts" />
import type { Knex } from "knex";
import { RbacService } from "../../src/services/rbac.service";

/**
 * Backfill the seven terminadora-order-flow gates (`quotations.*`,
 * `supplier-orders.*`, `product-stock.view`) added to MOBIUS_ADDED_PERMISSIONS.
 * The catalogue is cloned per company, so existing companies need the rows;
 * seedCompanyRbac is idempotent and also grants them to each protected Admin.
 *
 * DEPLOY ORDER: this migration must reach an environment BEFORE the new
 * routers' `requirePermission` calls do (same reasoning as the corrugator seed).
 */
export async function up(knex: Knex): Promise<void> {
  const companies = await knex("companies").select("id");
  for (const company of companies) {
    await RbacService.seedCompanyRbac(knex, company.id);
  }
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
