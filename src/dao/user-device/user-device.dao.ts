import { Request } from "express";
import { Knex } from "knex";
import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import {
  IUserDevice,
  IUserDeviceView,
  IUserRef,
} from "../../interfaces/user-device/user-device.interfaces";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import {
  applySearch,
  buildCountQuery,
  buildQuery,
  createQueryConfig,
  parseQueryParams,
  type FilterConfigs,
  type ParsedQuery,
  type QueryBuilderConfig,
  type SortConfigs,
} from "../../utils/queryBuilder";

/**
 * Filters/sorts live outside the class per the endpoint guide.
 *
 * `status` takes the `IN` operator so `?status=pending,revoked` narrows the admin
 * queue in one call; `applyFilters` splits the comma itself, and an
 * Express-repeated `?status=a&status=b` arrives as an array and becomes the same
 * `whereIn`.
 *
 * `userId` and `tokenHash` are deliberately absent: both are internal (I-10), so
 * neither may be reachable as a query param.
 */
const USER_DEVICE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  status: { column: "status", operator: "IN" },
};

const USER_DEVICE_SORTING: SortConfigs = {
  requestedAt: { column: "requestedAt" },
  status: { column: "status" },
  createdAt: { column: "createdAt" },
};

/**
 * No `search` in the config on purpose: the searchable columns belong to `users`,
 * and `buildQuery` qualifies `config.search.columns` with `config.tableName` —
 * which would emit `user_devices.email`. The join's columns go through the same
 * `applySearch` helper with its own table argument instead.
 */
const USER_DEVICE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "user_devices",
  {
    filters: USER_DEVICE_FILTERS,
    sorting: USER_DEVICE_SORTING,
    defaultSort: { column: "requestedAt", order: "desc" },
  },
);

const USER_SEARCH: { columns: string[]; operator: "ILIKE" } = {
  columns: ["email", "firstName", "lastName"],
  operator: "ILIKE",
};

/** The device's own columns; a bare `*` would collide with the three joins. */
const DEVICE_COLUMNS = [
  "id",
  "uuid",
  "userId",
  "tokenHash",
  "status",
  "userAgent",
  "requestIp",
  "requestedAt",
  "approvedAt",
  "approvedBy",
  "revokedAt",
  "revokedBy",
  "createdAt",
  "updatedAt",
] as const;

/** Columns `update` may write. `id`/`uuid`/`createdAt` are not negotiable. */
const WRITABLE_COLUMNS = [
  "status",
  "userAgent",
  "requestIp",
  "requestedAt",
  "approvedAt",
  "approvedBy",
  "revokedAt",
  "revokedBy",
] as const;

/** `users` rows flattened per join as `<alias>_<column>`. */
const REF_COLUMNS = ["uuid", "email", "firstName", "lastName"] as const;

/** `[join source, mapper alias]` — `users` is unaliased so the scope can name it. */
const REF_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["users", "deviceUser"],
  ["approver", "approver"],
  ["revoker", "revoker"],
];

export type CreatePendingDeviceInput = {
  userId: number;
  tokenHash: string;
  userAgent: string | null;
  requestIp: string | null;
};

/** What a (re-)request captures about the browser making it (D-11). */
export type DeviceRequestContext = {
  userAgent: string | null;
  requestIp: string | null;
};

/**
 * `user_devices` — one row per (user, browser), in the `core` database.
 *
 * Two mappers, deliberately:
 * - `mapToInterface` builds the **wire** shape (`IUserDeviceView`) and cannot
 *   emit `id`, `userId` or `tokenHash` (I-10);
 * - `mapRow` builds the internal `IUserDevice` that the device service and the
 *   approve controller need in full — numeric `id` included, so uuid→id is
 *   resolved explicitly instead of being guessed from a stripped mapper (L-005).
 *
 * Deletion is cascade-only (D-6, L-006): `delete` exists because `IBaseDAO`
 * declares it, no route calls it, and rows die with their user.
 */
export class UserDeviceDAO implements IBaseDAO<IUserDevice> {
  private tableName = "user_devices";
  private queryConfig = USER_DEVICE_QUERY_CONFIG;

  /**
   * `IBaseDAO`'s generic insert, kept as a passthrough of the caller's own
   * `status` (D-64) rather than delegating to `createPending`, which would ignore
   * it. No route calls it; the CHECK constraints, not this method, are what make
   * a malformed row impossible.
   */
  async create(item: IUserDevice): Promise<IUserDevice> {
    return this.insertRow({
      userId: item.userId,
      tokenHash: item.tokenHash,
      status: item.status,
      userAgent: item.userAgent,
      requestIp: item.requestIp,
      ...(item.requestedAt ? { requestedAt: item.requestedAt } : {}),
    });
  }

