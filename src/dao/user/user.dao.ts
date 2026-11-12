import { Knex } from "knex";
import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IUser, IUserWithCompany } from "../../interfaces/user/user.interfaces";
import {
  applyConfigDefaultSort,
  applySearch,
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type ParsedQuery,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { applyCompanyScope, companyFilterScope } from "../../utils/daoScope";
import { Request } from "express";
import { RolePolicyService } from "../../services/role-policy.service";

// companyId is intentionally absent — getAllWithFilters scopes through
// companyFilterScope(req); `filters.companyId` holds a uuid, not a column value.
const USER_FILTERS: FilterConfigs = {
  email: {
    column: "email",
    operator: "ILIKE",
  },
  firstName: {
    column: "firstName",
    operator: "ILIKE",
  },
  lastName: {
    column: "lastName",
    operator: "ILIKE",
  },
  role: {
    column: "role",
    operator: "=",
  },
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
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const USER_SORTING: SortConfigs = {
  email: { column: "email", natural: true },
  firstName: { column: "firstName", natural: true },
  lastName: { column: "lastName", natural: true },
  role: { column: "role" },
  isActive: { column: "isActive" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

export const USER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("users", {
  filters: USER_FILTERS,
  sorting: USER_SORTING,
  search: {
    columns: ["email", "firstName", "lastName"],
    operator: "ILIKE",
  },
  defaultSort: {
    column: "firstName",
    order: "asc",
    natural: true,
    thenBy: [
      { column: "lastName", order: "asc", natural: true },
      { column: "email", order: "asc", natural: true },
    ],
  },
});

export type IUserWithSession = {
  id: number;
  uuid: string;
  email: string;
  role: "member" | "admin" | "superAdmin";
  isActive: boolean;
  companyUuid: string | null;
  sessionAlive: boolean;
  sessionDeviceUuid: string | null;
};

export class UserDAO implements IBaseDAO<IUser> {
  private tableName = "users";
  private queryConfig = USER_QUERY_CONFIG;

  async create(item: IUser): Promise<IUser> {
    const knex = db("core");
    const [user] = await knex(this.tableName)
      .insert({
        email: item.email,
        password: item.password,
        firstName: item.firstName,
        lastName: item.lastName,
        role: item.role,
        companyId: item.companyId,
        isActive: item.isActive ?? true,
        emailVerified: item.emailVerified ?? false,
      })
      .returning("*");

    return this.mapToInterface(user);
  }

  async getById(id: number): Promise<IUser | null> {
    const knex = db("core");
    const user = await knex(this.tableName).where("id", id).first();

    return user ? this.mapToInterface(user) : null;
  }

  async getByUuid(uuid: string): Promise<IUser | null> {
    const knex = db("core");
    const user = await knex(this.tableName).where("uuid", uuid).first();

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * The authenticate reload: user, company uuid and the token's session in ONE
   * query. Selects its own columns (L-008) — never route this through
   * `mapToInterface`, which drops what the gate needs. `sid` must already be a
   * well-formed uuid or Postgres throws.
   */
  async getByUuidWithSession(
    uuid: string,
    sid: string,
  ): Promise<IUserWithSession | null> {
    const knex = db("core");
    const row = await knex(this.tableName)
      .select(
        "users.id",
        "users.uuid",
        "users.email",
        "users.role",
        "users.isActive",
        "companies.uuid as companyUuid",
        "user_devices.uuid as sessionDeviceUuid",
        knex.raw(
          '(refresh_sessions.id IS NOT NULL AND refresh_sessions."revokedAt" IS NULL AND refresh_sessions."expiresAt" > now()) AS "sessionAlive"',
        ),
      )
      .leftJoin("companies", "users.companyId", "companies.id")
      .leftJoin("refresh_sessions", function () {
        this.on("refresh_sessions.uuid", "=", knex.raw("?", [sid])).andOn(
          "refresh_sessions.userId",
          "=",
          "users.id",
        );
      })
      .leftJoin("user_devices", "refresh_sessions.deviceId", "user_devices.id")
      .where("users.uuid", uuid)
      .first();

    return row ?? null;
  }

  /**
   * The A-4 lock: every issuance and every revocation of a user's sessions
   * takes this row first, so a deactivation or password change cannot
   * interleave with a login or refresh. Returns the locked row for rechecks.
   */
  async lockForSessionChange(
    id: number,
    trx?: Knex.Transaction,
  ): Promise<{ id: number; isActive: boolean; password: string } | null> {
    const row = await (trx ?? db("core"))(this.tableName)
      .select("id", "isActive", "password")
      .where({ id })
      .forUpdate()
      .first();
    return row ?? null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = db("core");
    const user = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return user ? user.id : null;
  }

  /** Returns the previous avatar uuid (null if none) so the caller can drop the old object. */
  async setAvatar(
    id: number,
    avatarUuid: string | null,
    avatarContentType: string | null,
  ): Promise<{ previousAvatarUuid: string | null }> {
    return db("core").transaction(async (trx) => {
      const current = await trx(this.tableName)
        .where("id", id)
        .forUpdate()
        .select("avatarUuid")
        .first();
      await trx(this.tableName)
        .where("id", id)
        .update({ avatarUuid, avatarContentType, updatedAt: trx.fn.now() });
      return { previousAvatarUuid: current?.avatarUuid ?? null };
    });
  }

  /** Raw lookup for the public avatar route; content type never reaches payloads. */
  async getByAvatarUuid(
    avatarUuid: string,
  ): Promise<{ avatarUuid: string; avatarContentType: string } | null> {
    const row = await db("core")(this.tableName)
      .where("avatarUuid", avatarUuid)
      .select("avatarUuid", "avatarContentType")
      .first();
    return row ?? null;
  }

  async update(
    id: number,
    item: Partial<IUser>,
    trx?: Knex.Transaction,
  ): Promise<IUser | null> {
    const knex = trx ?? db("core");
    const updateData: any = {};

    if (item.email !== undefined) updateData.email = item.email;
    if (item.password !== undefined) updateData.password = item.password;
    if (item.firstName !== undefined) updateData.firstName = item.firstName;
    if (item.lastName !== undefined) updateData.lastName = item.lastName;
    if (item.role !== undefined) updateData.role = item.role;
    if (item.roleId !== undefined) updateData.roleId = item.roleId;
    if (item.companyId !== undefined) updateData.companyId = item.companyId;
    if (item.isActive !== undefined) updateData.isActive = item.isActive;
    if (item.emailVerified !== undefined)
      updateData.emailVerified = item.emailVerified;

    updateData.updatedAt = knex.fn.now();

    const [user] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Deactivating a user is only risky when they hold the company's Admin
   * role and are the last active one — the row lock and the write have to be
   * the SAME transaction, or two concurrent deactivations could both pass
   * the count check before either writes. `isCurrentActiveAdmin` is
   * `true` when the caller has already confirmed the target is active on the
   * Admin role; passing `false` skips the lock entirely (member deactivation,
   * or reactivation, never threatens the invariant).
   */
  async setActiveChecked(
    id: number,
    companyId: number,
    isActive: boolean,
    isCurrentActiveAdmin: boolean,
    outer?: Knex.Transaction,
  ): Promise<IUser | null> {
    const knex = outer ?? db("core");
    return knex.transaction(async (trx) => {
      if (!isActive) {
        await RolePolicyService.assertNotLastAdmin(
          trx,
          companyId,
          isCurrentActiveAdmin,
        );
      }
      const [user] = await trx(this.tableName)
        .where("id", id)
        .update({ isActive, updatedAt: trx.fn.now() })
        .returning("*");
      return user ? this.mapToInterface(user) : null;
    });
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("core");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * @deprecated Use getAllWithFilters for advanced querying.
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IUser>> {
    const knex = db("core");
    const offset = (page - 1) * limit;

    const [users, totalResult] = await Promise.all([
      applyConfigDefaultSort(knex(this.tableName), this.queryConfig)
        .select(
          `${this.tableName}.*`,
          "companies.name as companyName",
          "companies.uuid as companyUuid",
        )
        .leftJoin("companies", `${this.tableName}.companyId`, "companies.id")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: users.map((user) => this.mapToInterfaceWithCompanyName(user)),
      page,
      limit,
      count: users.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<
    IDataPaginator<
      IUser & { companyName?: string; roleUuid?: string; roleName?: string }
    >
  > {
    const knex = db("core");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    // roleUuid resolves against the joined `roles` table, which the shared
    // filter config (scoped to this.tableName's own columns) cannot express
    // (L-007: still wired, just not through FilterConfigs — see queryBuilder.ts
    // `applyFilters`, which always qualifies with `${tableName}.${column}`).
    const roleUuidFilter = parsedQuery.filters.roleUuid as string | undefined;
    delete parsedQuery.filters.roleUuid;

    const dataQuery = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        "companies.name as companyName",
        "roles.uuid as roleUuid",
        "roles.name as roleName",
      )
      .leftJoin("companies", `${this.tableName}.companyId`, "companies.id")
      .leftJoin("roles", `${this.tableName}.roleId`, "roles.id");

    applyCompanyScope(dataQuery, this.tableName, companyId);

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName).leftJoin(
      "roles",
      `${this.tableName}.roleId`,
      "roles.id",
    );

    applyCompanyScope(countQuery, this.tableName, companyId);

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    if (roleUuidFilter) {
      dataQuery.where("roles.uuid", roleUuidFilter);
      countQuery.where("roles.uuid", roleUuidFilter);
    }

    const [users, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: users.map((user) => this.mapToInterfaceWithCompanyName(user)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: users.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getAllByCompany(
    companyId: number,
    page: number,
    limit: number,
    roleUuid?: string,
    search?: string,
  ): Promise<IDataPaginator<IUser>> {
    const knex = db("core");
    const offset = (page - 1) * limit;

    const dataQuery = applyConfigDefaultSort(
      knex(this.tableName),
      this.queryConfig,
    )
      .select(
        `${this.tableName}.*`,
        "companies.name as companyName",
        "companies.uuid as companyUuid",
        "roles.uuid as roleUuid",
        "roles.name as roleName",
      )
      .leftJoin("companies", `${this.tableName}.companyId`, "companies.id")
      .leftJoin("roles", `${this.tableName}.roleId`, "roles.id")
      .where(`${this.tableName}.companyId`, companyId)
      .limit(limit)
      .offset(offset);

    const countQuery = knex(this.tableName)
      .leftJoin("roles", `${this.tableName}.roleId`, "roles.id")
      .where(`${this.tableName}.companyId`, companyId);

    // L-007: `roleUuid` is wired here (not through FilterConfigs, which the
    // company-scoped list path bypasses) rather than silently ignored.
    if (roleUuid) {
      dataQuery.where("roles.uuid", roleUuid);
      countQuery.where("roles.uuid", roleUuid);
    }

    applySearch(dataQuery, search, this.queryConfig.search, this.tableName);
    applySearch(countQuery, search, this.queryConfig.search, this.tableName);

    const [users, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: users.map((user) => this.mapToInterfaceWithCompanyName(user)),
      page,
      limit,
      count: users.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    const knex = db("core");
    const user = await knex(this.tableName).where("email", email).first();

    return user ? this.mapToInterface(user) : null;
  }

  // Emails of ACTIVE 'admin' users for a company — recipients of the new-order
  // notification. superAdmins have no companyId so the companyId filter excludes
  // them by construction. Single column-projection query; returns a flat string[].
  async getActiveAdminEmailsByCompany(companyId: number): Promise<string[]> {
    const knex = db("core");
    const rows = await knex(this.tableName)
      .where("companyId", companyId)
      .andWhere("role", "admin")
      .andWhere("isActive", true)
      .select("email");

    return rows.map((r) => r.email);
  }

  /**
   * Uses PostgreSQL to_jsonb so the joined company comes back as a nested object.
   * Strips password before returning.
   */
  async getUserByEmailWithCompany(
    email: string,
  ): Promise<IUserWithCompany | null> {
    const knex = db("core");

    const user = await knex(this.tableName)
      .select("users.*", knex.raw("to_jsonb(companies.*) as company"))
      .leftJoin("companies", "users.companyId", "companies.id")
      .where("users.email", email)
      .first();

    if (!user) return null;

    const mapped = this.mapToInterface(user);
    // SECURITY: strip password hash before sending to client.
    const { password, ...userWithoutPassword } = mapped;

    return {
      ...userWithoutPassword,
      company: user.company,
    } as IUserWithCompany;
  }

  async getUserWithCompany(uuid: string): Promise<IUserWithCompany | null> {
    const knex = db("core");

    const user = await knex(this.tableName)
      .select("users.*", knex.raw("to_jsonb(companies.*) as company"))
      .leftJoin("companies", "users.companyId", "companies.id")
      .where("users.uuid", uuid)
      .first();

    if (!user) return null;

    const mapped = this.mapToInterface(user);
    // SECURITY: strip password hash before sending to client.
    const { password, ...userWithoutPassword } = mapped;

    return {
      ...userWithoutPassword,
      company: user.company,
    } as IUserWithCompany;
  }

  private mapToInterface(record: any): IUser {
    return {
      id: record.id,
      uuid: record.uuid,
      email: record.email,
      password: record.password,
      firstName: record.firstName,
      lastName: record.lastName,
      role: record.role,
      companyId: record.companyId,
      isActive: record.isActive,
      emailVerified: record.emailVerified,
      avatarUuid: record.avatarUuid ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapToInterfaceWithCompanyName(
    record: any,
  ): IUser & { companyName?: string; roleUuid?: string; roleName?: string } {
    return {
      ...this.mapToInterface(record),
      // SECURITY (M3): expose the company as its UUID, never the internal numeric id.
      companyId: record.companyUuid || undefined,
      companyName: record.companyName || undefined,
      roleUuid: record.roleUuid || undefined,
      roleName: record.roleName || undefined,
    };
  }
}
