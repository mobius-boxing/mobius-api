/**
 * Shared types for Query Builder system
 * Use these types to define query configurations for any endpoint
 */

/**
 * Configuration for filterable columns
 */
export interface FilterConfig {
  column: string; // Database column name (snake_case)
  // Default: "=". "@>" is Postgres array/jsonb containment; `applyFilters`
  // passes it through its default branch untouched, so the transform must
  // produce the array (audit P3's `changedKey` filter is the only user today).
  operator?:
    | "="
    | "!="
    | ">"
    | "<"
    | ">="
    | "<="
    | "LIKE"
    | "ILIKE"
    | "IN"
    | "@>";
  transform?: (value: any) => any; // Transform function for the filter value
}

/**
 * Configuration for sortable columns
 */
export interface SortConfig {
  column: string; // Database column name (snake_case)
  allowedOrders?: ("asc" | "desc")[]; // Default: ["asc", "desc"]
}

/**
 * Configuration for searchable columns
 */
export interface SearchConfig {
  columns: string[]; // Database columns to search (snake_case)
  operator?: "LIKE" | "ILIKE"; // Default: "ILIKE" for case-insensitive
}

/**
 * Query builder configuration - reusable type for all endpoints
 */
export interface QueryBuilderConfig {
  filters?: { [key: string]: FilterConfig }; // Key is the query param name (camelCase)
  sorting?: { [key: string]: SortConfig }; // Key is the query param name (camelCase)
  search?: SearchConfig;
  defaultSort?: {
    column: string;
    order: "asc" | "desc";
  };
  tableName: string; // Primary table name for qualified column names
}

/**
 * Parsed query parameters from request
 */
export interface ParsedQuery {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder: "asc" | "desc";
  filters: { [key: string]: any };
  search?: string;
}

/**
 * Helper type for creating filter configurations
 * Usage: const filters: FilterConfigs = { ... }
 */
export type FilterConfigs = { [key: string]: FilterConfig };

/**
 * Helper type for creating sort configurations
 * Usage: const sorting: SortConfigs = { ... }
 */
export type SortConfigs = { [key: string]: SortConfig };

/**
 * Factory function to create a QueryBuilderConfig
 * Ensures type safety and provides defaults
 */
export function createQueryConfig(
  tableName: string,
  options: Omit<QueryBuilderConfig, "tableName">,
): QueryBuilderConfig {
  return {
    tableName,
    defaultSort: options.defaultSort || { column: "created_at", order: "desc" },
    ...options,
  };
}
