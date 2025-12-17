import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICorrugation } from "../../interfaces/corrugation/corrugation.interfaces";

export class CorrugationDAO implements IBaseDAO<ICorrugation> {
  private tableName = "corrugations";

  /**
   * Create a new corrugation
   */
  async create(item: ICorrugation): Promise<ICorrugation> {
    const knex = KnexManager.getConnection();
    const [corrugation] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
        theoreticalGrammage: item.theoreticalGrammage,
        suggestedWidth: item.suggestedWidth,
        caliper: item.caliper,
        corrugationClassId: item.corrugationClassId,
      })
      .returning("*");

    return this.mapToInterface(corrugation);
  }

  /**
   * Get corrugation by ID
   */
  async getById(id: number): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const corrugation = await knex(this.tableName).where("id", id).first();

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  /**
   * Get corrugation by UUID with related corrugation class
   */
  async getByUuid(uuid: string): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const corrugation = await knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`
          CASE
            WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
            ELSE NULL
          END as "corrugationClass"
        `)
      )
      .leftJoin("corrugation_classes as cc", `${this.tableName}.corrugationClassId`, "cc.id")
      .where(`${this.tableName}.uuid`, uuid)
      .first();

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  /**
   * Update corrugation by ID
   */
  async update(
    id: number,
    item: Partial<ICorrugation>,
  ): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;
    if (item.theoreticalGrammage !== undefined) updateData.theoreticalGrammage = item.theoreticalGrammage;
    if (item.suggestedWidth !== undefined) updateData.suggestedWidth = item.suggestedWidth;
    if (item.caliper !== undefined) updateData.caliper = item.caliper;
    if (item.corrugationClassId !== undefined) updateData.corrugationClassId = item.corrugationClassId;

    updateData.updatedAt = knex.fn.now();

    const [corrugation] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  /**
   * Delete corrugation by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all corrugations with pagination
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<ICorrugation>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [corrugations, totalResult] = await Promise.all([
      knex(this.tableName)
        .select(
          `${this.tableName}.*`,
          knex.raw(`
            CASE
              WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
              ELSE NULL
            END as "corrugationClass"
          `)
        )
        .leftJoin("corrugation_classes as cc", `${this.tableName}.corrugationClassId`, "cc.id")
        .orderBy(`${this.tableName}.code`, "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: corrugations.map((item) => this.mapToInterface(item)),
      page,
      limit,
      count: corrugations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ICorrugation {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      theoreticalGrammage: record.theoreticalGrammage ? parseFloat(record.theoreticalGrammage) : undefined,
      suggestedWidth: record.suggestedWidth ? parseFloat(record.suggestedWidth) : undefined,
      caliper: record.caliper ? parseFloat(record.caliper) : undefined,
      corrugationClassId: record.corrugationClassId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      corrugationClass: record.corrugationClass,
    };
  }
}
