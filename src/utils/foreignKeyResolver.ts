import type { Knex } from "knex";
import { db } from "../database/registry";
import { DbKey } from "../database/keys";
import { ownerOf } from "../database/ownership";
import { validate as isUuid } from "uuid";

/**
 * Which database to ask for a table whose name only exists at runtime
 * (`FK_CONFIGS` spans both planes, and `getIdByUuid`/`validateUuidExists` take
 * a bare string).
 *
 * `ownerOf` answers for the 73 single-owner tables. It deliberately returns
 * `undefined` for the fanned-out names (`files`, `audit_logs`) and for anything
 * it does not know, and those two cases must not share a fallback:
 *
 * - Fanned out: the answer exists but has to be *stated*, below.
 * - Unknown: there is no answer, and quietly picking one is the L-005 failure
 *   shape. `getIdByUuid` returns `null` on a miss and every caller reads `null`
 *   as "no value", so a lookup sent to the wrong database post-split would not
 *   404 or error — the field would simply go missing. It throws instead.
 *
 * The throw can only fire on a table name absent from the manifest, i.e. a
 * coding error, and only on the uuid branch — numeric pass-through and
 * empty→null are untouched.
 *
 * T2b routes the `companies` and `users` branches through `CoreClient`; the
 * other 11 configs stay module-local.
 */
const FANNED_OUT_RESOLUTION: Record<string, DbKey> = {
  // The only live caller is palletization's `technicalFileUuid` /
  // `imageFileUuid` — ERP product assets (G-2). A core company asset resolved
  // through here would need its own deliberate entry; do not widen this into a
  // general fallback.
  files: "erp",
};

const connectionFor = (tableName: string): Knex => {
  const key = ownerOf(tableName) ?? FANNED_OUT_RESOLUTION[tableName];
  if (!key) {
    throw new Error(
      `[foreignKeyResolver] no database owns table "${tableName}". Add it to ` +
        `src/database/ownership.ts, or — if it exists in more than one ` +
        `database — to FANNED_OUT_RESOLUTION with the reason.`,
    );
  }
  return db(key);
};

export interface ForeignKeyConfig {
  tableName: string;
  uuidColumn?: string;
  idColumn?: string;
}

export type ResolveResult =
  | { success: true; id: number }
  | { success: false; error: string };

/**
 * Accepts UUID strings, numeric strings, or numbers — UUIDs are looked up in `tableName`,
 * numeric inputs are returned as-is (trusts the caller has already validated them).
 * Returns null for empty/optional fields (callers should treat null as "no value").
 */
export async function resolveUuidToId(
  value: string | number | undefined | null,
  config: ForeignKeyConfig,
): Promise<ResolveResult | null> {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const { tableName, uuidColumn = "uuid", idColumn = "id" } = config;

  if (typeof value === "number") {
    return { success: true, id: value };
  }

  if (!isNaN(Number(value)) && !isUuid(value)) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return { success: true, id: parsed };
    }
  }

  if (typeof value === "string" && isUuid(value)) {
    const knex = connectionFor(tableName);

    const record = await knex(tableName)
      .select(idColumn)
      .where(uuidColumn, value)
      .first();

    if (!record) {
      return {
        success: false,
        error: `Invalid ${tableName.replace(/_/g, " ")} reference`,
      };
    }

    return { success: true, id: record[idColumn] };
  }

  return {
    success: false,
    error: `Invalid ${tableName.replace(/_/g, " ")} format`,
  };
}

/**
 * Mutates `data` in place: each configured field's UUID is replaced with its numeric id.
 * Stops at the first failing resolution and returns the error.
 */
export async function resolveForeignKeys(
  data: Record<string, any>,
  configs: Record<string, ForeignKeyConfig>,
): Promise<{ success: true } | { success: false; error: string }> {
  for (const [fieldName, config] of Object.entries(configs)) {
    const value = data[fieldName];

    if (value === undefined) {
      continue;
    }

    const result = await resolveUuidToId(value, config);

    if (result === null) {
      continue;
    }

    if (!result.success) {
      return result;
    }

    data[fieldName] = result.id;
  }

  return { success: true };
}

export async function validateUuidExists(
  uuid: string | undefined | null,
  tableName: string,
): Promise<boolean> {
  if (!uuid || !isUuid(uuid)) {
    return false;
  }

  const knex = connectionFor(tableName);
  const record = await knex(tableName).where("uuid", uuid).select("id").first();

  return !!record;
}

/**
 * Returns null when not found. Accepts numeric strings unchanged (parsed as-is).
 */
export async function getIdByUuid(
  uuid: string | undefined | null,
  tableName: string,
): Promise<number | null> {
  if (!uuid) {
    return null;
  }

  if (!isUuid(uuid)) {
    const parsed = parseInt(uuid, 10);
    return isNaN(parsed) ? null : parsed;
  }

  const knex = connectionFor(tableName);
  const record = await knex(tableName).where("uuid", uuid).select("id").first();

  return record ? record.id : null;
}

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
