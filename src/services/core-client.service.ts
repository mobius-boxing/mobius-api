import { KnexTimeoutError } from "knex";
import { db, DatabaseNotConnectedError } from "../database/registry";
import { CompanyDAO } from "../dao/company/company.dao";
import { UserDAO } from "../dao/user/user.dao";
import {
  BLOCKED_SUB_STATUSES,
  CompanyModuleDAO,
} from "../dao/company-module/company-module.dao";
import { getRequestContext } from "../utils/requestContext";
import type { ICompany } from "../interfaces/company/company.interfaces";

/** The core database could not be reached; the error middleware answers 503. */
export class CoreUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Core database unavailable");
    this.name = "CoreUnavailableError";
    this.cause = cause;
  }
}

export type CoreUser = {
  readonly id: number;
  readonly uuid: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly isActive: boolean | null;
  readonly companyId: number | null;
  readonly role: string;
};

/**
 * A `companies` row exactly as `to_jsonb(companies.*)` renders it — timestamps
 * are the database's ISO strings, not `Date`s — so a hydrated `company` key
 * serializes byte-identically to the join it replaces.
 */
export type CoreCompany = {
  readonly id: number;
  readonly uuid: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly slug: string;
  readonly branding: Readonly<Record<string, unknown>>;
};

export type CorePerson = { readonly uuid: string; readonly name: string };

/**
 * Only failures to reach the server. A query error (22P02 for a malformed uuid,
 * say) must keep its own mapping, so it is never wrapped.
 */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

const isConnectionFailure = (error: unknown): boolean => {
  if (error instanceof KnexTimeoutError) return true;
  if (error instanceof DatabaseNotConnectedError) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    return CONNECTION_ERROR_CODES.has(code) || code.startsWith("08");
  }
  // node-postgres raises a dropped socket with no code at all.
  return error.message.startsWith("Connection terminated");
};

/**
 * Memoised per request in `coreCache`; outside a request context (the reminder
 * scheduler) every call goes to core. The promise is cached so concurrent
 * callers share one query, and evicted on failure so a later call can retry.
 */
const cached = <T>(
  method: string,
  args: readonly unknown[],
  load: () => Promise<T>,
): Promise<T> => {
  const cache = getRequestContext()?.coreCache;
  const key = `${method}:${JSON.stringify(args)}`;
  const hit = cache?.get(key);
  if (hit !== undefined) return hit as Promise<T>;

  const pending = load().catch((error: unknown) => {
    cache?.delete(key);
    throw isConnectionFailure(error) ? new CoreUnavailableError(error) : error;
  });
  cache?.set(key, pending);
  return pending;
};

/** `firstName lastName`, or null when both are blank — one composition for every printed person. */
export const personName = (
  firstName: string | null,
  lastName: string | null,
): string | null => {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
};

/** `personName` where a string is always printed. */
export const displayName = (user: {
  firstName: string | null;
  lastName: string | null;
}): string => personName(user.firstName, user.lastName) ?? "";

/**
 * A hydrated company as a DAO response carries it. The value is the
 * `to_jsonb(companies.*)` rendering the replaced join produced (string
 * timestamps, NULL description), which `ICompany` — the mapped DAO row — does
 * not model; the cast lives here and nowhere else.
 */
export const asCompanyPayload = (company: Partial<CoreCompany>): ICompany =>
  company as unknown as ICompany;

/**
 * The only door from module code into the core plane (`companies`, `users`,
 * `company_modules`, `modules`). Where a core DAO already answers the question
 * it is reused, so a predicate such as module enablement has one definition.
 */
