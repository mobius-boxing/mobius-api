import type { Knex } from "knex";

/**
 * Seed the four (role, permission) grants that make the pedido approval codes
 * usable at this customer — divergence D-3.
 *
 * Decision log §K.4 (04-review-findings-and-decisions.md:340-347) left the 15
 * seeded Procusto profiles with EMPTY grants because the real `PerfilPermiso`
 * rows arrive with ETL; §K.6 (:352-355) closes "who can approve" by fiat and
 * lets Mobius define its own approval-gating contract. Without these rows no
 * non-superAdmin could ever approve an order, so the endpoint would be
 * unusable and untestable.
 *
 * OQ-5 (gate decision, 2026-08-20): the seed is ADDITIVE and IDEMPOTENT; the
 * future ETL import is authoritative and may revoke. `up()` never replaces or
 * deletes a pre-existing grant.
 *
 * Rules this migration obeys:
 * - Only the RW permission rows (`readOnly = false`) — never the `.readonly`
 *   twins generated at rbac.service.ts:41-50.
 * - Roles are matched by `(companyId, name)`; a company missing a template role
 *   (or the permission row) SKIPS that pair silently. No role is created here
 *   and `seedCompanyRbac` is deliberately not called.
 * - `Admin` (protected, already holds every RW code), `VENDEDOR` and `VENTAS`
 *   are never touched.
 * - `down()` deletes exactly the four `(roleId, permissionId)` pairs `GRANTS`
 *   resolves — never a blanket delete by permission code, which would strip
 *   Admin's pre-existing grant (`Admin` is not in `GRANTS`, so no rollback ever
 *   touches it). It is NOT limited to the rows `up()` actually wrote: because
 *   `up()` ignores conflicts, a pair granted earlier through the Roles page (or
 *   later by the ETL import) is not re-inserted by `up()` yet IS revoked by
 *   `down()`. Rolling back therefore revokes those four pairs on
 *   GERENTE DE VENTAS / CONTABILIDAD / PRESIDENCIA regardless of who created
 *   them — acceptable only because rollback is a dev-only path: never run
 *   `migrate:rollback` against prod (L-003).
 */
const GRANTS: ReadonlyArray<{ code: string; roles: readonly string[] }> = [
  {
    code: "orders.approve.commercial",
    roles: ["GERENTE DE VENTAS", "PRESIDENCIA"],
  },
  { code: "orders.approve.financial", roles: ["CONTABILIDAD", "PRESIDENCIA"] },
];

type GrantPair = { roleId: number; permissionId: number; companyId: number };

/** Resolve the pairs that exist today; anything unresolved is skipped. */
async function resolvePairs(knex: Knex): Promise<GrantPair[]> {
  const pairs: GrantPair[] = [];
  const companies = await knex("companies").select("id");
  for (const company of companies) {
    for (const grant of GRANTS) {
      const permission = await knex("permissions")
        .where({ companyId: company.id, code: grant.code, readOnly: false })
        .select("id")
        .first();
      if (!permission) continue;
      for (const roleName of grant.roles) {
        const role = await knex("roles")
          .where({ companyId: company.id, name: roleName })
          .select("id")
          .first();
        if (!role) continue;
        pairs.push({
          roleId: role.id,
          permissionId: permission.id,
          companyId: company.id,
        });
      }
    }
  }
  return pairs;
}

export async function up(knex: Knex): Promise<void> {
  const pairs = await resolvePairs(knex);
  if (!pairs.length) return;
  // Conflict target is the real composite PK (20260718000005:98).
  await knex("role_permissions")
    .insert(pairs)
    .onConflict(["roleId", "permissionId"])
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  // Revokes the four resolved pairs whether or not `up()` inserted them (see
  // the header): a pre-existing grant on one of these roles is revoked too.
  const pairs = await resolvePairs(knex);
  for (const pair of pairs) {
    await knex("role_permissions")
      .where({ roleId: pair.roleId, permissionId: pair.permissionId })
      .delete();
  }
}
