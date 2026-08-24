import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IAuditLog } from "../../interfaces/audit-log/audit-log.interfaces";
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

const AUDIT_LOG_FILTERS: FilterConfigs = {
  entityName: { column: "entityName", operator: "=" },
  entityUuid: { column: "entityUuid", operator: "=" },
  operation: { column: "operation", operator: "=" },
  username: { column: "username", operator: "ILIKE" },
};

const AUDIT_LOG_SORTING: SortConfigs = {
  occurredAt: { column: "occurredAt" },
  entityName: { column: "entityName" },
  username: { column: "username" },
};

const AUDIT_LOG_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "audit_logs",
  {
    filters: AUDIT_LOG_FILTERS,
    sorting: AUDIT_LOG_SORTING,
    search: { columns: ["entityCode", "entityDescription"], operator: "ILIKE" },
    defaultSort: { column: "occurredAt", order: "desc" },
  },
);

export class AuditLogDAO {
  /**
   * `audit_logs` is a FANNED-OUT table (D-2 / AC-2): one per database, because
   * the audit write is fire-and-forget, never runs inside a transaction and has
   * no inbound FKs. `ownership.ts` names `erp` its primary owner, so `ownerOf`
   * returns `undefined` and the registry's wrong-database guard cannot arbitrate
   * here — nothing will flag a wrong choice.
   *
   * `db("erp")` below is therefore a PLACEHOLDER, correct only while all four
   * keys resolve to one physical database (state S1). Once they do not, a write
   * must land in the database of the entity it describes and a read must fan out
   * across all four — there is deliberately no cross-module audit view
   * (non-goal 14). Routing belongs to the deletion/audit work, not here.
   */
  private tableName = "audit_logs";
  private queryConfig = AUDIT_LOG_QUERY_CONFIG;

  async insert(item: IAuditLog): Promise<void> {
    const knex = db("erp");
    await knex(this.tableName).insert({
      ...item,
      snapshot: item.snapshot ? JSON.stringify(item.snapshot) : null,
    });
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IAuditLog>> {
    const knex = db("erp");
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
      data: rows as IAuditLog[],
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }
}