  /** A `pending` row — login cases 2 and 3, accept-invitation. */
  async createPending(input: CreatePendingDeviceInput): Promise<IUserDevice> {
    return this.insertRow({
      userId: input.userId,
      tokenHash: input.tokenHash,
      status: "pending",
      userAgent: input.userAgent,
      requestIp: input.requestIp,
    });
  }

  async getById(id: number): Promise<IUserDevice | null> {
    const knex = db("core");
    const row = await knex(this.tableName).where("id", id).first();

    return row ? this.mapRow(row) : null;
  }

  /**
   * The internal row, optionally scoped to a company through `users` (L-009,
   * db-per-company T1/AC-7: a local predicate on `users.companyId`, no join to
   * `companies` — the caller already holds the numeric id). A device of another
   * tenant reads as absent, which is what lets the approve controller answer
   * the same 404 for unknown and foreign uuids (D-18).
   */
  async getByUuid(
    uuid: string,
    companyScope?: CompanyScope,
  ): Promise<IUserDevice | null> {
    const knex = db("core");
    const query = knex(this.tableName)
      .join("users", `${this.tableName}.userId`, "users.id")
      .where(`${this.tableName}.uuid`, uuid)
      .select(this.qualifiedDeviceColumns());
    applyCompanyScope(query, "users", companyScope);

    const row = await query.first();
    return row ? this.mapRow(row) : null;
  }

  /** Login case 1: this browser is already known to this user. */
  async getByUserAndTokenHash(
    userId: number,
    tokenHash: string,
  ): Promise<IUserDevice | null> {
    const knex = db("core");
    const row = await knex(this.tableName).where({ userId, tokenHash }).first();

    return row ? this.mapRow(row) : null;
  }

  /**
   * Login case 2 vs case 3: is this secret known to ANY user?
   *
   * A hash nobody carries is a client invention and is ignored rather than
   * stored, so an attacker cannot choose their own device secret (D-3).
   */
  async existsByTokenHash(tokenHash: string): Promise<boolean> {
    const knex = db("core");
    const row = await knex(this.tableName)
      .where("tokenHash", tokenHash)
      .select("id")
      .first();

    return Boolean(row);
  }

