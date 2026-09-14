// ts-node compiles migrations without the project's `include`, so the global
// `Express.Request.user` augmentation is not in the program and the transitive
// import of `src/database/audit-context.ts` (rbac.service -> registry) fails to
// type-check. Referencing the declaration file explicitly puts it back.
/// <reference path="../../src/types.d.ts" />
import type { Knex } from "knex";
import { RbacService } from "../../src/services/rbac.service";

/**
 * Backfill the `devices.approve` gate added to MOBIUS_ADDED_PERMISSIONS
 * (device approval, T1).
 *
 * The catalogue is cloned per company (Model B), so a new code has to be handed
 * to every existing company — new companies get it at provisioning through the
 * same `seedCompanyRbac`. Re-running is a no-op: every insert is
 * onConflict-ignore, and the call also grants the new code to each company's
 * protected Admin role.
 *
 * DEPLOY ORDER: this must reach an environment BEFORE `/devices`'
 * `requirePermission("devices.approve")` does. Containers swap ~30 s before
 * migrations run, and while the code does not exist every caller that is neither
 * a superAdmin nor a legacy `role='admin'` with a null `roleId` gets a 403 on the
 * approve route — which, until a member has a pending device, nobody calls.
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
      WHERE "permissionId" IN (
        SELECT id FROM permissions WHERE code = 'devices.approve'
      )`,
  );
  await knex.raw(`DELETE FROM permissions WHERE code = 'devices.approve'`);
}
