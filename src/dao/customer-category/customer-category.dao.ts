import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICustomerCategory } from "../../interfaces/customer-category/customer-category.interfaces";

export class CustomerCategoryDAO implements IBaseDAO<ICustomerCategory> {
  private tableName = "customer_categories";

  /**
   * Create a new customer category
   */
  async create(item: ICustomerCategory): Promise<ICustomerCategory> {
    const knex = KnexManager.getConnection();
    const [category] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        name: item.name,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(category);
  }

  /**
   * Get customer category by ID
   */
  async getById(id: number): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const category = await knex(this.tableName).where("id", id).first();

    return category ? this.mapToInterface(category) : null;
  }

  /**
   * Get customer category by UUID
   */
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const category = await query.select(`${this.tableName}.*`).first();

    return category ? this.mapToInterface(category) : null;
  }

  /**
   * Get customer category numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const category = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return category ? category.id : null;
  }

  /**
   * Update customer category by ID
   */
  async update(
    id: number,
    item: Partial<ICustomerCategory>,
  ): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.companyId !== undefined) updateData.companyId = item.companyId;

    updateData.updatedAt = knex.fn.now();

    const [category] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return category ? this.mapToInterface(category) : null;
  }

  /**
   * Delete customer category by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all customer categories with pagination
   */
  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<ICustomerCategory>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
    const countQuery = knex(this.tableName);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const [categories, totalResult] = await Promise.all([
      query
        .select(`${this.tableName}.*`)
        .orderBy(`${this.tableName}.name`, "asc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: categories.map((category) => this.mapToInterface(category)),
      page,
      limit,
      count: categories.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ICustomerCategory {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
