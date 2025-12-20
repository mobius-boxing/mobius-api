import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICorrugationClass } from "../../interfaces/corrugation-class/corrugation-class.interfaces";

export class CorrugationClassDAO implements IBaseDAO<ICorrugationClass> {
  private tableName = "corrugation_classes";

  /**
   * Create a new corrugation class
   */
  async create(item: ICorrugationClass): Promise<ICorrugationClass> {
    const knex = KnexManager.getConnection();
    const [corrugationClass] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(corrugationClass);
  }

  /**
   * Get corrugation class by ID
   */
  async getById(id: number): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const corrugationClass = await knex(this.tableName).where("id", id).first();

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  /**
   * Get corrugation class by UUID
   */
  async getByUuid(uuid: string): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const corrugationClass = await knex(this.tableName).where("uuid", uuid).first();

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  /**
   * Update corrugation class by ID
   */
  async update(
    id: number,
    item: Partial<ICorrugationClass>,
  ): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [corrugationClass] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  /**
   * Delete corrugation class by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all corrugation classes with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<ICorrugationClass>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [corrugationClasses, totalResult] = await Promise.all([
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
      data: corrugationClasses.map((item) => this.mapToInterface(item)),
      page,
      limit,
      count: corrugationClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   * SECURITY: Never expose numeric IDs to frontend - only UUIDs
   */
  private mapToInterface(record: any): ICorrugationClass {
    return {
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Internal method to map with ID (for internal use only, never send to frontend)
   */
  private mapToInternalInterface(record: any): ICorrugationClass & { id: number } {
    return {
      id: record.id,
      ...this.mapToInterface(record),
    };
  }

  /**
   * Get internal numeric ID by UUID (for internal use only, never expose to frontend)
   * Used by controllers when they need to perform update/delete operations
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).select("id").where("uuid", uuid).first();
    return record ? record.id : null;
  }
}
