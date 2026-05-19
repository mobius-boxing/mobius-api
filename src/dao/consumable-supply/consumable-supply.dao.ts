import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IConsumableSupply } from "../../interfaces/consumable-supply/consumable-supply.interfaces";
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

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
const CONSUMABLE_SUPPLY_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  name: {
    column: "name",
    operator: "ILIKE",
  },
  supplierId: {
    column: "supplierId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  manufacturerId: {
    column: "manufacturerId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  consumableTypeId: {
    column: "consumableTypeId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const CONSUMABLE_SUPPLY_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const CONSUMABLE_SUPPLY_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "consumable_supplies",
  {
    filters: CONSUMABLE_SUPPLY_FILTERS,
    sorting: CONSUMABLE_SUPPLY_SORTING,
    search: {
      columns: ["code", "name", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  }
);

export class ConsumableSupplyDAO implements IBaseDAO<IConsumableSupply> {
  private tableName = "consumable_supplies";
  private queryConfig = CONSUMABLE_SUPPLY_QUERY_CONFIG;

  async create(item: IConsumableSupply): Promise<IConsumableSupply> {
    const knex = KnexManager.getConnection();
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
        description: item.description,
        supplierId: item.supplierId,
        manufacturerId: item.manufacturerId,
        consumableTypeId: item.consumableTypeId,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IConsumableSupply | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<IConsumableSupply | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("uuid", uuid).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

  async update(id: number, item: Partial<IConsumableSupply>): Promise<IConsumableSupply | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined) updateData.description = item.description;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.manufacturerId !== undefined) updateData.manufacturerId = item.manufacturerId;
    if (item.consumableTypeId !== undefined) updateData.consumableTypeId = item.consumableTypeId;

    updateData.updatedAt = knex.fn.now();

    const [record] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return record ? this.mapToInterface(record) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAll(page: number, limit: number): Promise<IDataPaginator<IConsumableSupply>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = this.buildJoinQuery(knex);
    const countQuery = knex(this.tableName);

    const [records, totalResult] = await Promise.all([
      query.orderBy(`${this.tableName}.createdAt`, "desc").limit(limit).offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((record: any) => this.mapWithRelations(record)),
      page,
      limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IConsumableSupply>> {
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

    const [records, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((record: any) => this.mapWithRelations(record)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getWithDetails(uuid: string): Promise<IConsumableSupply | null> {
    const knex = KnexManager.getConnection();
    const query = this.buildJoinQuery(knex).where(`${this.tableName}.uuid`, uuid);
    const record = await query.first();

    if (!record) return null;
    return this.mapWithRelations(record);
  }

  private buildJoinQuery(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw('to_jsonb(consumable_types.*) as "consumableType"')
      )
      .leftJoin("suppliers", `${this.tableName}.supplierId`, "suppliers.id")
      .leftJoin("manufacturers", `${this.tableName}.manufacturerId`, "manufacturers.id")
      .leftJoin("consumable_types", `${this.tableName}.consumableTypeId`, "consumable_types.id");
  }

  private mapToInterface(record: any): IConsumableSupply {
    return {
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      description: record.description,
      supplierId: record.supplierId,
      manufacturerId: record.manufacturerId,
      consumableTypeId: record.consumableTypeId,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapWithRelations(record: any): IConsumableSupply {
    const mapped = this.mapToInterface(record);

    if (record.supplier) {
      const { id, ...supplierWithoutId } = record.supplier;
      mapped.supplier = supplierWithoutId;
    }
    if (record.manufacturer) {
      const { id, ...manufacturerWithoutId } = record.manufacturer;
      mapped.manufacturer = manufacturerWithoutId;
    }
    if (record.consumableType) {
      const { id, ...consumableTypeWithoutId } = record.consumableType;
      mapped.consumableType = consumableTypeWithoutId;
    }

    return mapped;
  }
}
