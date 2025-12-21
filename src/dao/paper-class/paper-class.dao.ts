import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperClass } from "../../interfaces/paper-class/paper-class.interfaces";

export class PaperClassDAO implements IBaseDAO<IPaperClass> {
  private tableName = "paper_classes";

  /**
   * Create a new paper class
   */
  async create(item: IPaperClass): Promise<IPaperClass> {
    const knex = KnexManager.getConnection();
    const [paperClass] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
        papers: JSON.stringify(item.papers),
      })
      .returning("*");

    return this.mapToInterface(paperClass);
  }

  /**
   * Get paper class by ID
   */
  async getById(id: number): Promise<IPaperClass | null> {
    const knex = KnexManager.getConnection();
    const paperClass = await knex(this.tableName).where("id", id).first();

    return paperClass ? this.mapToInterface(paperClass) : null;
  }

  /**
   * Get paper class by UUID
   */
  async getByUuid(uuid: string): Promise<IPaperClass | null> {
    const knex = KnexManager.getConnection();
    const paperClass = await knex(this.tableName).where("uuid", uuid).first();

    return paperClass ? this.mapToInterface(paperClass) : null;
  }

  /**
   * Update paper class by ID
   */
  async update(
    id: number,
    item: Partial<IPaperClass>,
  ): Promise<IPaperClass | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.papers !== undefined)
      updateData.papers = JSON.stringify(item.papers);

    updateData.updatedAt = knex.fn.now();

    const [paperClass] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperClass ? this.mapToInterface(paperClass) : null;
  }

  /**
   * Delete paper class by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all paper classes with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IPaperClass>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [paperClasses, totalResult] = await Promise.all([
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
      data: paperClasses.map((paperClass) => this.mapToInterface(paperClass)),
      page,
      limit,
      count: paperClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IPaperClass {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      papers:
        typeof record.papers === "string"
          ? JSON.parse(record.papers)
          : record.papers,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
