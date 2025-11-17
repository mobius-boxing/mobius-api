import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IProduct } from "../../interfaces/product/product.interfaces";

export class ProductDAO implements IBaseDAO<IProduct> {
  private tableName = "products";

  /**
   * Create a new product
   */
  async create(item: IProduct): Promise<IProduct> {
    const knex = KnexManager.getConnection();
    const [product] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        clientCode: item.clientCode,
        description: item.description,
        customerId: item.customerId,
      })
      .returning("*");

    return this.mapToInterface(product);
  }

  /**
   * Get product by ID
   */
  async getById(id: number): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();
    const product = await knex(this.tableName).where("id", id).first();

    return product ? this.mapToInterface(product) : null;
  }

  /**
   * Get product by UUID
   */
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const product = await query.select(`${this.tableName}.*`).first();

    return product ? this.mapToInterface(product) : null;
  }

  /**
   * Update product by ID
   */
  async update(
    id: number,
    item: Partial<IProduct>,
  ): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.clientCode !== undefined) updateData.clientCode = item.clientCode;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.customerId !== undefined) updateData.customerId = item.customerId;

    updateData.updatedAt = knex.fn.now();

    const [product] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return product ? this.mapToInterface(product) : null;
  }

  /**
   * Delete product by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all products with pagination
   */
  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<IProduct>> {
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

    const [products, totalResult] = await Promise.all([
      query
        .select(`${this.tableName}.*`)
        .orderBy(`${this.tableName}.createdAt`, "desc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: products.map((product) => this.mapToInterface(product)),
      page,
      limit,
      count: products.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get product with related details (customer) using to_jsonb
   */
  async getWithDetails(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();

    const query = knex(this.tableName)
      .select(
        "products.*",
        knex.raw("to_jsonb(customers.*) as customer"),
      )
      .leftJoin("customers", "products.customerId", "customers.id")
      .where("products.uuid", uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", "products.companyId", "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const product = await query.first();

    if (!product) return null;

    const mapped = this.mapToInterface(product);
    mapped.customer = product.customer;

    return mapped;
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IProduct {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      clientCode: record.clientCode,
      description: record.description,
      customerId: record.customerId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
