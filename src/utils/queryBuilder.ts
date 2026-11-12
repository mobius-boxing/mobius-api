import { Knex } from "knex";
import { Request } from "express";
import { getCompanyFilterUuid } from "./companyScope";
import {
  FilterConfig,
  QueryBuilderConfig,
  ParsedQuery,
  SearchConfig,
  SortConfig,
  SortKey,
} from "../types/queryBuilder.types";

// Re-export types for convenience
export type {
  FilterConfig,
  FilterConfigs,
  SortConfig,
  SortConfigs,
  SearchConfig,
  SortKey,
  QueryBuilderConfig,
  ParsedQuery,
} from "../types/queryBuilder.types";
export { createQueryConfig } from "../types/queryBuilder.types";

// Reserved query params — everything else is treated as a filter.
const RESERVED_PARAMS = new Set([
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
]);

export function parseQueryParams(req: Request): ParsedQuery {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Cap at 100 items/page.
  const sortBy = req.query.sortBy as string | undefined;
  const sortOrder =
    (req.query.sortOrder as string)?.toLowerCase() === "desc" ? "desc" : "asc";
  const search = req.query.search as string | undefined;

  const filters: { [key: string]: any } = {};
  Object.keys(req.query).forEach((key) => {
    if (!RESERVED_PARAMS.has(key)) {
      const value = req.query[key];

      // Express turns repeated query params (?status=a&status=b) into an array.
      if (Array.isArray(value)) {
        filters[key] = value;
      } else {
        filters[key] = value;
      }
    }
  });

  // SECURITY: the company filter is derived from the caller's token, never
  // from their input. Every DAO's getAllWithFilters lifts `filters.companyId`
  // out of this object and turns it into a local predicate on the table's own
  // company column (`applyCompanyScope` — no join to `companies`, db-per-company
  // T1/AC-7), so setting it here scopes all ~50 of them at once.
  //
  // This used to be `enforceCompanyFilter(req)`, called from the controllers,
  // which assigned to `req.query.companyId`. Under Express 5 `req.query` is a
  // getter that re-parses the query string on every access, so the assignment
  // was silently discarded and non-superAdmins were never scoped at all: a
  // list endpoint returned every tenant's rows. Writing the value into the
  // parsed result instead is what makes the scope actually reach the DAO.
  const companyUuid = getCompanyFilterUuid(req);
  if (companyUuid === undefined) {
    // superAdmin with no company selected: no filter, full cross-company view.
    delete filters.companyId;
  } else {
    filters.companyId = companyUuid;
  }

  return {
    page,
    limit,
    sortBy,
    sortOrder,
    filters,
    search,
  };
}

/**
 * Multiple filters AND; array values for one filter become IN.
 * Unknown filter keys are silently dropped (do not leak schema via 400s).
 */
export function applyFilters(
  query: Knex.QueryBuilder,
  filters: { [key: string]: any },
  filterConfig: { [key: string]: FilterConfig },
  tableName: string,
): void {
  Object.keys(filters).forEach((filterKey) => {
    const config = filterConfig[filterKey];
    if (!config) return;

    let value = filters[filterKey];
    const column = `${config.table ?? tableName}.${config.column}`;
    const operator = config.operator || "=";

    if (Array.isArray(value)) {
      if (config.transform) {
        value = value.map(config.transform);
      }

      query.whereIn(column, value);
      return;
    }

    if (config.transform) {
      value = config.transform(value);
      // A range transform (e.g. `numberRangeFilters`'s `Number`) that cannot
      // make sense of the raw value returns `undefined` for "drop this filter",
      // matching the unknown-key behavior below rather than handing Postgres
      // a NaN/Invalid Date.
      if (value === undefined) return;
    }

    switch (operator) {
      case "IN":
        // IN supports comma-separated single-value syntax: ?statuses=active,pending,approved
        const values = value.split(",").map((v: string) => v.trim());
        query.whereIn(column, values);
        break;
      case "LIKE":
      case "ILIKE":
        query.where(column, operator, `%${value}%`);
        break;
      default:
        query.where(column, operator, value);
    }
  });
}

/** Created by migration 20261112180000 in every core and tenant database. */
export const NATURAL_COLLATION = "mobius_natural";

export function orderByColumn(
  query: Knex.QueryBuilder,
  qualifiedColumn: string,
  order: "asc" | "desc",
  natural = false,
): void {
  const direction = order === "desc" ? "desc" : "asc";
  if (natural) {
    query.orderByRaw(`?? COLLATE ${NATURAL_COLLATION} ${direction}`, [
      qualifiedColumn,
    ]);
  } else {
    query.orderBy(qualifiedColumn, direction);
  }
}

