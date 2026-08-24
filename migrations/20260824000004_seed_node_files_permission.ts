import type { Knex } from "knex";
import { RbacService } from "../src/services/rbac.service";

/**
 * Backfill the `node-files.manage` gate added to MOBIUS_ADDED_PERMISSIONS.
 *
 * The catalogue is cloned per company (Model B), so a new code has to be handed
 * to every existing company — new companies get it at provisioning. Re-running
 * seedCompanyRbac is safe: every insert is onConflict-ignore, and it also grants
 * the new code to each company's protected Admin role.
 */
export async function up(knex: Knex): Promise<void> {
  const companies = await knex("companies").select("id");
  for (const company of companies) {
    await RbacService.seedCompanyRbac(knex, company.id);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Grants first: role_permissions references permissions.
  await knex.raw(
    `DELETE FROM role_permissions
      WHERE "permissionId" IN (SELECT id FROM permissions WHERE code = 'node-files.manage')`,
  );
  await knex.raw(`DELETE FROM permissions WHERE code = 'node-files.manage'`);
}
