import { Request } from "express";
import { validate as isUuid } from "uuid";
import { CompanyDAO } from "../dao/company/company.dao";
import { RoleDAO } from "../dao/role/role.dao";
import { RbacService } from "./rbac.service";
import { RolePolicyService } from "./role-policy.service";
import { getCompanyFilterUuid } from "../utils/companyScope";

export type LegacyRole = "member" | "admin" | "superAdmin";

// SECURITY (C4): no actor may grant above their own rank (no admin → superAdmin).
export const ROLE_RANK: Record<string, number> = {
  member: 1,
  admin: 2,
  superAdmin: 3,
};

export class UserTargetError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UserTargetError";
    this.status = status;
  }
}

export interface UserTargetInput {
  /** Honoured only for superAdmins: a company uuid, or a numeric id from internal callers. */
  companyId?: unknown;
  roleUuid?: unknown;
  role: LegacyRole;
}

export interface UserTarget {
  companyId: number | undefined;
  roleId: number | null;
  role: LegacyRole;
}

/**
 * The company and role a user being invited or created directly lands with. Invitations and
 * direct creation share it so the two doors into a company apply one rule set (SECURITY C4):
 * non-superAdmins are locked to their JWT company and may not grant above their own rank or
 * permission ceiling; superAdmins pick the company.
 *
 * `allowCompanyless`: whether a superAdmin may omit the company for a non-superAdmin target.
 * Invitations refuse it; direct creation has always allowed it.
 *
 * Throws UserTargetError, or RolePolicyError from the ceiling check.
 */
export async function resolveUserTarget(
  req: Request,
  input: UserTargetInput,
  opts: { allowCompanyless: boolean },
): Promise<UserTarget> {
  const actor = req.user;
  if (!actor) throw new UserTargetError(401, "Authentication required");
  const companyDAO = new CompanyDAO();
  const roleDAO = new RoleDAO();

  const actorRank = ROLE_RANK[actor.role] ?? 0;
  const targetRank = ROLE_RANK[input.role] ?? 0;
  if (targetRank > actorRank) {
    throw new UserTargetError(
      403,
      "You cannot grant a user a higher role than your own.",
    );
  }

  let companyId: number | undefined;
  if (actor.role === "superAdmin") {
    const ref = input.companyId;
    if (typeof ref === "number") {
      const company = await companyDAO.getById(ref);
      if (!company || !company.id) {
        throw new UserTargetError(400, "Invalid company ID");
      }
      companyId = company.id;
    } else if (typeof ref === "string" && ref !== "") {
      const company = isUuid(ref) ? await companyDAO.getByUuid(ref) : null;
      if (!company || !company.id) {
        throw new UserTargetError(400, "Invalid company ID");
      }
      companyId = company.id;
    } else if (input.role !== "superAdmin" && !opts.allowCompanyless) {
      throw new UserTargetError(
        400,
        "Company ID is required unless the user is a superAdmin.",
      );
    }
  } else {
    const actorCompanyUuid = getCompanyFilterUuid(req);
    if (!actorCompanyUuid) {
      throw new UserTargetError(
        400,
        "You must belong to a company to add users.",
      );
    }
    const company = await companyDAO.getByUuid(actorCompanyUuid);
    if (!company || !company.id) {
      throw new UserTargetError(400, "Invalid company.");
    }
    companyId = company.id;
  }

  // A legacy client sending only `role` (no `roleUuid`) maps to the company's Admin/Member
  // system role. Same ceiling rule as `/roles/assign` (superAdmin exempt).
  let roleId: number | null = null;
  let role = input.role;
  if (companyId) {
    const roleUuid = input.roleUuid;
    if (roleUuid !== undefined && roleUuid !== null && roleUuid !== "") {
      const found =
        typeof roleUuid === "string" && isUuid(roleUuid)
          ? await roleDAO.getByUuid(roleUuid, companyId)
          : null;
      if (!found || !found.id) {
        throw new UserTargetError(400, "Invalid role");
      }
      if (actor.role !== "superAdmin") {
        const actorCodes = await RbacService.authzForUserUuid(actor.userId);
        RolePolicyService.assertCeiling(
          actor.role,
          actorCodes.codes,
          found.permissionCodes ?? [],
        );
      }
      roleId = found.id;
      role = found.systemKey === "admin" ? "admin" : "member";
    } else {
      roleId = await RbacService.systemRoleId(
        companyId,
        input.role === "admin" ? "admin" : "member",
      );
    }
  }

  return { companyId, roleId, role };
}
