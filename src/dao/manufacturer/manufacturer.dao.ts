import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IManufacturer } from "../../interfaces/manufacturer/manufacturer.interfaces";

export class ManufacturerDAO implements IBaseDAO<IManufacturer> {
  private tableName = "manufacturers";

  /**
   * Create a new manufacturer
   */
  async create(item: IManufacturer): Promise<IManufacturer> {
    const knex = KnexManager.getConnection();
    const [manufacturer] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
      })
      .returning("*");

    return this.mapToInterface(manufacturer);
  }

  /**
   * Get manufacturer by ID
   */
  async getById(id: number): Promise<IManufacturer | null> {
    const knex = KnexManager.getConnection();
    const manufacturer = await knex(this.tableName).where("id", id).first();

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  /**
   * Get manufacturer by UUID
   */
  async getByUuid(uuid: string): Promise<IManufacturer | null> {
    const knex = KnexManager.getConnection();
    const manufacturer = await knex(this.tableName)
      .where("uuid", uuid)
      .first();

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  /**
   * Get manufacturer numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const manufacturer = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return manufacturer ? manufacturer.id : null;
  }

  /**
   * Update manufacturer by ID
   */
  async update(
    id: number,
    item: Partial<IManufacturer>,
  ): Promise<IManufacturer | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;

    updateData.updatedAt = knex.fn.now();

    const [manufacturer] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  /**
   * Delete manufacturer by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all manufacturers with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IManufacturer>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [manufacturers, totalResult] = await Promise.all([
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
      data: manufacturers.map((manufacturer) =>
        this.mapToInterface(manufacturer),
      ),
      page,
      limit,
      count: manufacturers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IManufacturer {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
