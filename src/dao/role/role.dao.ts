import { Request } from "express";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IRole } from "../../interfaces/role/role.interfaces";
import {
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type ParsedQuery,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import { diffSets } from "../../utils/setDiff";
import { RolePolicyService } from "../../services/role-policy.service";

const ROLE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  name: { column: "name", operator: "ILIKE" },
  profileType: { column: "profileType", operator: "=" },
};

const ROLE_SORTING: SortConfigs = {
  name: { column: "name" },
  profileType: { column: "profileType" },
  createdAt: { column: "createdAt" },
};

/** A permission resolved from a client-sent code, scoped to one company. */
type PermissionRow = { id: number; code: string };

/** A stored `role_permissions` row, read for the grant diff. */
type GrantRow = { permissionId: number };

const ROLE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("roles", {
  filters: ROLE_FILTERS,
  sorting: ROLE_SORTING,
  search: { columns: ["name"], operator: "ILIKE" },
  defaultSort: { column: "name", order: "asc" },
});

/** `roles.id` -> the permission codes granted to it, batched (avoids N+1). */
const codesByRoleId = async (
  roleIds: number[],
): Promise<Map<number, string[]>> => {
  const map = new Map<number, string[]>();
  if (!roleIds.length) return map;
  const knex = db("core");
  const grants = await knex("role_permissions")
    .join("permissions", "role_permissions.permissionId", "permissions.id")
    .whereIn("role_permissions.roleId", roleIds)
    .select("role_permissions.roleId as roleId", "permissions.code as code");
  for (const grant of grants) {
    const codes = map.get(grant.roleId) ?? [];
    codes.push(grant.code);
    map.set(grant.roleId, codes);
  }
  return map;
};

export class RoleDAO {
  private tableName = "roles";
  private queryConfig = ROLE_QUERY_CONFIG;

