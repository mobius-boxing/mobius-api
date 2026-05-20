import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IUser, IUserWithCompany } from "../../interfaces/user/user.interfaces";
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
  email: { column: "email" },
  firstName: { column: "firstName" },
  lastName: { column: "lastName" },
  role: { column: "role" },
  isActive: { column: "isActive" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const USER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("users", {
  filters: USER_FILTERS,
  sorting: USER_SORTING,
  search: {
    columns: ["email", "firstName", "lastName"],
    operator: "ILIKE",
  },
  defaultSort: {
    column: "createdAt",
    order: "desc",
  },
});

export class UserDAO implements IBaseDAO<IUser> {
  private tableName = "users";
  private queryConfig = USER_QUERY_CONFIG;

  async create(item: IUser): Promise<IUser> {
    const knex = KnexManager.getConnection();
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
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("id", id).first();

    return user ? this.mapToInterface(user) : null;
  }

  async getByUuid(uuid: string): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("uuid", uuid).first();

    return user ? this.mapToInterface(user) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return user ? user.id : null;
  }

  async update(id: number, item: Partial<IUser>): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.email !== undefined) updateData.email = item.email;
    if (item.password !== undefined) updateData.password = item.password;
    if (item.firstName !== undefined) updateData.firstName = item.firstName;
    if (item.lastName !== undefined) updateData.lastName = item.lastName;
    if (item.role !== undefined) updateData.role = item.role;
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

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * @deprecated Use getAllWithFilters for advanced querying.
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IUser>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [users, totalResult] = await Promise.all([
      knex(this.tableName)
        .select(`${this.tableName}.*`, "companies.name as companyName")
        .leftJoin("companies", `${this.tableName}.companyId`, "companies.id")
        .orderBy(`${this.tableName}.createdAt`, "desc")
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
  ): Promise<IDataPaginator<IUser & { companyName?: string }>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid rather than
    // letting the query builder treat it as a column filter.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName)
      .select(`${this.tableName}.*`, "companies.name as companyName")
      .leftJoin("companies", `${this.tableName}.companyId`, "companies.id");

    if (companyUuid) {
      dataQuery.where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

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
  ): Promise<IDataPaginator<IUser>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [users, totalResult] = await Promise.all([
      knex(this.tableName)
        .select(`${this.tableName}.*`, "companies.name as companyName")
        .leftJoin("companies", `${this.tableName}.companyId`, "companies.id")
        .where(`${this.tableName}.companyId`, companyId)
        .orderBy(`${this.tableName}.createdAt`, "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName)
        .where("companyId", companyId)
        .count("* as count")
        .first(),
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
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("email", email).first();

    return user ? this.mapToInterface(user) : null;
  }

  // Emails of ACTIVE 'admin' users for a company — recipients of the new-order
  // notification. superAdmins have no companyId so the companyId filter excludes
  // them by construction. Single column-projection query; returns a flat string[].
  async getActiveAdminEmailsByCompany(companyId: number): Promise<string[]> {
    const knex = KnexManager.getConnection();
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
    const knex = KnexManager.getConnection();

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
    const knex = KnexManager.getConnection();

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
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapToInterfaceWithCompanyName(
    record: any,
  ): IUser & { companyName?: string } {
    return {
      ...this.mapToInterface(record),
      companyName: record.companyName || undefined,
    };
  }
}
