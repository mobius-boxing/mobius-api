import type { Knex } from "knex";

/**
 * remove-composite-products, RBAC half (model.md D-7, C-2, C-13). Nothing
 * syncs the catalogue at runtime (`RbacService` seeds only at provisioning),
 * so the retired `parts.*` codes are removed here.
 *
 * Grants are merged per company before the codes go. Only the final part
 * approval (and its bulk form) maps to `products.approve.technical`, because
 * that pair now gates production-order release (V4); dimension, technical and
 * sketch approvers are dropped without a target rather than promoted.
 */
const MERGES: readonly [string, string][] = [
  ["parts.edit", "products.edit"],
  ["parts.edit.readonly", "products.edit.readonly"],
  ["parts.approve.part", "products.approve.technical"],
  ["parts.approve.bulk", "products.approve.technical"],
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("role_permissions"))) return;

  for (const [source, target] of MERGES) {
    const merged = await knex.raw(
      `INSERT INTO role_permissions ("roleId", "permissionId", "companyId")
       SELECT rp."roleId", tgt.id, rp."companyId"
       FROM role_permissions rp
       JOIN permissions src ON src.id = rp."permissionId" AND src.code = ?
       JOIN permissions tgt ON tgt."companyId" = src."companyId" AND tgt.code = ?
       ON CONFLICT ("roleId", "permissionId") DO NOTHING
       RETURNING "companyId"`,
      [source, target],
    );
    const perCompany: Record<string, number> = {};
    for (const row of merged.rows as { companyId: number }[]) {
      perCompany[row.companyId] = (perCompany[row.companyId] ?? 0) + 1;
    }
    console.log(
      JSON.stringify({ rbacMerge: `${source} -> ${target}`, perCompany }),
    );
  }

  const unpromoted = await knex.raw(
    `SELECT p."companyId", r.name AS role, p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp."permissionId"
     JOIN roles r ON r.id = rp."roleId"
     WHERE p.code LIKE 'parts.%'
       AND p.code NOT IN (${MERGES.map(() => "?").join(", ")})
     ORDER BY 1, 2, 3`,
    MERGES.map(([source]) => source),
  );
  for (const row of unpromoted.rows) {
    console.log(JSON.stringify({ rbacDropped: row }));
  }

  await knex("permissions").where("code", "like", "parts.%").delete();
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
