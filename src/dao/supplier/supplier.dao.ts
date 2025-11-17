import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ISupplier } from "../../interfaces/supplier/supplier.interfaces";

export class SupplierDAO implements IBaseDAO<ISupplier> {
  private tableName = "suppliers";

  /**
   * Create a new supplier
   */
  async create(item: ISupplier): Promise<ISupplier> {
    const knex = KnexManager.getConnection();
    const [supplier] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        suppliesSheets: item.suppliesSheets ?? false,
        suppliesElaborated: item.suppliesElaborated ?? false,
        suppliesConsumables: item.suppliesConsumables ?? false,
        suppliesPaper: item.suppliesPaper ?? false,
        suppliesTooling: item.suppliesTooling ?? false,
      })
      .returning("*");

    return this.mapToInterface(supplier);
  }

  /**
   * Get supplier by ID
   */
  async getById(id: number): Promise<ISupplier | null> {
    const knex = KnexManager.getConnection();
    const supplier = await knex(this.tableName).where("id", id).first();

    return supplier ? this.mapToInterface(supplier) : null;
  }

  /**
   * Get supplier by UUID
   */
  async getByUuid(uuid: string): Promise<ISupplier | null> {
    const knex = KnexManager.getConnection();
    const supplier = await knex(this.tableName).where("uuid", uuid).first();

    return supplier ? this.mapToInterface(supplier) : null;
  }

  /**
   * Get supplier numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const supplier = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return supplier ? supplier.id : null;
  }

  /**
   * Update supplier by ID
   */
  async update(
    id: number,
    item: Partial<ISupplier>,
  ): Promise<ISupplier | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.suppliesSheets !== undefined)
      updateData.suppliesSheets = item.suppliesSheets;
    if (item.suppliesElaborated !== undefined)
      updateData.suppliesElaborated = item.suppliesElaborated;
    if (item.suppliesConsumables !== undefined)
      updateData.suppliesConsumables = item.suppliesConsumables;
    if (item.suppliesPaper !== undefined)
      updateData.suppliesPaper = item.suppliesPaper;
    if (item.suppliesTooling !== undefined)
      updateData.suppliesTooling = item.suppliesTooling;

    updateData.updatedAt = knex.fn.now();

    const [supplier] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return supplier ? this.mapToInterface(supplier) : null;
  }

  /**
   * Delete supplier by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all suppliers with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<ISupplier>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [suppliers, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("code", "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: suppliers.map((supplier) => this.mapToInterface(supplier)),
      page,
      limit,
      count: suppliers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ISupplier {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      suppliesSheets: record.suppliesSheets ?? false,
      suppliesElaborated: record.suppliesElaborated ?? false,
      suppliesConsumables: record.suppliesConsumables ?? false,
      suppliesPaper: record.suppliesPaper ?? false,
      suppliesTooling: record.suppliesTooling ?? false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
