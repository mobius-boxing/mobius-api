import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IToolingStock } from "../../interfaces/tooling-stock/tooling-stock.interfaces";
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

// companyId is handled separately via a join (against warehouses.company_id) because the client sends a UUID, not a numeric id.
const TOOLING_STOCK_FILTERS: FilterConfigs = {
  warehouseId: {
    column: `"tooling_stock"."warehouseId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  supplierId: {
    column: `"tooling_stock"."supplierId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  manufacturerId: {
    column: `"tooling_stock"."manufacturerId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  toolingId: {
    column: `"tooling_stock"."toolingId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  minPrice: {
    column: `"tooling_stock"."price"`,
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxPrice: {
    column: `"tooling_stock"."price"`,
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
  minQuantity: {
    column: `"tooling_stock"."quantity"`,
    operator: ">=",
    transform: (value: string) => parseInt(value, 10),
  },
  maxQuantity: {
    column: `"tooling_stock"."quantity"`,
    operator: "<=",
    transform: (value: string) => parseInt(value, 10),
  },
};

const TOOLING_STOCK_SORTING: SortConfigs = {
  price: { column: "price" },
  quantity: { column: "quantity" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const TOOLING_STOCK_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "tooling_stock",
  {
    filters: TOOLING_STOCK_FILTERS,
    sorting: TOOLING_STOCK_SORTING,
    search: {
      columns: ["comments"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  }
);

export class ToolingStockDAO implements IBaseDAO<IToolingStock> {
  private tableName = "tooling_stock";
  private queryConfig = TOOLING_STOCK_QUERY_CONFIG;

  async create(item: IToolingStock): Promise<IToolingStock> {
    const knex = KnexManager.getConnection();
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        warehouseId: item.warehouseId,
        warehouseLocationId: item.warehouseLocationId,
        supplierId: item.supplierId,
        manufacturerId: item.manufacturerId,
        toolingId: item.toolingId,
        comments: item.comments,
        price: item.price,
        quantity: item.quantity,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IToolingStock | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<IToolingStock | null> {
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

  async update(id: number, item: Partial<IToolingStock>): Promise<IToolingStock | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.warehouseId !== undefined) updateData.warehouseId = item.warehouseId;
    if (item.warehouseLocationId !== undefined) updateData.warehouseLocationId = item.warehouseLocationId;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.manufacturerId !== undefined) updateData.manufacturerId = item.manufacturerId;
    if (item.toolingId !== undefined) updateData.toolingId = item.toolingId;
    if (item.comments !== undefined) updateData.comments = item.comments;
    if (item.price !== undefined) updateData.price = item.price;
    if (item.quantity !== undefined) updateData.quantity = item.quantity;

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

  async getAll(page: number, limit: number): Promise<IDataPaginator<IToolingStock>> {
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IToolingStock>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via warehouses → companies join.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = this.buildJoinQuery(knex);
    // Count query needs the warehouses join too so companyId filtering matches.
    const countQuery = knex(this.tableName)
      .leftJoin("warehouses", `${this.tableName}.warehouseId`, "warehouses.id");

    if (companyUuid) {
      dataQuery
        .join("companies", "warehouses.company_id", "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", "warehouses.company_id", "companies.id")
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

  async getWithDetails(uuid: string): Promise<IToolingStock | null> {
    const knex = KnexManager.getConnection();
    const query = this.buildJoinQuery(knex).where(`${this.tableName}.uuid`, uuid);
    const record = await query.first();

    if (!record) return null;
    return this.mapWithRelations(record);
  }

  async getAllByWarehouseId(warehouseId: number): Promise<IToolingStock[]> {
    const knex = KnexManager.getConnection();
    const records = await this.buildJoinQuery(knex)
      .where(`${this.tableName}.warehouseId`, warehouseId)
      .orderBy(`${this.tableName}.createdAt`, "desc");

    return records.map((record: any) => this.mapWithRelations(record));
  }

  private buildJoinQuery(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw("to_jsonb(warehouses.*) as warehouse"),
        knex.raw('to_jsonb(warehouse_locations.*) as "warehouseLocation"'),
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(toolings.*) as tooling")
      )
      .leftJoin("warehouses", `${this.tableName}.warehouseId`, "warehouses.id")
      .leftJoin("warehouse_locations", `${this.tableName}.warehouseLocationId`, "warehouse_locations.id")
      .leftJoin("suppliers", `${this.tableName}.supplierId`, "suppliers.id")
      .leftJoin("manufacturers", `${this.tableName}.manufacturerId`, "manufacturers.id")
      .leftJoin("toolings", `${this.tableName}.toolingId`, "toolings.id");
  }

  private mapToInterface(record: any): IToolingStock {
    return {
      uuid: record.uuid,
      warehouseId: record.warehouseId,
      warehouseLocationId: record.warehouseLocationId,
      supplierId: record.supplierId,
      manufacturerId: record.manufacturerId,
      toolingId: record.toolingId,
      comments: record.comments,
      price: record.price ? parseFloat(record.price) : undefined,
      quantity: record.quantity,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapWithRelations(record: any): IToolingStock {
    const mapped = this.mapToInterface(record);

    if (record.warehouse) {
      const { id, ...warehouseWithoutId } = record.warehouse;
      mapped.warehouse = warehouseWithoutId;
    }
    if (record.warehouseLocation) {
      const loc = record.warehouseLocation;
      mapped.warehouseLocation = {
        uuid: loc.uuid,
        warehouseId: loc.warehouseId,
        row: loc.row,
        col: loc.col,
        status: loc.status,
        locationType: loc.location_type,
        locationCode: loc.location_code,
        capacity: loc.capacity,
        metadata: loc.metadata,
        createdAt: loc.createdAt,
        updatedAt: loc.updatedAt,
      };
    }
    if (record.supplier) {
      const { id, ...supplierWithoutId } = record.supplier;
      mapped.supplier = supplierWithoutId;
    }
    if (record.manufacturer) {
      const { id, ...manufacturerWithoutId } = record.manufacturer;
      mapped.manufacturer = manufacturerWithoutId;
    }
    if (record.tooling) {
      const { id, ...toolingWithoutId } = record.tooling;
      mapped.tooling = toolingWithoutId;
    }

    return mapped;
  }
}
