import KnexManager from "../database/KnexConnection";
import { validate as isUuid } from "uuid";

/**
 * Configuration for foreign key resolution
 */
export interface ForeignKeyConfig {
  /** Database table name */
  tableName: string;
  /** UUID column name (default: "uuid") */
  uuidColumn?: string;
  /** ID column name (default: "id") */
  idColumn?: string;
}

/**
 * Result of foreign key resolution
 */
export type ResolveResult =
  | { success: true; id: number }
  | { success: false; error: string };

/**
 * Resolve a UUID to its numeric database ID
 *
 * This centralizes the repeated pattern found across controllers:
 * ```typescript
 * if (data.fieldId && typeof data.fieldId === "string") {
 *   const dao = new SomeDAO();
 *   const numericId = await dao.getIdByUuid(data.fieldId);
 *   if (!numericId) {
 *     return res.status(400).json({ success: false, message: "Invalid reference" });
 *   }
 *   data.fieldId = numericId;
 * }
 * ```
 *
 * @param value - The value to resolve (UUID string, numeric string, or number)
 * @param config - Configuration specifying the table and column names
 * @returns ResolveResult with either the numeric ID or an error message
 *
 * @example
 * const result = await resolveUuidToId(data.customerId, { tableName: "customers" });
 * if (!result.success) {
 *   return res.status(400).json({ success: false, message: result.error });
 * }
 * data.customerId = result.id;
 */
export async function resolveUuidToId(
  value: string | number | undefined | null,
  config: ForeignKeyConfig,
): Promise<ResolveResult | null> {
  // If no value provided, return null (field is optional)
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const { tableName, uuidColumn = "uuid", idColumn = "id" } = config;

  // If already a number, return as-is
  if (typeof value === "number") {
    return { success: true, id: value };
  }

  // If it's a numeric string, parse it
  if (!isNaN(Number(value)) && !isUuid(value)) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return { success: true, id: parsed };
    }
  }

  // It's a UUID string - look it up in the database
  if (typeof value === "string" && isUuid(value)) {
    const knex = KnexManager.getConnection();

    const record = await knex(tableName)
      .select(idColumn)
      .where(uuidColumn, value)
      .first();

    if (!record) {
      return { success: false, error: `Invalid ${tableName.replace(/_/g, " ")} reference` };
    }

    return { success: true, id: record[idColumn] };
  }

  // Invalid value format
  return { success: false, error: `Invalid ${tableName.replace(/_/g, " ")} format` };
}

/**
 * Resolve multiple foreign keys in a data object
 *
 * @param data - The data object containing fields to resolve
 * @param configs - Map of field names to their table configurations
 * @returns Object with resolved data or first error encountered
 *
 * @example
 * const result = await resolveForeignKeys(data, {
 *   customerId: { tableName: "customers" },
 *   categoryId: { tableName: "customer_categories" },
 *   salesPersonId: { tableName: "users" },
 * });
 *
 * if (!result.success) {
 *   return res.status(400).json({ success: false, message: result.error });
 * }
 * // data is now mutated with numeric IDs
 */
export async function resolveForeignKeys(
  data: Record<string, any>,
  configs: Record<string, ForeignKeyConfig>,
): Promise<{ success: true } | { success: false; error: string }> {
  for (const [fieldName, config] of Object.entries(configs)) {
    const value = data[fieldName];

    // Skip if field not present
    if (value === undefined) {
      continue;
    }

    const result = await resolveUuidToId(value, config);

    // Null means optional field with no value
    if (result === null) {
      continue;
    }

    if (!result.success) {
      return result;
    }

    // Update the data object with the resolved numeric ID
    data[fieldName] = result.id;
  }

  return { success: true };
}

/**
 * Validate that a UUID exists in a table
 *
 * @param uuid - The UUID to validate
 * @param tableName - The table to check
 * @returns true if the UUID exists, false otherwise
 *
 * @example
 * if (!(await validateUuidExists(data.companyId, "companies"))) {
 *   return res.status(400).json({ success: false, message: "Invalid company" });
 * }
 */
export async function validateUuidExists(
  uuid: string | undefined | null,
  tableName: string,
): Promise<boolean> {
  if (!uuid || !isUuid(uuid)) {
    return false;
  }

  const knex = KnexManager.getConnection();
  const record = await knex(tableName).where("uuid", uuid).select("id").first();

  return !!record;
}

/**
 * Get numeric ID by UUID from any table
 *
 * Simpler version when you just need the ID without error handling
 *
 * @param uuid - The UUID to look up
 * @param tableName - The table to search
 * @returns The numeric ID or null if not found
 *
 * @example
 * const companyId = await getIdByUuid(companyUuid, "companies");
 * if (!companyId) {
 *   return res.status(400).json({ success: false, message: "Invalid company" });
 * }
 */
export async function getIdByUuid(
  uuid: string | undefined | null,
  tableName: string,
): Promise<number | null> {
  if (!uuid) {
    return null;
  }

  // If it's already a number or numeric string
  if (!isUuid(uuid)) {
    const parsed = parseInt(uuid, 10);
    return isNaN(parsed) ? null : parsed;
  }

  const knex = KnexManager.getConnection();
  const record = await knex(tableName).where("uuid", uuid).select("id").first();

  return record ? record.id : null;
}

/**
 * Common foreign key configurations for reuse
 */
export const FK_CONFIGS = {
  company: { tableName: "companies" } as ForeignKeyConfig,
  customer: { tableName: "customers" } as ForeignKeyConfig,
  customerCategory: { tableName: "customer_categories" } as ForeignKeyConfig,
  user: { tableName: "users" } as ForeignKeyConfig,
  supplier: { tableName: "suppliers" } as ForeignKeyConfig,
  manufacturer: { tableName: "manufacturers" } as ForeignKeyConfig,
  warehouse: { tableName: "warehouses" } as ForeignKeyConfig,
  warehouseLocation: { tableName: "warehouse_locations" } as ForeignKeyConfig,
  paperSupply: { tableName: "paper_supplies" } as ForeignKeyConfig,
  paperType: { tableName: "paper_types" } as ForeignKeyConfig,
  paperClass: { tableName: "paper_classes" } as ForeignKeyConfig,
  fluteType: { tableName: "flute_types" } as ForeignKeyConfig,
  product: { tableName: "products" } as ForeignKeyConfig,
} as const;
