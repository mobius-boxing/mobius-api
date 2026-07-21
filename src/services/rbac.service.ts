import type { Knex } from "knex";
import KnexManager from "../database/KnexConnection";
import {
  PERMISSION_CONCEPTS,
  MOBIUS_ADDED_PERMISSIONS,
  PROCUSTO_PROFILE_TEMPLATES,
  ADMIN_ROLE_NAME,
} from "../common/constants/permissions-catalog";

/**
 * RBAC seeding + permission resolution.
 *
 * Model B (decided, 02/07-mobius-mapping.md §5): the permission catalogue is
 * cloned per company at provisioning. Seeded per company:
 *  - 136 concepts × 2 rows (RW + `.readonly`) + 5 Mobius-added action gates
 *  - a protected `Admin` role granted every RW permission
 *  - the 15 live Procusto profiles as starter roles (grants come from ETL later)
 *
 * Also the runtime lookup used by requirePermission: users.roleId →
 * role_permissions → permissions.code.
 */
export class RbacService {
  /**
   * Idempotent per-company seed — safe to re-run (onConflict ignore).
   * Call inside company provisioning and from the backfill migration.
   */
  static async seedCompanyRbac(knex: Knex, companyId: number): Promise<void> {
    // 1. Permission catalogue (RW + RO variants, then Mobius-added RW-only).
    const permissionRows: any[] = [];
    for (const concept of PERMISSION_CONCEPTS) {
      permissionRows.push({
        companyId,
        code: concept.code,
        name: concept.name,
        description: concept.description,
        readOnly: false,
        associatedForms: concept.forms ?? null,
        area: concept.area,
        deprecated: concept.deprecated ?? false,
      });
      permissionRows.push({
        companyId,
        code: `${concept.code}.readonly`,
        name: concept.name,
        description: `${concept.description} (sólo lectura)`,
        readOnly: true,
        associatedForms: concept.forms ?? null,
        area: concept.area,
        deprecated: concept.deprecated ?? false,
      });
    }
    for (const added of MOBIUS_ADDED_PERMISSIONS) {
      permissionRows.push({
        companyId,
        code: added.code,
        name: added.name,
        description: added.description,
        readOnly: false,
        associatedForms: null,
        area: added.area,
        deprecated: false,
      });
    }
    await knex("permissions")
      .insert(permissionRows)
      .onConflict(["companyId", "code"])
      .ignore();

    // 2. Protected Admin role with every RW permission (mirrors Procusto's
    //    "new permission auto-granted to all profiles" for the admin case).
    await knex("roles")
      .insert({
        companyId,
        name: ADMIN_ROLE_NAME,
        profileType: "general",
        hasAccessToAllMachines: true,
        isProtected: true,
      })
      .onConflict(["companyId", "name"])
      .ignore();
    const adminRole = await knex("roles")
      .where({ companyId, name: ADMIN_ROLE_NAME })
      .first();

    const rwPermissions = await knex("permissions")
      .where({ companyId, readOnly: false })
      .select("id");
    if (adminRole && rwPermissions.length) {
      await knex("role_permissions")
        .insert(
          rwPermissions.map((p: any) => ({
            roleId: adminRole.id,
            permissionId: p.id,
            companyId,
          })),
        )
        .onConflict(["roleId", "permissionId"])
        .ignore();
    }

    // 3. The 15 live Procusto profiles as starter roles (empty grants — the
    //    real PerfilPermiso rows arrive with ETL; admins can grant meanwhile).
    await knex("roles")
      .insert(
        PROCUSTO_PROFILE_TEMPLATES.map((p) => ({
          companyId,
          name: p.name,
          profileType: p.profileType,
          hasAccessToAllMachines: true,
          isProtected: false,
          legacyId: p.legacyId,
        })),
      )
      .onConflict(["companyId", "name"])
      .ignore();
  }

  /**
   * Authorization state for the permission gate: whether the user has a role
   * assigned at all (drives the legacy-enum fallback) and their granted codes.
   * One targeted query on users (the DAO's mapToInterface drops roleId, so the
   * middleware must NOT rely on UserDAO for this).
   */
  static async authzForUserUuid(
    userUuid: string,
  ): Promise<{ hasRole: boolean; codes: string[] }> {
    const knex = KnexManager.getConnection();
    const user = await knex("users")
      .where("uuid", userUuid)
      .select("roleId")
      .first();
    if (!user?.roleId) return { hasRole: false, codes: [] };
    const rows = await knex("role_permissions")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("role_permissions.roleId", user.roleId)
      .select("permissions.code");
    return { hasRole: true, codes: rows.map((r: any) => r.code) };
  }

  /**
   * THE permission decision — single source for the superAdmin bypass, the
   * legacy roleless-admin fallback, and the `.readonly` variant. Both the
   * requirePermission middleware and any controller-level check MUST route
   * through here; never inline these semantics elsewhere.
   */
  static isAllowed(
    role: string | undefined,
    hasRole: boolean,
    codes: string[],
    code: string,
    options?: { allowReadOnly?: boolean },
  ): boolean {
    if (role === "superAdmin") return true;
    if (!hasRole) return role === "admin"; // transition fallback (02/08-migration)
    return (
      codes.includes(code) ||
      (options?.allowReadOnly === true && codes.includes(`${code}.readonly`))
    );
  }

  /** Uncached convenience: fetch authz then decide (controller-level checks). */
  static async userHasPermission(
    userUuid: string,
    role: string | undefined,
    code: string,
    options?: { allowReadOnly?: boolean },
  ): Promise<boolean> {
    if (role === "superAdmin") return true;
    const authz = await this.authzForUserUuid(userUuid);
    return this.isAllowed(role, authz.hasRole, authz.codes, code, options);
  }

  /** Permission codes for a user (by users.id). Empty when the user has no role. */
  static async permissionCodesForUser(userId: number): Promise<string[]> {
    const knex = KnexManager.getConnection();
    const rows = await knex("users")
      .join("role_permissions", "users.roleId", "role_permissions.roleId")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("users.id", userId)
      .select("permissions.code");
    return rows.map((r: any) => r.code);
  }

  /** Same lookup by user uuid (what the JWT carries). */
  static async permissionCodesForUserUuid(userUuid: string): Promise<string[]> {
    const knex = KnexManager.getConnection();
    const rows = await knex("users")
      .join("role_permissions", "users.roleId", "role_permissions.roleId")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("users.uuid", userUuid)
      .select("permissions.code");
    return rows.map((r: any) => r.code);
  }
}
