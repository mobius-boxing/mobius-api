import type { Knex } from "knex";

/**
 * Role-management invariants as one small pure-ish service: the ceiling
 * rule, the own-role rule, the last-Admin rule (DB-backed, needs a
 * `companies` row lock) and the system-role/role-in-use rules.
 *
 * Every check throws `RolePolicyError` on violation; callers catch it once at
 * the controller boundary and translate `{code, status}` into the response.
 * superAdmin is exempt from the ceiling and own-role rules (those are
 * authorization checks); it is NOT exempt from last-Admin/system-role/
 * role-in-use, which protect data integrity rather than authorization.
 */

export type RolePolicyErrorCode =
  | "GRANT_CEILING"
  | "OWN_ROLE"
  | "LAST_ADMIN"
  | "SYSTEM_ROLE"
  | "ROLE_IN_USE"
  | "UNKNOWN_PERMISSION";

const STATUS_BY_CODE: Record<RolePolicyErrorCode, number> = {
  GRANT_CEILING: 403,
  OWN_ROLE: 403,
  LAST_ADMIN: 409,
  SYSTEM_ROLE: 409,
  ROLE_IN_USE: 409,
  UNKNOWN_PERMISSION: 400,
};

export class RolePolicyError extends Error {
  readonly code: RolePolicyErrorCode;
  readonly status: number;

  constructor(code: RolePolicyErrorCode, message: string) {
    super(message);
    this.name = "RolePolicyError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export class RolePolicyService {
  /**
   * Ceiling rule: `targetCodes` must be a subset of `actorCodes`. On a grant
   * edit, callers pass only the codes that moved (added ∪ removed); on an
   * assignment, callers pass the whole role's codes.
   */
  static assertCeiling(
    actorRole: string | undefined,
    actorCodes: string[],
    targetCodes: string[],
  ): void {
    if (actorRole === "superAdmin") return;
    const actorSet = new Set(actorCodes);
    const outside = targetCodes.filter((code) => !actorSet.has(code));
    if (outside.length > 0) {
      throw new RolePolicyError(
        "GRANT_CEILING",
        `Cannot grant or assign codes outside your own: ${outside.join(", ")}`,
      );
    }
  }

  /** Nobody edits their own role or their own assignment. */
  static assertNotOwnRole(
    actorRole: string | undefined,
    actorUserId: number,
    targetUserId: number,
  ): void {
    if (actorRole === "superAdmin") return;
    if (actorUserId === targetUserId) {
      throw new RolePolicyError(
        "OWN_ROLE",
        "You cannot modify your own role or assignment.",
      );
    }
  }

  /** 400 UNKNOWN_PERMISSION for any code outside the company's catalogue. */
  static assertKnownCodes(codes: string[], catalogueCodes: Set<string>): void {
    const unknown = codes.filter((code) => !catalogueCodes.has(code));
    if (unknown.length > 0) {
      throw new RolePolicyError(
        "UNKNOWN_PERMISSION",
        `Unknown permission code(s): ${unknown.join(", ")}`,
      );
    }
  }

  /** A system role (`systemKey` set) cannot be renamed, deleted, or (for Admin) re-granted. */
  static assertNotSystemRole(
    role: { systemKey?: string | null },
    action: string,
  ): void {
    if (role.systemKey) {
      throw new RolePolicyError(
        "SYSTEM_ROLE",
        `Cannot ${action} a system role.`,
      );
    }
  }

  /** A role referenced by a user or a pending invitation cannot be deleted. */
  static async assertNotInUse(trx: Knex, roleId: number): Promise<void> {
    const userRow = await trx("users")
      .where("roleId", roleId)
      .count("* as count")
      .first();
    if ((parseInt(userRow?.count as string, 10) || 0) > 0) {
      throw new RolePolicyError(
        "ROLE_IN_USE",
        "This role is assigned to at least one user.",
      );
    }
    const inviteRow = await trx("invitations")
      .where("roleId", roleId)
      .where("isUsed", false)
      .where("expiresAt", ">", trx.fn.now())
      .count("* as count")
      .first();
    if ((parseInt(inviteRow?.count as string, 10) || 0) > 0) {
      throw new RolePolicyError(
        "ROLE_IN_USE",
        "This role has pending invitations.",
      );
    }
  }

  /**
   * A company always keeps at least one active user on its Admin role.
   * Locks the `companies` row for the rest of the caller's transaction so two
   * concurrent last-admin changes cannot both read "2 active admins" and both
   * proceed. `isTargetActiveAdmin` is true when the row being changed is
   * currently an ACTIVE user whose role's `systemKey` is `'admin'`; callers
   * that are not touching an active Admin should not call this at all.
   */
  static async assertNotLastAdmin(
    trx: Knex,
    companyId: number,
    isTargetActiveAdmin: boolean,
  ): Promise<void> {
    if (!isTargetActiveAdmin) return;
    await trx("companies").where("id", companyId).forUpdate().first();
    const row = await trx("users")
      .where({ companyId, role: "admin", isActive: true })
      .count("* as count")
      .first();
    const activeAdmins = parseInt(row?.count as string, 10) || 0;
    if (activeAdmins <= 1) {
      throw new RolePolicyError(
        "LAST_ADMIN",
        "Cannot remove the company's last active Admin.",
      );
    }
  }
}
