import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IWarehouse } from "../../interfaces/warehouse/warehouse.interfaces";

export class WarehouseDAO implements IBaseDAO<IWarehouse> {
  private tableName = "warehouses";

  /**
   * Create a new warehouse
   */
  async create(item: IWarehouse): Promise<IWarehouse> {
    const knex = KnexManager.getConnection();
    const [warehouse] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        name: item.name,
      })
      .returning("*");

    return this.mapToInterface(warehouse);
  }

  /**
   * Get warehouse by ID
   */
  async getById(id: number): Promise<IWarehouse | null> {
    const knex = KnexManager.getConnection();
    const warehouse = await knex(this.tableName).where("id", id).first();

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  /**
   * Get warehouse by UUID
   */
  async getByUuid(uuid: string): Promise<IWarehouse | null> {
    const knex = KnexManager.getConnection();
    const warehouse = await knex(this.tableName).where("uuid", uuid).first();

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  /**
   * Get warehouse numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const warehouse = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return warehouse ? warehouse.id : null;
  }

  /**
   * Update warehouse by ID
   */
  async update(
    id: number,
    item: Partial<IWarehouse>,
  ): Promise<IWarehouse | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;

    updateData.updated_at = knex.fn.now();

    const [warehouse] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  /**
   * Delete warehouse by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all warehouses with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IWarehouse>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [warehouses, totalResult] = await Promise.all([
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
      data: warehouses.map((warehouse) => this.mapToInterface(warehouse)),
      page,
      limit,
      count: warehouses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IWarehouse {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }
}
