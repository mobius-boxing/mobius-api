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

/**
 * User filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
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

/**
 * User sort configuration
 */
const USER_SORTING: SortConfigs = {
  email: { column: "email" },
  firstName: { column: "firstName" },
  lastName: { column: "lastName" },
  role: { column: "role" },
  isActive: { column: "isActive" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * User query builder configuration
 */
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

  /**
   * Create a new user
   */
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

  /**
   * Get user by numeric ID
   */
  async getById(id: number): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("id", id).first();

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Get user by UUID string
   */
  async getByUuid(uuid: string): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("uuid", uuid).first();

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Get user numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return user ? user.id : null;
  }

  /**
   * Update user by numeric ID
   */
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

  /**
   * Delete user by numeric ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all users with pagination (includes company name)
   * @deprecated Use getAllWithFilters for advanced querying
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

  /**
   * Get all users with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=email&sortOrder=asc)
   * - email: Filter by email (ILIKE)
   * - firstName: Filter by first name (ILIKE)
   * - lastName: Filter by last name (ILIKE)
   * - role: Filter by role (exact match)
   * - companyId: Filter by company ID
   * - isActive: Filter by active status (boolean)
   * - emailVerified: Filter by email verified status (boolean)
   * - search: Full-text search on email, firstName, lastName (e.g., ?search=TEST)
   */
  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IUser & { companyName?: string }>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Extract companyId (UUID) from filters - handle it separately
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // Build main query with join for company name
    const dataQuery = knex(this.tableName)
      .select(`${this.tableName}.*`, "companies.name as companyName")
      .leftJoin("companies", `${this.tableName}.companyId`, "companies.id");

    // Filter by company UUID if provided
    if (companyUuid) {
      dataQuery.where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
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

  /**
   * Get all users by company with pagination (includes company name)
   */
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

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("email", email).first();

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Get user by email with company information (using to_jsonb for join)
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
    // Remove password from response
    const { password, ...userWithoutPassword } = mapped;

    return {
      ...userWithoutPassword,
      company: user.company,
    } as IUserWithCompany;
  }

  /**
   * Get user with company by UUID (using to_jsonb for join)
   */
  async getUserWithCompany(uuid: string): Promise<IUserWithCompany | null> {
    const knex = KnexManager.getConnection();

    const user = await knex(this.tableName)
      .select("users.*", knex.raw("to_jsonb(companies.*) as company"))
      .leftJoin("companies", "users.companyId", "companies.id")
      .where("users.uuid", uuid)
      .first();

    if (!user) return null;

    const mapped = this.mapToInterface(user);
    // Remove password from response
    const { password, ...userWithoutPassword } = mapped;

    return {
      ...userWithoutPassword,
      company: user.company,
    } as IUserWithCompany;
  }

  /**
   * Map database record to interface
   */
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

  /**
   * Map database record to interface with company name
   */
  private mapToInterfaceWithCompanyName(
    record: any,
  ): IUser & { companyName?: string } {
    return {
      ...this.mapToInterface(record),
      companyName: record.companyName || undefined,
    };
  }
}
