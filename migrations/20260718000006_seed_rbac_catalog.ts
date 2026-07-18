import type { Knex } from "knex";
import { RbacService } from "../src/services/rbac.service";
import { ADMIN_ROLE_NAME } from "../src/common/constants/permissions-catalog";

/**
 * Backfill: clone the permission catalogue + Admin role + Procusto profile
 * templates into every existing company, then point legacy admin/superAdmin
 * users at the protected Admin role. Members keep roleId NULL (the middleware
 * dual-reads the legacy enum during the transition — 02/08-migration-notes.md).
 */
export async function up(knex: Knex): Promise<void> {
  const companies = await knex("companies").select("id");
  for (const company of companies) {
    await RbacService.seedCompanyRbac(knex, company.id);
    const adminRole = await knex("roles")
      .where({ companyId: company.id, name: ADMIN_ROLE_NAME })
      .first();
    if (adminRole) {
      await knex("users")
        .where({ companyId: company.id })
        .whereIn("role", ["admin", "superAdmin"])
        .whereNull("roleId")
        .update({ roleId: adminRole.id });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex("users").update({ roleId: null });
  await knex("role_permissions").delete();
  await knex("roles").delete();
  await knex("permissions").delete();
}
