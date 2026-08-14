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
import { applyCompanyUuidScope } from "../../utils/daoScope";

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

const ROLE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("roles", {
  filters: ROLE_FILTERS,
  sorting: ROLE_SORTING,
  search: { columns: ["name"], operator: "ILIKE" },
  defaultSort: { column: "name", order: "asc" },
});

export class RoleDAO {
  private tableName = "roles";
  private queryConfig = ROLE_QUERY_CONFIG;

  async create(item: Partial<IRole>): Promise<IRole> {
    const knex = db("core");
    const [row] = await knex(this.tableName).insert(item).returning("*");
    return row as IRole;
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IRole | null> {
    const knex = db("core");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid, "companyId");
    const row = await query.select(`${this.tableName}.*`).first();
    if (!row) return null;

    const grants = await knex("role_permissions")
      .join("permissions", "role_permissions.permissionId", "permissions.id")
      .where("role_permissions.roleId", row.id)
      .select("permissions.code");
    return {
      ...(row as IRole),
      permissionCodes: grants.map((g: any) => g.code),
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

  async delete(id: number): Promise<boolean> {
    const knex = db("core");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  /** Replace a role's grants with the permission rows matching `codes`. */
  async setPermissions(
    roleId: number,
    companyId: number,
    codes: string[],
  ): Promise<string[]> {
    const knex = db("core");
    return knex.transaction(async (trx) => {
      const permissions = codes.length
        ? await trx("permissions")
            .where("companyId", companyId)
            .whereIn("code", codes)
            .select("id", "code")
        : [];
      await trx("role_permissions").where("roleId", roleId).delete();
      if (permissions.length) {
        await trx("role_permissions").insert(
          permissions.map((p: any) => ({
            roleId,
            permissionId: p.id,
            companyId,
          })),
        );
      }
      return permissions.map((p: any) => p.code);
    });
  }

  /** Assign a role to a user (both scoped to the same company). */
  async assignToUser(userId: number, roleId: number | null): Promise<void> {
    const knex = db("core");
    await knex("users").where("id", userId).update({ roleId });
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IRole>> {
    const knex = db("core");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows as IRole[],
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async resolveCompanyId(companyUuid: string): Promise<number | null> {
    return getIdByUuid(companyUuid, "companies");
  }
}