  async create(item: Partial<IRole>): Promise<IRole> {
    const knex = db("core");
    const [row] = await knex(this.tableName).insert(item).returning("*");
    return row as IRole;
  }

  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<IRole | null> {
    const knex = db("core");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId, "companyId");
    const row = await query.select(`${this.tableName}.*`).first();
    if (!row) return null;
    return this.withCodesAndCount(row);
  }

  async getById(id: number): Promise<IRole | null> {
    const knex = db("core");
    const row = await knex(this.tableName).where("id", id).first();
    if (!row) return null;
    return this.withCodesAndCount(row);
  }

  /** roleId + isActive + the role's systemKey for a user, in one query (assign's ceiling/last-admin inputs). */
  async currentAssignment(userId: number): Promise<{
    roleId: number | null;
    isActive: boolean;
    systemKey: string | null;
  } | null> {
    const knex = db("core");
    const row = await knex("users")
      .leftJoin("roles", "users.roleId", "roles.id")
      .where("users.id", userId)
      .select(
        "users.roleId as roleId",
        "users.isActive as isActive",
        "roles.systemKey as systemKey",
      )
      .first();
    return row ?? null;
  }

  /** Every permission code seeded for the company — the UNKNOWN_PERMISSION allowlist. */
  async catalogueCodes(companyId: number): Promise<Set<string>> {
    const knex = db("core");
    const rows = await knex("permissions").where({ companyId }).select("code");
    return new Set(rows.map((r: any) => r.code));
  }

  private async withCodesAndCount(row: any): Promise<IRole> {
    const knex = db("core");
    const [grants, userCountRow] = await Promise.all([
      knex("role_permissions")
        .join("permissions", "role_permissions.permissionId", "permissions.id")
        .where("role_permissions.roleId", row.id)
        .select("permissions.code"),
      knex("users").where("roleId", row.id).count("* as count").first(),
    ]);
    return {
      ...(row as IRole),
      permissionCodes: grants.map((g: any) => g.code),
      userCount: parseInt(userCountRow?.count as string, 10) || 0,
    };
  }

  async update(id: number, item: Partial<IRole>): Promise<IRole | null> {
    const knex = db("core");
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update({ ...item, updatedAt: knex.fn.now() })
      .returning("*");
    return (row as IRole) ?? null;
  }

  /** Throws ROLE_IN_USE inside the same transaction that deletes the row. */
  async deleteInUseChecked(id: number): Promise<void> {
    const knex = db("core");
    await knex.transaction(async (trx) => {
      await RolePolicyService.assertNotInUse(trx, id);
      // `invitations.roleId` is FK ON DELETE RESTRICT, so a used or expired
      // invitation still pointing at this role would fail the DELETE below
      // even though it already passed the in-use check (that check only
      // counts pending ones). Detach them first — the role they name no
      // longer exists to look up, but the invitation itself stays a valid
      // historical record.
      await trx("invitations")
        .where("roleId", id)
        .where((qb) =>
          qb.where("isUsed", true).orWhere("expiresAt", "<=", trx.fn.now()),
        )
        .update({ roleId: null });
      await trx(this.tableName).where("id", id).delete();
    });
  }

  /**
   * Writes `users.roleId` + the `users.role` mirror in one transaction,
   * locking the `companies` row first when the change would take an active
   * user off the company's Admin role.
   */
  async assign(params: {
    userId: number;
    companyId: number;
    roleId: number;
    roleSystemKey: string | null;
    leavingActiveAdmin: boolean;
  }): Promise<void> {
    const knex = db("core");
    await knex.transaction(async (trx) => {
      if (params.leavingActiveAdmin) {
        await RolePolicyService.assertNotLastAdmin(trx, params.companyId, true);
      }
      const mirror = params.roleSystemKey === "admin" ? "admin" : "member";
      await trx("users")
        .where("id", params.userId)
        .update({ roleId: params.roleId, role: mirror });
    });
  }

  /**
   * Set a role's grants to exactly the permission rows matching `codes`.
   *
   * `role_permissions` is a pure join table — `(roleId, permissionId,
   * companyId, createdAt)`, no `id`, no `uuid`, nothing updatable — so this is
   * a set diff, not a keyed one: revoked grants leave in one bulk DELETE, new
   * grants arrive in one bulk INSERT, and a grid that did not change writes
   * **nothing at all**. It used to delete every row and reinsert the whole
   * grid, which made saving a role without touching its permissions look, to
   * anything reading the write stream, like the operator had revoked and
   * re-granted everything. Permission grants are the most audit-sensitive
   * write in the system; that noise is exactly what must not reach the ledger.
   *
   * Codes are resolved to ids **before** diffing: identity is the resolved
   * `permissionId`, and a code that does not exist in this company's catalogue
   * is dropped here rather than written. The returned array is the codes that
   * are now granted, whether this call granted them or they were already
   * there — unchanged from the delete-and-reinsert version.
   */
  async setPermissions(
    roleId: number,
    companyId: number,
    codes: string[],
  ): Promise<string[]> {
    const knex = db("core");
    return knex.transaction(async (trx) => {
      const permissions: PermissionRow[] = codes.length
        ? await trx("permissions")
            .where("companyId", companyId)
            .whereIn("code", codes)
            .select("id", "code")
        : [];

      // Scoped by `roleId` alone, exactly like the delete-everything it
      // replaces: a grant row carrying some other `companyId` must still be
      // revoked when it leaves the grid, so the diff has to be able to see it.
      const existing: GrantRow[] = await trx("role_permissions")
        .where("roleId", roleId)
        .select("permissionId");

      const diff = diffSets(permissions, existing, {
        keyOfIncoming: (permission) => String(permission.id),
        keyOfExisting: (grant) => String(grant.permissionId),
      });

      if (diff.deletes.length) {
        await trx("role_permissions")
          .where("roleId", roleId)
          .whereIn(
            "permissionId",
            diff.deletes.map((grant) => grant.permissionId),
          )
          .delete();
      }
      if (diff.inserts.length) {
        await trx("role_permissions").insert(
          diff.inserts.map((permission) => ({
            roleId,
            permissionId: permission.id,
            companyId,
          })),
        );
      }

      return permissions.map((permission) => permission.code);
    });
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IRole>> {
    const knex = db("core");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    applyCompanyScope(dataQuery, this.tableName, companyId);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    applyCompanyScope(countQuery, this.tableName, companyId);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    const roleIds = rows.map((r: any) => r.id);
    const [codes, userCounts] = await Promise.all([
      codesByRoleId(roleIds),
      roleIds.length
        ? knex("users")
            .whereIn("roleId", roleIds)
            .select("roleId")
            .count("* as count")
            .groupBy("roleId")
        : Promise.resolve([]),
    ]);
    const userCountByRole = new Map<number, number>(
      (userCounts as any[]).map((r) => [r.roleId, parseInt(r.count, 10) || 0]),
    );

    return {
      success: true,
      data: rows.map((row: any) => ({
        ...(row as IRole),
        permissionCodes: codes.get(row.id) ?? [],
        userCount: userCountByRole.get(row.id) ?? 0,
      })),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * All of a company's roles with their granted codes attached, filtered to
   * the ones `actorCodes` may assign (ceiling subset rule; `null` = no
   * ceiling, i.e. superAdmin). Small per-company N — filtered in memory
   * rather than as a SQL set-subset query, then paginated by the caller.
   */
  async getAssignableRoles(
    companyId: number,
    actorCodes: string[] | null,
  ): Promise<IRole[]> {
    const knex = db("core");
    const roles = await knex(this.tableName)
      .where({ companyId })
      .orderBy("name", "asc");
    const codes = await codesByRoleId(roles.map((r: any) => r.id));
    const actorSet = actorCodes ? new Set(actorCodes) : null;

    return roles
      .filter((role: any) => {
        if (!actorSet) return true;
        const roleCodes = codes.get(role.id) ?? [];
        return roleCodes.every((code) => actorSet.has(code));
      })
      .map((role: any) => ({
        ...(role as IRole),
        permissionCodes: codes.get(role.id) ?? [],
      }));
  }

  async resolveCompanyId(companyUuid: string): Promise<number | null> {
    return getIdByUuid(companyUuid, "companies");
  }
}
