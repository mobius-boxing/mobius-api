import { Request } from "express";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import { IPermission } from "../../interfaces/role/role.interfaces";
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

const PERMISSION_FILTERS: FilterConfigs = {
  code: { column: "code", operator: "ILIKE" },
  area: { column: "area", operator: "=" },
  readOnly: {
    column: "readOnly",
    operator: "=",
    transform: (v: string) => v === "true",
  },
  deprecated: {
    column: "deprecated",
    operator: "=",
    transform: (v: string) => v === "true",
  },
};

const PERMISSION_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  area: { column: "area" },
};

const PERMISSION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "permissions",
  {
    filters: PERMISSION_FILTERS,
    sorting: PERMISSION_SORTING,
    search: { columns: ["code", "name", "description"], operator: "ILIKE" },
    defaultSort: { column: "code", order: "asc" },
  },
);

/** Read-only catalogue access — the catalogue itself is seeded, never edited via API. */
export class PermissionDAO {
  private tableName = "permissions";
  private queryConfig = PERMISSION_QUERY_CONFIG;

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPermission>> {
    const knex = KnexManager.getConnection();
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
      data: rows as IPermission[],
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }
}