export const CoreClient = {
  companyIdsWithModuleEnabled(slug: string): Promise<readonly number[]> {
    return cached("companyIdsWithModuleEnabled", [slug], async () => {
      const ids: number[] = await db("core")("company_modules as cm")
        .join("modules as m", "m.id", "cm.moduleId")
        .where("m.slug", slug)
        .andWhere("cm.enabled", true)
        .whereNotIn("cm.subscriptionStatus", BLOCKED_SUB_STATUSES)
        .orderBy("cm.companyId")
        .pluck("cm.companyId");
      return ids;
    });
  },

  /** SECURITY (L-009): company AND active are both part of the core predicate. */
  activeUserIdsForCompany(companyId: number): Promise<readonly number[]> {
    return cached("activeUserIdsForCompany", [companyId], async () => {
      const ids: number[] = await db("core")("users")
        .where({ companyId, isActive: true })
        .orderBy("id")
        .pluck("id");
      return ids;
    });
  },

  /**
   * One query for many companies: active, non-superAdmin users, ids ascending.
   * `is distinct from` rather than `<>`: `<>` answers NULL for a NULL role and
   * would drop exactly the role-less members the reminder fallback exists for.
   */
  activeUserIdsByCompanies(
    companyIds: readonly number[],
  ): Promise<ReadonlyMap<number, readonly number[]>> {
    if (companyIds.length === 0) return Promise.resolve(new Map());
    return cached("activeUserIdsByCompanies", [companyIds], async () => {
      const rows: { id: number; companyId: number }[] = await db("core")(
        "users",
      )
        .whereIn("companyId", companyIds)
        .where("isActive", true)
        .whereRaw(`"role" is distinct from ?`, ["superAdmin"])
        .select("id", "companyId")
        .orderBy("id");
      const byCompany = new Map<number, number[]>();
      for (const row of rows) {
        byCompany.set(row.companyId, [
          ...(byCompany.get(row.companyId) ?? []),
          row.id,
        ]);
      }
      return byCompany;
    });
  },

  /**
   * SECURITY (L-009): only ACTIVE users of `companyId` resolve. Callers compare
   * lengths and refuse on a mismatch, so a foreign uuid is never silently dropped.
   */
  activeUserIdsByUuids(
    companyId: number,
    uuids: readonly string[],
  ): Promise<readonly number[]> {
    if (uuids.length === 0) return Promise.resolve([]);
    return cached("activeUserIdsByUuids", [companyId, uuids], async () => {
      const ids: number[] = await db("core")("users")
        .where({ companyId, isActive: true })
        .whereIn("uuid", uuids)
        .orderBy("id")
        .pluck("id");
      return ids;
    });
  },

  /** Uuid and printable name only — no email, role or id leaves this method. */
  listCompanyPeople(companyId: number): Promise<readonly CorePerson[]> {
    return cached("listCompanyPeople", [companyId], async () => {
      const rows: { uuid: string; firstName: string; lastName: string }[] =
        await db("core")("users")
          .where({ companyId, isActive: true })
          .select("uuid", "firstName", "lastName")
          // Ordering on the name parts matches ordering on "firstName lastName".
          .orderBy([{ column: "firstName" }, { column: "lastName" }]);
      return rows.map((row) => ({ uuid: row.uuid, name: displayName(row) }));
    });
  },

  /**
   * One query for the whole id list, ordered by name (then id) so a caller that
   * prints people keeps the database's collation order.
   */
  usersByIds(ids: readonly number[]): Promise<readonly CoreUser[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return cached("usersByIds", [ids], async () => {
      const rows: CoreUser[] = await db("core")("users")
        .whereIn("id", ids)
        .select(
          "id",
          "uuid",
          "email",
          "firstName",
          "lastName",
          "isActive",
          "companyId",
          "role",
        )
        .orderBy([
          { column: "firstName" },
          { column: "lastName" },
          { column: "id" },
        ]);
      return rows;
    });
  },

  companyIdByUuid(uuid: string): Promise<number | null> {
    return cached("companyIdByUuid", [uuid], () =>
      new CompanyDAO().getIdByUuid(uuid),
    );
  },

  userIdByUuid(uuid: string): Promise<number | null> {
    return cached("userIdByUuid", [uuid], () =>
      new UserDAO().getIdByUuid(uuid),
    );
  },

  isModuleEnabled(companyId: number, slug: string): Promise<boolean> {
    return cached("isModuleEnabled", [companyId, slug], () =>
      new CompanyModuleDAO().isEnabled(companyId, slug),
    );
  },

  companiesByIds(ids: readonly number[]): Promise<readonly CoreCompany[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return cached("companiesByIds", [ids], async () => {
      const knex = db("core");
      const rows: { company: CoreCompany }[] = await knex("companies")
        .whereIn("id", ids)
        .select(knex.raw("to_jsonb(companies.*) as company"));
      return rows.map((row) => row.company);
    });
  },
};
