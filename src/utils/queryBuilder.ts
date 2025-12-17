import { Knex } from "knex";
import { Request } from "express";
import {
  FilterConfig,
  QueryBuilderConfig,
  ParsedQuery,
  SearchConfig,
  SortConfig,
} from "../types/queryBuilder.types";

// Re-export types for convenience
export type {
  FilterConfig,
  FilterConfigs,
  SortConfig,
  SortConfigs,
  SearchConfig,
  QueryBuilderConfig,
  ParsedQuery,
} from "../types/queryBuilder.types";
export { createQueryConfig } from "../types/queryBuilder.types";

/**
 * Reserved query parameter names that are NOT filters
 */
const RESERVED_PARAMS = new Set([
  'page',
  'limit',
  'sortBy',
  'sortOrder',
  'search',
]);

/**
 * Parse query parameters from Express request
 * Uses FLAT parameter syntax: ?companyId=5&isActive=true
 *
 * Reserved params: page, limit, sortBy, sortOrder, search
 * All other params are treated as filters
 */
export function parseQueryParams(req: Request): ParsedQuery {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 items per page
  const sortBy = req.query.sortBy as string | undefined;
  const sortOrder = (req.query.sortOrder as string)?.toLowerCase() === "desc" ? "desc" : "asc";
  const search = req.query.search as string | undefined;

  // All non-reserved params are filters
  const filters: { [key: string]: any } = {};
  Object.keys(req.query).forEach((key) => {
    if (!RESERVED_PARAMS.has(key)) {
      const value = req.query[key];

      // Handle multiple values for same param (Express converts to array)
      // Example: ?status=active&status=pending → ['active', 'pending']
      if (Array.isArray(value)) {
        filters[key] = value;
      } else {
        filters[key] = value;
      }
    }
  });

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
 * Apply filters to Knex query based on configuration
 * Multiple filters use AND logic
 * Array values for single filter use IN operator
 */
export function applyFilters(
  query: Knex.QueryBuilder,
  filters: { [key: string]: any },
  filterConfig: { [key: string]: FilterConfig },
  tableName: string,
): void {
  Object.keys(filters).forEach((filterKey) => {
    const config = filterConfig[filterKey];
    if (!config) return; // Silently skip unknown filters

    let value = filters[filterKey];
    const column = `${tableName}.${config.column}`;
    const operator = config.operator || "=";

    // Handle array values (multiple values for same filter)
    // Example: ?status=active&status=pending → ['active', 'pending']
    if (Array.isArray(value)) {
      // Apply transform to each value if provided
      if (config.transform) {
        value = value.map(config.transform);
      }

      // Use IN operator for arrays
      query.whereIn(column, value);
      return;
    }

    // Apply transform for single value if provided
    if (config.transform) {
      value = config.transform(value);
    }

    // Apply filter based on operator
    switch (operator) {
      case "IN":
        // Support comma-separated values for IN operator
        // Example: ?statuses=active,pending,approved
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

/**
 * Apply sorting to Knex query based on configuration
 */
export function applySorting(
  query: Knex.QueryBuilder,
  sortBy: string | undefined,
  sortOrder: "asc" | "desc",
  sortConfig: { [key: string]: SortConfig },
  defaultSort: { column: string; order: "asc" | "desc" },
  tableName: string,
): void {
  if (sortBy && sortConfig[sortBy]) {
    const config = sortConfig[sortBy];
    const allowedOrders = config.allowedOrders || ["asc", "desc"];

    // Validate sort order
    if (allowedOrders.includes(sortOrder)) {
      query.orderBy(`${tableName}.${config.column}`, sortOrder);
    } else {
      // Fallback to default
      query.orderBy(`${tableName}.${defaultSort.column}`, defaultSort.order);
    }
  } else {
    // Apply default sorting
    query.orderBy(`${tableName}.${defaultSort.column}`, defaultSort.order);
  }
}

/**
 * Apply search to Knex query based on configuration
 */
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
      const qualifiedColumn = `${tableName}.${column}`;
      if (index === 0) {
        builder.where(qualifiedColumn, operator, searchTerm);
      } else {
        builder.orWhere(qualifiedColumn, operator, searchTerm);
      }
    });
  });
}

/**
 * Main query builder function - applies all filters, sorting, search, and pagination
 */
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

  // Apply filters
  if (config.filters && Object.keys(filters).length > 0) {
    applyFilters(baseQuery, filters, config.filters, config.tableName);
  }

  // Apply search
  if (config.search && search) {
    applySearch(baseQuery, search, config.search, config.tableName);
  }

  // Apply sorting
  const defaultSort = config.defaultSort || { column: "created_at", order: "desc" as const };
  if (config.sorting) {
    applySorting(baseQuery, sortBy, sortOrder, config.sorting, defaultSort, config.tableName);
  } else {
    baseQuery.orderBy(`${config.tableName}.${defaultSort.column}`, defaultSort.order);
  }

  // Apply pagination
  baseQuery.limit(limit).offset(offset);

  return {
    query: baseQuery,
    offset,
  };
}

/**
 * Helper function to build count query (same filters/search, no sorting/pagination)
 */
export function buildCountQuery(
  baseQuery: Knex.QueryBuilder,
  parsedQuery: ParsedQuery,
  config: QueryBuilderConfig,
): Knex.QueryBuilder {
  const { filters, search } = parsedQuery;

  // Apply filters
  if (config.filters && Object.keys(filters).length > 0) {
    applyFilters(baseQuery, filters, config.filters, config.tableName);
  }

  // Apply search
  if (config.search && search) {
    applySearch(baseQuery, search, config.search, config.tableName);
  }

  return baseQuery;
}
