import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import {
  IStoreUser,
  IStoreUserInternal,
} from "../../interfaces/store-user/store-user.interfaces";
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
import { Request } from "express";

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
const STORE_USER_FILTERS: FilterConfigs = {
  email: { column: "email", operator: "ILIKE" },
  firstName: { column: "firstName", operator: "ILIKE" },
  lastName: { column: "lastName", operator: "ILIKE" },
  isActive: {
    column: "isActive",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  emailVerified: {
    column: "emailVerified",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  uuid: { column: "uuid", operator: "=" },
};

const STORE_USER_SORTING: SortConfigs = {
  email: { column: "email" },
  firstName: { column: "firstName" },
  lastName: { column: "lastName" },
  isActive: { column: "isActive" },
  emailVerified: { column: "emailVerified" },
  lastLoginAt: { column: "lastLoginAt" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const STORE_USER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "store_users",
  {
    filters: STORE_USER_FILTERS,
    sorting: STORE_USER_SORTING,
    search: {
      columns: ["email", "firstName", "lastName"],
      operator: "ILIKE",
    },
    defaultSort: { column: "createdAt", order: "desc" },
  },
);

export class StoreUserDAO implements IBaseDAO<IStoreUser> {
  private tableName = "store_users";
  private queryConfig = STORE_USER_QUERY_CONFIG;

  // create accepts the INTERNAL shape so callers can pass passwordHash / invitationToken,
  // but the RETURN value is the public IStoreUser (secrets stripped by mapToInterface).
  async create(item: IStoreUserInternal): Promise<IStoreUser> {
    const knex = db("store");
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        email: item.email,
        passwordHash: item.passwordHash ?? null,
        firstName: item.firstName ?? null,
        lastName: item.lastName ?? null,
        isActive: item.isActive ?? true,
        emailVerified: item.emailVerified ?? false,
        invitationToken: item.invitationToken ?? null,
        invitationExpiresAt: item.invitationExpiresAt ?? null,
        invitedBy: item.invitedBy ?? null,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IStoreUser | null> {
    const knex = db("store");
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<IStoreUser | null> {
    const knex = db("store");
    const record = await knex(this.tableName).where("uuid", uuid).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = db("store");
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

  // Company-scoped uniqueness check. Case-insensitive (uses the LOWER(email) index).
  async getByEmail(
    companyId: number,
    email: string,
  ): Promise<IStoreUser | null> {
    const knex = db("store");
    const record = await knex(this.tableName)
      .where("companyId", companyId)
      .whereRaw("LOWER(email) = LOWER(?)", [email])
      .first();
    return record ? this.mapToInterface(record) : null;
  }

  async update(
    id: number,
    item: Partial<IStoreUser>,
  ): Promise<IStoreUser | null> {
    const knex = db("store");
    const updateData: any = {};

    if (item.email !== undefined) updateData.email = item.email;
    if (item.firstName !== undefined) updateData.firstName = item.firstName;
    if (item.lastName !== undefined) updateData.lastName = item.lastName;
    if (item.isActive !== undefined) updateData.isActive = item.isActive;
    if (item.emailVerified !== undefined)
      updateData.emailVerified = item.emailVerified;
    // NOTE: passwordHash / invitationToken are NOT updatable here — use the
    // dedicated setPassword / setInvitation methods. This keeps secrets out of the
    // generic update path and out of the public interface.

    updateData.updatedAt = knex.fn.now();

    const [record] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return record ? this.mapToInterface(record) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("store");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  // --- Auth-flow helpers -------------------------------------------------

  // Sets the password hash and (since a password now exists) clears any pending invite.
  async setPassword(
    id: number,
    passwordHash: string,
  ): Promise<IStoreUser | null> {
    const knex = db("store");
    const [record] = await knex(this.tableName)
      .where("id", id)
      .update({
        passwordHash,
        invitationToken: null,
        invitationExpiresAt: null,
        updatedAt: knex.fn.now(),
      })
      .returning("*");
    return record ? this.mapToInterface(record) : null;
  }

  async setInvitation(
    id: number,
    token: string,
    expiresAt: Date,
  ): Promise<IStoreUser | null> {
    const knex = db("store");
    const [record] = await knex(this.tableName)
      .where("id", id)
      .update({
        invitationToken: token,
        invitationExpiresAt: expiresAt,
        updatedAt: knex.fn.now(),
      })
      .returning("*");
    return record ? this.mapToInterface(record) : null;
  }

  async markActive(id: number, isActive: boolean): Promise<IStoreUser | null> {
    const knex = db("store");
    const [record] = await knex(this.tableName)
      .where("id", id)
      .update({ isActive, updatedAt: knex.fn.now() })
      .returning("*");
    return record ? this.mapToInterface(record) : null;
  }

  // --- Store login lookup -------------------------------------------------

  // LOGIN ONLY. Returns ALL store_users matching the email ACROSS companies,
  // INCLUDING passwordHash, because login does not know companyId (the single store
  // deployment serves multiple companies). The controller bcrypt-compares each candidate,
  // then resolves the matched row. Case-insensitive via the LOWER(email) index.
  // JOINs companies so login gets companyUuid (for the JWT) + companyName (for the
  // response) without extra round trips. Returns the INTERNAL shape — must only ever be
  // consumed by the login controller, never serialized to a client.
  async getInternalByEmail(
    email: string,
  ): Promise<
    Array<IStoreUserInternal & { companyUuid: string; companyName: string }>
  > {
    const knex = db("store");
    const records = await knex(this.tableName)
      .join("companies", `${this.tableName}.companyId`, "companies.id")
      .select(
        `${this.tableName}.*`,
        "companies.uuid as companyUuid",
        "companies.name as companyName",
      )
      .whereRaw(`LOWER(${this.tableName}.email) = LOWER(?)`, [email]);
    return records.map((r) => ({
      ...this.mapToInternalInterface(r),
      companyUuid: r.companyUuid,
      companyName: r.companyName,
    }));
  }

  // For authenticateStore + /me: returns the public (secret-stripped) store user plus
  // the company uuid + name, in one query. Returns null if the uuid is unknown.
  async getByUuidWithCompany(
    uuid: string,
  ): Promise<
    (IStoreUser & { companyUuid: string; companyName: string }) | null
  > {
    const knex = db("store");
    const record = await knex(this.tableName)
      .join("companies", `${this.tableName}.companyId`, "companies.id")
      .select(
        `${this.tableName}.*`,
        "companies.uuid as companyUuid",
        "companies.name as companyName",
      )
      .where(`${this.tableName}.uuid`, uuid)
      .first();
    return record
      ? {
          ...this.mapToInterface(record),
          companyUuid: record.companyUuid,
          companyName: record.companyName,
        }
      : null;
  }

  // Stamp last login. Fire-and-forget from the controller after a successful auth.
  async updateLastLogin(id: number): Promise<void> {
    const knex = db("store");
    await knex(this.tableName)
      .where("id", id)
      .update({ lastLoginAt: knex.fn.now(), updatedAt: knex.fn.now() });
  }

  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IStoreUser>> {
    const knex = db("store");
    const offset = (page - 1) * limit;

    const [records, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((r) => this.mapToInterface(r)),
      page,
      limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IStoreUser>> {
    const knex = db("store");
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

    const [records, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((r) => this.mapToInterface(r)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  // SECURITY: passwordHash and invitationToken are deliberately NOT copied out here,
  // so they never reach the controller / client. Mirrors UserDAO's password strip.
  private mapToInterface(record: any): IStoreUser {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      isActive: record.isActive,
      emailVerified: record.emailVerified,
      invitationExpiresAt: record.invitationExpiresAt,
      invitedBy: record.invitedBy,
      lastLoginAt: record.lastLoginAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  // INTERNAL mapper — KEEPS secrets (passwordHash + invitationToken). Private; used only
  // by getInternalByEmail (login). Mirrors mapToInterface but does not strip secrets.
  // Deliberately NOT reusing the public secret-stripping mapToInterface.
  private mapToInternalInterface(record: any): IStoreUserInternal {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      isActive: record.isActive,
      emailVerified: record.emailVerified,
      invitationExpiresAt: record.invitationExpiresAt,
      invitedBy: record.invitedBy,
      lastLoginAt: record.lastLoginAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      passwordHash: record.passwordHash,
      invitationToken: record.invitationToken,
    };
  }
}
