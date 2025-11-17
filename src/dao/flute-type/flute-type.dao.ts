import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IFluteType } from "../../interfaces/flute-type/flute-type.interfaces";

export class FluteTypeDAO implements IBaseDAO<IFluteType> {
  private tableName = "flute_types";

  /**
   * Create a new flute type
   */
  async create(item: IFluteType): Promise<IFluteType> {
    const knex = KnexManager.getConnection();
    const [fluteType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
        fluteFactor: item.fluteFactor,
        length: item.length,
        width: item.width,
        height: item.height,
      })
      .returning("*");

    return this.mapToInterface(fluteType);
  }

  /**
   * Get flute type by ID
   */
  async getById(id: number): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const fluteType = await knex(this.tableName).where("id", id).first();

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  /**
   * Get flute type by UUID
   */
  async getByUuid(uuid: string): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const fluteType = await knex(this.tableName).where("uuid", uuid).first();

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  /**
   * Update flute type by ID
   */
  async update(
    id: number,
    item: Partial<IFluteType>,
  ): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;
    if (item.fluteFactor !== undefined) updateData.fluteFactor = item.fluteFactor;
    if (item.length !== undefined) updateData.length = item.length;
    if (item.width !== undefined) updateData.width = item.width;
    if (item.height !== undefined) updateData.height = item.height;

    updateData.updatedAt = knex.fn.now();

    const [fluteType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  /**
   * Delete flute type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all flute types with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IFluteType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [fluteTypes, totalResult] = await Promise.all([
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
      data: fluteTypes.map((fluteType) => this.mapToInterface(fluteType)),
      page,
      limit,
      count: fluteTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IFluteType {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      fluteFactor: parseFloat(record.fluteFactor),
      length: parseFloat(record.length),
      width: parseFloat(record.width),
      height: parseFloat(record.height),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
