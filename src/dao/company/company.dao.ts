import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import {
  ICompany,
  ICompanyBranding,
} from "../../interfaces/company/company.interfaces";
import {
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type ParsedQuery,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { Request } from "express";
import { toDnsSlug } from "../../utils/slugify";

const COMPANY_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  isActive: {
    column: "isActive",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const COMPANY_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const COMPANY_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "companies",
  {
    filters: COMPANY_FILTERS,
    sorting: COMPANY_SORTING,
    search: {
      columns: ["name", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  },
);

export class CompanyDAO implements IBaseDAO<ICompany> {
  private tableName = "companies";
  private queryConfig = COMPANY_QUERY_CONFIG;

  async create(item: ICompany): Promise<ICompany> {
    const knex = db("core");
    const [company] = await knex(this.tableName)
      .insert({
        name: item.name,
        // slug is NOT NULL: derive from the name for any caller that did not
        // supply one (the create DTO normally does). A collision surfaces as
        // the unique violation the error middleware already turns into a 409.
        slug: item.slug ?? toDnsSlug(item.name),
        description: item.description,
        isActive: item.isActive ?? true,
      })
      .returning("*");

    return this.mapToInterface(company);
  }

  async getById(id: number): Promise<ICompany | null> {
    const knex = db("core");
    const company = await knex(this.tableName).where("id", id).first();

    return company ? this.mapToInterface(company) : null;
  }

  async getByUuid(uuid: string): Promise<ICompany | null> {
    const knex = db("core");
    const company = await knex(this.tableName).where("uuid", uuid).first();

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Lookup by the whitelabel client slug. Public, unauthenticated callers reach
   * this through `GET /api/public/whitelabel/:module/:client`, so it must stay a
   * plain equality lookup on the unique column — no pattern matching.
   */
  async getBySlug(slug: string): Promise<ICompany | null> {
    const knex = db("core");
    const company = await knex(this.tableName).where("slug", slug).first();

    return company ? this.mapToInterface(company) : null;
  }

  // Used to convert JWT token's company UUID to database ID.
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = db("core");
    const company = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return company ? company.id : null;
  }

  async update(id: number, item: Partial<ICompany>): Promise<ICompany | null> {
    const knex = db("core");
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    // Renaming a company does NOT re-derive the slug: the slug is a live
    // hostname, so it only ever changes when it is sent explicitly.
    if (item.slug !== undefined) updateData.slug = item.slug;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.isActive !== undefined) updateData.isActive = item.isActive;

    updateData.updatedAt = knex.fn.now();

    const [company] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Replace this company's whitelabel branding WHOLESALE — the editor always
   * sends the complete set of four fields, and a partial write would leave the
   * public login screen carrying a mix of old and new identity.
   *
   * No merge, on purpose: clearing a field is expressed as `null`, which a
   * merge would silently ignore.
   */
  async updateBranding(
    id: number,
    branding: ICompanyBranding,
  ): Promise<ICompany | null> {
    const knex = db("core");
    const [company] = await knex(this.tableName)
      .where("id", id)
      // Explicit stringify for the jsonb column (same as CompanyModuleDAO.updateConfig) —
      // never rely on the driver guessing the parameter type.
      .update({ branding: JSON.stringify(branding), updatedAt: knex.fn.now() })
      .returning("*");

    return company ? this.mapToInterface(company) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("core");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying */
  async getAll(page: number, limit: number): Promise<IDataPaginator<ICompany>> {
    const knex = db("core");
    const offset = (page - 1) * limit;

    const [companies, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("createdAt", "desc")
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICompany>> {
    const knex = db("core");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [companies, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: companies.map((company) => this.mapToInterface(company)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: companies.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getCompanyWithUserCount(uuid: string): Promise<ICompany | null> {
    const knex = db("core");

    const company = await knex(this.tableName)
      .select("companies.*", knex.raw("COUNT(users.id)::int as user_count"))
      .leftJoin("users", "companies.id", "users.companyId")
      .where("companies.uuid", uuid)
      .groupBy("companies.id")
      .first();

    if (!company) return null;

    const mapped = this.mapToInterface(company);
    mapped.userCount = company.user_count;

    return mapped;
  }

  private mapToInterface(record: any): ICompany {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      slug: record.slug,
      description: record.description,
      isActive: record.isActive,
      // The column is NOT NULL DEFAULT '{}', but a row read through a join or
      // an older snapshot may still hand us undefined — normalize once here so
      // no consumer has to distinguish "no branding" from "no column".
      branding: record.branding ?? {},
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