  /** The wire shape of one device, for the approve/revoke responses. */
  async getViewByUuid(
    uuid: string,
    companyScope?: CompanyScope,
  ): Promise<IUserDeviceView | null> {
    const knex = db("core");
    const query = this.selectWithRefs(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    applyCompanyScope(query, "users", companyScope);

    const row = await query.first();
    return row ? this.mapToInterface(row) : null;
  }

  async update(
    id: number,
    item: Partial<IUserDevice>,
  ): Promise<IUserDevice | null> {
    const knex = db("core");
    const payload: Record<string, unknown> = { updatedAt: knex.fn.now() };
    for (const column of WRITABLE_COLUMNS) {
      if (item[column] !== undefined) payload[column] = item[column];
    }

    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(payload)
      .returning("*");

    return row ? this.mapRow(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("core");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IUserDevice>> {
    const knex = db("core");
    const offset = (page - 1) * limit;

    const [rows, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("requestedAt", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => this.mapRow(row)),
      page,
      limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IUserDeviceView>> {
    const knex = db("core");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // SECURITY (L-009, db-per-company T1/AC-7): the scope is token-derived —
    // `companyFilterScope` turns it into a local predicate on `users.companyId`,
    // no join to `companies`. `?companyId=` only ever reaches it for a
    // superAdmin.
    const companyScope = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    // The contract's default order is `desc` and the shared parser's is `asc`,
    // so an explicit `?sortBy=requestedAt` without an order — or with an
    // unparseable one — would silently invert the admin queue and show the
    // oldest request first. Only a literal `asc` opts out.
    const requestedOrder = String(req.query.sortOrder ?? "").toLowerCase();
    parsedQuery.sortOrder = requestedOrder === "asc" ? "asc" : "desc";

    const dataQuery = this.selectWithRefs(knex);
    this.applyScopeAndSearch(dataQuery, companyScope, parsedQuery.search);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // The count query carries the same `users` join: without it the scope and
    // the search would reach one query and not the other, and `totalCount` would
    // contradict the page. `userId` is NOT NULL, so the inner join neither adds
    // nor drops a row.
    const countQuery = knex(this.tableName).join(
      "users",
      `${this.tableName}.userId`,
      "users.id",
    );
    this.applyScopeAndSearch(countQuery, companyScope, parsedQuery.search);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * `revoked` → `pending` on the next login from the same browser (D-5).
   *
   * All four actor columns are nulled, so the row can never read as "approved by
   * X" while it is waiting for approval (I-4).
   */
  async rerequest(
    id: number,
    context: DeviceRequestContext,
  ): Promise<IUserDevice | null> {
    const knex = db("core");
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update({
        status: "pending",
        requestedAt: knex.fn.now(),
        approvedAt: null,
        approvedBy: null,
        revokedAt: null,
        revokedBy: null,
        userAgent: context.userAgent,
        requestIp: context.requestIp,
        updatedAt: knex.fn.now(),
      })
      .returning("*");

    return row ? this.mapRow(row) : null;
  }

  /**
   * Approve, inside the request's ambient transaction so the row trigger writes
   * the ledger entry with the caller as actor (I-11).
   *
   * Callable from `pending` **and from `revoked`** (D-149): an admin who revoked
   * the wrong device re-approves it from the list instead of making the employee
   * log in again. That is what makes clearing `revokedAt`/`revokedBy` here
   * load-bearing rather than defensive (D-63) — without it an approved row would
   * keep the stamps of the revocation it just undid, and the list would show a
   * device both approved and revoked.
   */
  async approve(id: number, approvedById: number): Promise<IUserDevice | null> {
    const knex = db("core");
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update({
        status: "approved",
        approvedAt: knex.fn.now(),
        approvedBy: approvedById,
        revokedAt: null,
        revokedBy: null,
        updatedAt: knex.fn.now(),
      })
      .returning("*");

    return row ? this.mapRow(row) : null;
  }

  /**
   * Revoke. `approvedAt`/`approvedBy` are left alone on purpose: who approved
   * this browser stays readable until a re-request or a re-approval clears it.
   */
  async revoke(id: number, revokedById: number): Promise<IUserDevice | null> {
    const knex = db("core");
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update({
        status: "revoked",
        revokedAt: knex.fn.now(),
        revokedBy: revokedById,
        updatedAt: knex.fn.now(),
      })
      .returning("*");

    return row ? this.mapRow(row) : null;
  }

  private async insertRow(
    payload: Record<string, unknown>,
  ): Promise<IUserDevice> {
    const knex = db("core");
    const [row] = await knex(this.tableName).insert(payload).returning("*");

    return this.mapRow(row);
  }

  private qualifiedDeviceColumns(): string[] {
    return DEVICE_COLUMNS.map((column) => `${this.tableName}.${column}`);
  }

  private applyScopeAndSearch(
    query: Knex.QueryBuilder,
    companyScope: CompanyScope | undefined,
    search: string | undefined,
  ): void {
    applyCompanyScope(query, "users", companyScope);
    applySearch(query, search, USER_SEARCH, "users");
  }

  private selectWithRefs(knex: Knex): Knex.QueryBuilder {
    return knex(this.tableName)
      .join("users", `${this.tableName}.userId`, "users.id")
      .leftJoin(
        "users as approver",
        `${this.tableName}.approvedBy`,
        "approver.id",
      )
      .leftJoin("users as revoker", `${this.tableName}.revokedBy`, "revoker.id")
      .select([
        ...this.qualifiedDeviceColumns(),
        ...REF_SOURCES.flatMap(([source, alias]) =>
          REF_COLUMNS.map(
            (column) => `${source}.${column} as ${alias}_${column}`,
          ),
        ),
      ]);
  }

  private mapRef(record: any, alias: string): IUserRef | null {
    const uuid = record[`${alias}_uuid`];
    if (!uuid) return null;

    return {
      uuid,
      email: record[`${alias}_email`],
      firstName: record[`${alias}_firstName`],
      lastName: record[`${alias}_lastName`],
    };
  }

  /**
   * The wire shape. Nothing here reads `id`, `userId` or `tokenHash`: a response
   * cannot leak what the mapper never copies (I-10).
   */
  private mapToInterface(record: any): IUserDeviceView {
    return {
      uuid: record.uuid,
      status: record.status,
      userAgent: record.userAgent,
      requestIp: record.requestIp,
      requestedAt: record.requestedAt,
      approvedAt: record.approvedAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      user: this.mapRef(record, "deviceUser") as IUserRef,
      approvedBy: this.mapRef(record, "approver"),
      revokedBy: this.mapRef(record, "revoker"),
    };
  }

  private mapRow(record: any): IUserDevice {
    return {
      id: record.id,
      uuid: record.uuid,
      userId: record.userId,
      tokenHash: record.tokenHash,
      status: record.status,
      userAgent: record.userAgent,
      requestIp: record.requestIp,
      requestedAt: record.requestedAt,
      approvedAt: record.approvedAt,
      approvedBy: record.approvedBy,
      revokedAt: record.revokedAt,
      revokedBy: record.revokedBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
