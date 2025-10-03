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
        customer_category_uuid: item.customerCategoryUuid,
        name: item.name,
        company_id: item.companyId,
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
  async getByUuid(uuid: string): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const category = await knex(this.tableName).where("uuid", uuid).first();

    return category ? this.mapToInterface(category) : null;
  }

  /**
   * Update customer category by ID
   */
  async update(id: number, item: Partial<ICustomerCategory>): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.companyId !== undefined) updateData.company_id = item.companyId;

    updateData.updated_at = knex.fn.now();

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
  async getAll(page: number, limit: number): Promise<IDataPaginator<ICustomerCategory>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [categories, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("name", "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
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
      customerCategoryUuid: record.customer_category_uuid ?? record.customerCategoryUuid,
      name: record.name,
      companyId: record.company_id ?? record.companyId,
      createdAt: record.created_at ?? record.createdAt,
      updatedAt: record.updated_at ?? record.updatedAt,
    };
  }
}
