import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IColor } from "../../interfaces/color/color.interfaces";
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
const COLOR_FILTERS: FilterConfigs = {
  code: { column: "code", operator: "ILIKE" },
  name: { column: "name", operator: "ILIKE" },
  uuid: { column: "uuid", operator: "=" },
  colorTypeId: {
    column: "colorTypeId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
};

const COLOR_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  tonality: { column: "tonality" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const COLOR_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("colors", {
  filters: COLOR_FILTERS,
  sorting: COLOR_SORTING,
  search: { columns: ["code", "name", "description"], operator: "ILIKE" },
  defaultSort: { column: "code", order: "asc" },
});

export class ColorDAO implements IBaseDAO<IColor> {
  private tableName = "colors";
  private queryConfig = COLOR_QUERY_CONFIG;

  async create(item: IColor): Promise<IColor> {
    const knex = db("erp");
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        name: item.name,
        description: item.description,
        observations: item.observations,
        tonality: item.tonality,
        colorTypeId: item.colorTypeId,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getById(id: number): Promise<IColor | null> {
    const knex = db("erp");
    const row = await knex(this.tableName).where("id", id).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IColor | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.*`).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row ? row.id : null;
  }

  async update(id: number, item: Partial<IColor>): Promise<IColor | null> {
    const knex = db("erp");
    const updateData: any = {};
    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.observations !== undefined)
      updateData.observations = item.observations;
    if (item.tonality !== undefined) updateData.tonality = item.tonality;
    if (item.colorTypeId !== undefined)
      updateData.colorTypeId = item.colorTypeId;
    updateData.updatedAt = knex.fn.now();

    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying. */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IColor>> {
    const knex = db("erp");
    const offset = (page - 1) * limit;
    const [rows, totalResult] = await Promise.all([
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
      data: rows.map((row) => this.mapToInterface(row)),
      page,
      limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IColor>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // colorType comes from the client as a UUID as well.
    const colorTypeUuid = parsedQuery.filters.colorTypeUuid as
      | string
      | undefined;
    delete parsedQuery.filters.colorTypeUuid;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    if (colorTypeUuid) {
      dataQuery
        .join("color_types", `${this.tableName}.colorTypeId`, "color_types.id")
        .where("color_types.uuid", colorTypeUuid);
    }
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    if (colorTypeUuid) {
      countQuery
        .join("color_types", `${this.tableName}.colorTypeId`, "color_types.id")
        .where("color_types.uuid", colorTypeUuid);
    }
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IColor {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      name: record.name,
      description: record.description,
      observations: record.observations,
      tonality: record.tonality,
      colorTypeId: record.colorTypeId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
