import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICompany } from "../../interfaces/company/company.interfaces";

export class CompanyDAO implements IBaseDAO<ICompany> {
  private tableName = "companies";

  /**
   * Create a new company
   */
  async create(item: ICompany): Promise<ICompany> {
    const knex = KnexManager.getConnection();
    const [company] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        name: item.name,
        description: item.description,
        isActive: item.isActive ?? true,
      })
      .returning("*");

    return this.mapToInterface(company);
  }

  /**
   * Get company by ID
   */
  async getById(id: number): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();
    const company = await knex(this.tableName).where("id", id).first();

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Get company by UUID
   */
  async getByUuid(uuid: string): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();
    const company = await knex(this.tableName).where("uuid", uuid).first();

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Update company by ID
   */
  async update(id: number, item: Partial<ICompany>): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined) updateData.description = item.description;
    if (item.isActive !== undefined) updateData.isActive = item.isActive;

    updateData.updated_at = knex.fn.now();

    const [company] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Delete company by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all companies with pagination
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<ICompany>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [companies, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: companies.map((company) => this.mapToInterface(company)),
      page,
      limit,
      count: companies.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get company with user count by UUID
   */
  async getCompanyWithUserCount(uuid: string): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();

    const company = await knex(this.tableName)
      .select(
        "companies.*",
        knex.raw("COUNT(users.id)::int as user_count")
      )
      .leftJoin("users", "companies.id", "users.company_id")
      .where("companies.uuid", uuid)
      .groupBy("companies.id")
      .first();

    if (!company) return null;

    const mapped = this.mapToInterface(company);
    mapped.userCount = company.user_count;

    return mapped;
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ICompany {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      description: record.description,
      isActive: record.isActive,
      createdAt: record.created_at ?? record.createdAt,
      updatedAt: record.updated_at ?? record.updatedAt,
    };
  }
}
