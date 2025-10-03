import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IUser, IUserWithCompany } from "../../interfaces/user/user.interfaces";

export class UserDAO implements IBaseDAO<IUser> {
  private tableName = "users";

  /**
   * Create a new user
   */
  async create(item: IUser): Promise<IUser> {
    const knex = KnexManager.getConnection();
    const [user] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        email: item.email,
        password: item.password,
        first_name: item.firstName,
        last_name: item.lastName,
        role: item.role,
        company_id: item.companyId,
        is_active: item.isActive ?? true,
        email_verified: item.emailVerified ?? false,
      })
      .returning("*");

    return this.mapToInterface(user);
  }

  /**
   * Get user by ID
   */
  async getById(id: number): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("id", id).first();

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Get user by UUID
   */
  async getByUuid(uuid: string): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const user = await knex(this.tableName).where("uuid", uuid).first();

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Update user by ID
   */
  async update(id: number, item: Partial<IUser>): Promise<IUser | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.email !== undefined) updateData.email = item.email;
    if (item.password !== undefined) updateData.password = item.password;
    if (item.firstName !== undefined) updateData.first_name = item.firstName;
    if (item.lastName !== undefined) updateData.last_name = item.lastName;
    if (item.role !== undefined) updateData.role = item.role;
    if (item.companyId !== undefined) updateData.company_id = item.companyId;
    if (item.isActive !== undefined) updateData.is_active = item.isActive;
    if (item.emailVerified !== undefined)
      updateData.email_verified = item.emailVerified;

    updateData.updated_at = knex.fn.now();

    const [user] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return user ? this.mapToInterface(user) : null;
  }

  /**
   * Delete user by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all users with pagination
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IUser>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [users, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: users.map((user) => this.mapToInterface(user)),
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
   * Get user with company by UUID (using to_jsonb for join)
   */
  async getUserWithCompany(uuid: string): Promise<IUserWithCompany | null> {
    const knex = KnexManager.getConnection();

    const user = await knex(this.tableName)
      .select(
        "users.*",
        knex.raw("to_jsonb(companies.*) as company")
      )
      .leftJoin("companies", "users.company_id", "companies.id")
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
      firstName: record.first_name ?? record.firstName,
      lastName: record.last_name ?? record.lastName,
      role: record.role,
      companyId: record.company_id ?? record.companyId,
      isActive: record.is_active ?? record.isActive,
      emailVerified: record.email_verified ?? record.emailVerified,
      createdAt: record.created_at ?? record.createdAt,
      updatedAt: record.updated_at ?? record.updatedAt,
    };
  }
}
