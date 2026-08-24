import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IComplement } from "../../interfaces/complement/complement.interfaces";
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
import { applyCompanyUuidScope } from "../../utils/daoScope";
import { Request } from "express";

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
const COMPLEMENT_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  description: {
    column: "description",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const COMPLEMENT_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const COMPLEMENT_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "complements",
  {
    filters: COMPLEMENT_FILTERS,
    sorting: COMPLEMENT_SORTING,
    search: {
      columns: ["code", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "code",
      order: "asc",
    },
  },
);

export class ComplementDAO implements IBaseDAO<IComplement> {
  private tableName = "complements";
  private queryConfig = COMPLEMENT_QUERY_CONFIG;

  async create(item: IComplement): Promise<IComplement> {
    const knex = db("erp");
    const [complement] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(complement);
  }

  async getById(id: number): Promise<IComplement | null> {
    const knex = db("erp");
    const complement = await knex(this.tableName).where("id", id).first();

    return complement ? this.mapToInterface(complement) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IComplement | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const complement = await query.select(`${this.tableName}.*`).first();

    return complement ? this.mapToInterface(complement) : null;
  }

  async update(
    id: number,
    item: Partial<IComplement>,
  ): Promise<IComplement | null> {
    const knex = db("erp");
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [complement] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return complement ? this.mapToInterface(complement) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * @deprecated Use getAllWithFilters for advanced querying.
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IComplement>> {
    const knex = db("erp");
    const offset = (page - 1) * limit;

    const [complements, totalResult] = await Promise.all([
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
      data: complements.map((complement) => this.mapToInterface(complement)),
      page,
      limit,
      count: complements.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IComplement>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid rather than
    // letting the query builder treat it as a column filter.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [complements, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: complements.map((complement) => this.mapToInterface(complement)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: complements.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IComplement {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
