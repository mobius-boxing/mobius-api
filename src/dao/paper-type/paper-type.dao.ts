import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperType } from "../../interfaces/paper-type/paper-type.interfaces";

export class PaperTypeDAO implements IBaseDAO<IPaperType> {
  private tableName = "paper_types";

  /**
   * Create a new paper type
   */
  async create(item: IPaperType): Promise<IPaperType> {
    const knex = KnexManager.getConnection();
    const [paperType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(paperType);
  }

  /**
   * Get paper type by ID
   */
  async getById(id: number): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const paperType = await knex(this.tableName).where("id", id).first();

    return paperType ? this.mapToInterface(paperType) : null;
  }

  /**
   * Get paper type by UUID
   */
  async getByUuid(uuid: string): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const paperType = await knex(this.tableName).where("uuid", uuid).first();

    return paperType ? this.mapToInterface(paperType) : null;
  }

  /**
   * Update paper type by ID
   */
  async update(
    id: number,
    item: Partial<IPaperType>,
  ): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [paperType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperType ? this.mapToInterface(paperType) : null;
  }

  /**
   * Delete paper type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all paper types with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IPaperType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [paperTypes, totalResult] = await Promise.all([
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
      data: paperTypes.map((paperType) => this.mapToInterface(paperType)),
      page,
      limit,
      count: paperTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IPaperType {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