/** The unique tie-break keeps OFFSET pages stable when sort values repeat. */
export function applyDefaultSort(
  query: Knex.QueryBuilder,
  defaultSort: SortKey & { thenBy?: SortKey[] },
  tableName: string,
): void {
  const keys = [defaultSort, ...(defaultSort.thenBy ?? [])];
  keys.forEach((key) =>
    orderByColumn(
      query,
      `${key.table ?? tableName}.${key.column}`,
      key.order,
      key.natural,
    ),
  );
  if (!keys.some((key) => key.column === "id" && !key.table)) {
    orderByColumn(query, `${tableName}.id`, defaultSort.order);
  }
}

const FALLBACK_SORT: SortKey = { column: "created_at", order: "desc" };

/**
 * For hand-written list queries: the same order `buildQuery` gives the grid.
 * Returns the builder it was given so the knex result type survives (`.modify`
 * would widen it to `any`) — wrap the chain's head: `applyConfigDefaultSort(knex(t), cfg).select()`.
 */
export function applyConfigDefaultSort<Q extends Knex.QueryBuilder>(
  query: Q,
  config: QueryBuilderConfig,
): Q {
  applyDefaultSort(
    query,
    config.defaultSort || FALLBACK_SORT,
    config.tableName,
  );
  return query;
}

export function applySorting(
  query: Knex.QueryBuilder,
  sortBy: string | undefined,
  sortOrder: "asc" | "desc",
  sortConfig: { [key: string]: SortConfig },
  defaultSort: SortKey & { thenBy?: SortKey[] },
  tableName: string,
): void {
  const config = sortBy ? sortConfig[sortBy] : undefined;
  const allowedOrders = config?.allowedOrders || ["asc", "desc"];
  if (!config || !allowedOrders.includes(sortOrder)) {
    applyDefaultSort(query, defaultSort, tableName);
    return;
  }
  orderByColumn(
    query,
    `${config.table ?? tableName}.${config.column}`,
    sortOrder,
    config.natural,
  );
  if (config.column !== "id" || config.table) {
    orderByColumn(query, `${tableName}.id`, sortOrder);
  }
}

export function applySearch(
  query: Knex.QueryBuilder,
  search: string | undefined,
  searchConfig: SearchConfig | undefined,
  tableName: string,
): void {
  if (!search || !searchConfig || searchConfig.columns.length === 0) return;

  const operator = searchConfig.operator || "ILIKE";
  const searchTerm = `%${search}%`;

  query.where((builder) => {
    searchConfig.columns.forEach((column, index) => {
      const qualifiedColumn = column.includes(".")
        ? column
        : `${tableName}.${column}`;
      if (index === 0) {
        builder.where(qualifiedColumn, operator, searchTerm);
      } else {
        builder.orWhere(qualifiedColumn, operator, searchTerm);
      }
    });
  });
}

export function buildQuery(
  baseQuery: Knex.QueryBuilder,
  parsedQuery: ParsedQuery,
  config: QueryBuilderConfig,
): {
  query: Knex.QueryBuilder;
  offset: number;
} {
  const { page, limit, sortBy, sortOrder, filters, search } = parsedQuery;
  const offset = (page - 1) * limit;

  if (config.filters && Object.keys(filters).length > 0) {
    applyFilters(baseQuery, filters, config.filters, config.tableName);
  }

  if (config.search && search) {
    applySearch(baseQuery, search, config.search, config.tableName);
  }

  const defaultSort = config.defaultSort || FALLBACK_SORT;
  if (config.sorting) {
    applySorting(
      baseQuery,
      sortBy,
      sortOrder,
      config.sorting,
      defaultSort,
      config.tableName,
    );
  } else {
    applyDefaultSort(baseQuery, defaultSort, config.tableName);
  }

  baseQuery.limit(limit).offset(offset);

  return {
    query: baseQuery,
    offset,
  };
}

/**
 * Count query mirrors filters and search but skips sort/pagination.
 */
export function buildCountQuery(
  baseQuery: Knex.QueryBuilder,
  parsedQuery: ParsedQuery,
  config: QueryBuilderConfig,
): Knex.QueryBuilder {
  const { filters, search } = parsedQuery;

  if (config.filters && Object.keys(filters).length > 0) {
    applyFilters(baseQuery, filters, config.filters, config.tableName);
  }

  if (config.search && search) {
    applySearch(baseQuery, search, config.search, config.tableName);
  }

  return baseQuery;
}
