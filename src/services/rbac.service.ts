import type { Knex } from "knex";
import { db } from "../database/registry";
import {
  PERMISSION_CONCEPTS,
  MOBIUS_ADDED_PERMISSIONS,
  MEMBER_BASELINE_CODES,
  ADMIN_ROLE_NAME,
  MEMBER_ROLE_NAME,
  type IPermissionConcept,
} from "../common/constants/permissions-catalog";

/**
 * RBAC seeding + permission resolution.
 *
 * Model B (decided, 02/07-mobius-mapping.md §5): the permission catalogue is
 * cloned per company at provisioning. Each company is seeded with exactly:
 *  - the pruned catalogue (RW + `.readonly` rows where the concept says so);
 *  - a protected `Admin` role (`systemKey='admin'`) granted every RW code;
 *  - a `Member` role (`systemKey='member'`) granted the baseline codes.
 * No Procusto starter roles are seeded — a company that wants a named,
 * scoped-down role creates one after the fact via the roles API.
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
    const concepts: Array<IPermissionConcept & { defaultReadonly: boolean }> = [
      ...PERMISSION_CONCEPTS.map((c) => ({ ...c, defaultReadonly: true })),
      ...MOBIUS_ADDED_PERMISSIONS.map((c) => ({
        ...c,
        defaultReadonly: false,
      })),
    ];

    // 1. Permission catalogue: one RW row per concept, plus a `.readonly`
    //    sibling when the concept calls for one.
    const permissionRows: any[] = [];
    const rwCodes: string[] = [];
    for (const concept of concepts) {
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
      rwCodes.push(concept.code);
      const seedsReadonly = concept.readonly ?? concept.defaultReadonly;
      if (seedsReadonly) {
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
    }
    await knex("permissions")
      .insert(permissionRows)
      .onConflict(["companyId", "code"])
      .ignore();

    // 2. Protected Admin role — granted every RW code in the catalogue above
    //    (selecting by code, not "every readOnly=false row for this company",
    //    so a not-yet-pruned leftover row is never granted).
    await knex("roles")
      .insert({
        companyId,
        name: ADMIN_ROLE_NAME,
        systemKey: "admin",
        profileType: "general",
        hasAccessToAllMachines: true,
        isProtected: true,
      })
      .onConflict(["companyId", "name"])
      .ignore();
    const adminRole = await knex("roles")
      .where({ companyId, name: ADMIN_ROLE_NAME })
      .first();
    if (adminRole && !adminRole.systemKey) {
      // Existing protected Admin row from before this migration — stamp it.
      await knex("roles")
        .where({ id: adminRole.id })
        .update({ systemKey: "admin" });
    }

    if (adminRole) {
      const rwPermissionRows = await knex("permissions")
        .where({ companyId, readOnly: false })
        .whereIn("code", rwCodes)
        .select("id");
      if (rwPermissionRows.length) {
        await knex("role_permissions")
          .insert(
            rwPermissionRows.map((p: any) => ({
              roleId: adminRole.id,
              permissionId: p.id,
              companyId,
            })),
          )
          .onConflict(["roleId", "permissionId"])
          .ignore();
      }
    }

    // 3. Member role — baseline grants only.
    await knex("roles")
      .insert({
        companyId,
        name: MEMBER_ROLE_NAME,
        systemKey: "member",
        profileType: "general",
        hasAccessToAllMachines: true,
        isProtected: false,
      })
      .onConflict(["companyId", "name"])
      .ignore();
    const memberRole = await knex("roles")
      .where({ companyId, name: MEMBER_ROLE_NAME })
      .first();
    if (memberRole) {
      const baselinePermissionRows = await knex("permissions")
        .where({ companyId })
        .whereIn("code", MEMBER_BASELINE_CODES as unknown as string[])
        .select("id");
      if (baselinePermissionRows.length) {
        await knex("role_permissions")
          .insert(
            baselinePermissionRows.map((p: any) => ({
              roleId: memberRole.id,
              permissionId: p.id,
              companyId,
            })),
          )
          .onConflict(["roleId", "permissionId"])
          .ignore();
      }
    }
  }

  /**
   * Authorization state for the permission gate: the caller's granted codes.
   * One targeted query on users (the DAO's mapToInterface drops roleId, so the
   * middleware must NOT rely on UserDAO for this).
   */
  static async authzForUserUuid(
    userUuid: string,
  ): Promise<{ codes: string[] }> {
    const knex = db("core");
    const user = await knex("users")
      .where("uuid", userUuid)
      .select("roleId")
      .first();
    if (!user?.roleId) return { codes: [] };
    const rows = await knex("role_permissions")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("role_permissions.roleId", user.roleId)
      .select("permissions.code");
    return { codes: rows.map((r: any) => r.code) };
  }

  /**
   * THE permission decision — single source for the superAdmin bypass and the
   * `.readonly` variant. Both the requirePermission middleware and any
   * controller-level check MUST route through here; never inline these
   * semantics elsewhere.
   *
   * The legacy roleless-admin fallback (`!hasRole -> role === "admin"`) was
   * removed once the backfill migration put every company user on a role and
   * `rbac.legacy_fallback_allow` logged zero hits for a week: a user with no
   * role now gets no permissions, full stop.
   */
  static isAllowed(
    role: string | undefined,
    codes: string[],
    code: string,
    options?: { allowReadOnly?: boolean },
  ): boolean {
    if (role === "superAdmin") return true;
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
    return this.isAllowed(role, authz.codes, code, options);
  }

  /** Permission codes for a user (by users.id). Empty when the user has no role. */
  static async permissionCodesForUser(userId: number): Promise<string[]> {
    const knex = db("core");
    const rows = await knex("users")
      .join("role_permissions", "users.roleId", "role_permissions.roleId")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("users.id", userId)
      .select("permissions.code");
    return rows.map((r: any) => r.code);
  }

  /** Same lookup by user uuid (what the JWT carries). */
  static async permissionCodesForUserUuid(userUuid: string): Promise<string[]> {
    const knex = db("core");
    const rows = await knex("users")
      .join("role_permissions", "users.roleId", "role_permissions.roleId")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("users.uuid", userUuid)
      .select("permissions.code");
    return rows.map((r: any) => r.code);
  }

  /** `roles.uuid`/`roles.name` for a user's assigned role — null when unassigned. */
  static async roleForUserUuid(
    userUuid: string,
  ): Promise<{ roleUuid: string; roleName: string } | null> {
    const knex = db("core");
    const row = await knex("users")
      .join("roles", "users.roleId", "roles.id")
      .where("users.uuid", userUuid)
      .select("roles.uuid as roleUuid", "roles.name as roleName")
      .first();
    return row ?? null;
  }

  /** `roles.systemKey` for a numeric role id — null for a custom role or a missing one. */
  static async roleSystemKey(roleId: number): Promise<string | null> {
    const knex = db("core");
    const row = await knex("roles")
      .where("id", roleId)
      .select("systemKey")
      .first();
    return row?.systemKey ?? null;
  }

  /** The company's Admin/Member row id, by systemKey. */
  static async systemRoleId(
    companyId: number,
    systemKey: "admin" | "member",
  ): Promise<number | null> {
    const knex = db("core");
    const row = await knex("roles")
      .where({ companyId, systemKey })
      .select("id")
      .first();
    return row?.id ?? null;
  }

  /** `users.role` mirror derived from a role's systemKey — the JWT claim and device-gate exemption still read the enum. */
  static mirrorRoleFor(systemKey: string | null): "admin" | "member" {
    return systemKey === "admin" ? "admin" : "member";
  }
}
