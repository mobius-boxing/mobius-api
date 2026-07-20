import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ITooling } from "../../interfaces/tooling/tooling.interfaces";
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

// companyId is handled separately via a join because the client sends a UUID, not a numeric id.
const TOOLING_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  toolingTypeId: {
    column: "toolingTypeId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  manufacturerId: {
    column: "manufacturerId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  supplierId: {
    column: "supplierId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  minStock: {
    column: "minimumStock",
    operator: ">=",
    transform: (value: string) => parseInt(value, 10),
  },
  maxStock: {
    column: "minimumStock",
    operator: "<=",
    transform: (value: string) => parseInt(value, 10),
  },
};

const TOOLING_SORTING: SortConfigs = {
  name: { column: "name" },
  minimumStock: { column: "minimumStock" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const TOOLING_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "toolings",
  {
    filters: TOOLING_FILTERS,
    sorting: TOOLING_SORTING,
    search: {
      columns: ["name", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "name",
      order: "asc",
    },
  },
);

export class ToolingDAO implements IBaseDAO<ITooling> {
  private tableName = "toolings";
  private queryConfig = TOOLING_QUERY_CONFIG;

  async create(item: ITooling): Promise<ITooling> {
    const knex = KnexManager.getConnection();
    const [tooling] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
        description: item.description,
        manufacturerId: item.manufacturerId,
        supplierId: item.supplierId,
        minimumStock: item.minimumStock ?? 0,
        toolingTypeId: item.toolingTypeId,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(tooling);
  }

  async getById(id: number): Promise<ITooling | null> {
    const knex = KnexManager.getConnection();
    const tooling = await knex(this.tableName).where("id", id).first();
    return tooling ? this.mapToInterface(tooling) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ITooling | null> {
    const knex = KnexManager.getConnection();
    const query = this.buildJoinQuery(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const tooling = await query.first();
    return tooling ? this.mapWithRelations(tooling) : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.id`).first();
    return record ? record.id : null;
  }

  async update(id: number, item: Partial<ITooling>): Promise<ITooling | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined) updateData.description = item.description;
    if (item.manufacturerId !== undefined) updateData.manufacturerId = item.manufacturerId;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.minimumStock !== undefined) updateData.minimumStock = item.minimumStock;
    if (item.toolingTypeId !== undefined) updateData.toolingTypeId = item.toolingTypeId;

    updateData.updatedAt = knex.fn.now();

    const [tooling] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return tooling ? this.mapToInterface(tooling) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAll(page: number, limit: number): Promise<IDataPaginator<ITooling>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = this.buildJoinQuery(knex);
    const countQuery = knex(this.tableName);

    const [toolings, totalResult] = await Promise.all([
      query.orderBy(`${this.tableName}.name`, "asc").limit(limit).offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: toolings.map((item: any) => this.mapWithRelations(item)),
      page,
      limit,
      count: toolings.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<ITooling>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = this.buildJoinQuery(knex);
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [toolings, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: toolings.map((item: any) => this.mapWithRelations(item)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: toolings.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private buildJoinQuery(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw('to_jsonb(tooling_types.*) as "toolingType"'),
      )
      .leftJoin("manufacturers", `${this.tableName}.manufacturerId`, "manufacturers.id")
      .leftJoin("suppliers", `${this.tableName}.supplierId`, "suppliers.id")
      .leftJoin("tooling_types", `${this.tableName}.toolingTypeId`, "tooling_types.id");
  }

  private mapToInterface(record: any): ITooling {
    return {
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      description: record.description,
      minimumStock: record.minimumStock,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapWithRelations(record: any): ITooling {
    const mapped = this.mapToInterface(record);

    if (record.manufacturer) {
      const { id, ...manufacturerWithoutId } = record.manufacturer;
      mapped.manufacturer = manufacturerWithoutId;
    }
    if (record.supplier) {
      const { id, ...supplierWithoutId } = record.supplier;
      mapped.supplier = supplierWithoutId;
    }
    if (record.toolingType) {
      const { id, ...toolingTypeWithoutId } = record.toolingType;
      mapped.toolingType = toolingTypeWithoutId;
    }

    return mapped;
  }
}
