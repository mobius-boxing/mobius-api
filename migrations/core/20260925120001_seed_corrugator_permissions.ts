// ts-node compiles migrations without the project's `include`, so the global
// `Express.Request.user` augmentation is not in the program and the transitive
// import of `src/database/audit-context.ts` (rbac.service -> registry) fails to
// type-check. Referencing the declaration file explicitly puts it back.
/// <reference path="../../src/types.d.ts" />
import type { Knex } from "knex";
import { RbacService } from "../../src/services/rbac.service";

/**
 * Backfill the `corrugator.plan` / `corrugator.plan.readonly` /
 * `corrugator.register` gates added to MOBIUS_ADDED_PERMISSIONS
 * (corrugator-planning T2, model.md D-1).
 *
 * The catalogue is cloned per company (Model B), so a new code has to be handed
 * to every existing company — new companies get it at provisioning. Re-running
 * seedCompanyRbac is safe: every insert is onConflict-ignore, and it also grants
 * the new codes to each company's protected Admin role.
 *
 * DEPLOY ORDER: this migration must reach an environment BEFORE
 * `/corrugator-plans`' `requirePermission("corrugator.plan", ...)` does, same
 * reasoning as `20260914100001_seed_devices_approve_permission.ts`.
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
        SELECT id FROM permissions
         WHERE code IN ('corrugator.plan', 'corrugator.plan.readonly', 'corrugator.register')
      )`,
  );
  await knex.raw(
    `DELETE FROM permissions
      WHERE code IN ('corrugator.plan', 'corrugator.plan.readonly', 'corrugator.register')`,
  );
}
