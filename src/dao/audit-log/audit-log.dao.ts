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

/**
 * Reads of the audit ledger. There is no write half: since P2 every row is
 * written by the database trigger `audit_row_change`, and `audit_logs` is
 * append-only in the database itself (`audit_logs_protect`), so an INSERT from
 * here would be both redundant and, for UPDATE/DELETE, `P0001`. The one
 * sanctioned door for removing rows is `company-purge.service.ts`.
 *
 * `audit_logs` is a FANNED-OUT table (D-2 / AC-2): one per database. All four
 * keys resolve to one physical database today, so `db("erp")` below and the
 * `companies` join it makes possible are correct as written. Once they do not,
 * a read must fan out across all four — there is deliberately no cross-module
 * audit view (non-goal 14). **That fan-out belongs to P3**, which owns the read
 * API; the Amendment of 2026-09-01 deferred D-2 to the split's cutover, so
 * nothing here is a placeholder for P2 to have resolved.
 */
export class AuditLogDAO {
  private tableName = "audit_logs";
  private queryConfig = AUDIT_LOG_QUERY_CONFIG;

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
