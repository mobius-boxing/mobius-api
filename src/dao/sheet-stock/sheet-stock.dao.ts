import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ISheetStock } from "../../interfaces/sheet-stock/sheet-stock.interfaces";
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
const SHEET_STOCK_FILTERS: FilterConfigs = {
  warehouseId: {
    column: `"sheet_stock"."warehouseId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  supplierId: {
    column: `"sheet_stock"."supplierId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  manufacturerId: {
    column: `"sheet_stock"."manufacturerId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  paperSheetId: {
    column: `"sheet_stock"."paperSheetId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  minPrice: {
    column: `"sheet_stock"."price"`,
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxPrice: {
    column: `"sheet_stock"."price"`,
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
  minQuantity: {
    column: `"sheet_stock"."quantity"`,
    operator: ">=",
    transform: (value: string) => parseInt(value, 10),
  },
  maxQuantity: {
    column: `"sheet_stock"."quantity"`,
    operator: "<=",
    transform: (value: string) => parseInt(value, 10),
  },
};

const SHEET_STOCK_SORTING: SortConfigs = {
  price: { column: "price" },
  quantity: { column: "quantity" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const SHEET_STOCK_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "sheet_stock",
  {
    filters: SHEET_STOCK_FILTERS,
    sorting: SHEET_STOCK_SORTING,
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

export class SheetStockDAO implements IBaseDAO<ISheetStock> {
  private tableName = "sheet_stock";
  private queryConfig = SHEET_STOCK_QUERY_CONFIG;

  async create(item: ISheetStock): Promise<ISheetStock> {
    const knex = KnexManager.getConnection();
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        warehouseId: item.warehouseId,
        warehouseLocationId: item.warehouseLocationId,
        supplierId: item.supplierId,
        manufacturerId: item.manufacturerId,
        paperSheetId: item.paperSheetId,
        comments: item.comments,
        price: item.price,
        quantity: item.quantity,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<ISheetStock | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<ISheetStock | null> {
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

  async update(id: number, item: Partial<ISheetStock>): Promise<ISheetStock | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.warehouseId !== undefined) updateData.warehouseId = item.warehouseId;
    if (item.warehouseLocationId !== undefined) updateData.warehouseLocationId = item.warehouseLocationId;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.manufacturerId !== undefined) updateData.manufacturerId = item.manufacturerId;
    if (item.paperSheetId !== undefined) updateData.paperSheetId = item.paperSheetId;
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

  async getAll(page: number, limit: number): Promise<IDataPaginator<ISheetStock>> {
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<ISheetStock>> {
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

  async getWithDetails(uuid: string): Promise<ISheetStock | null> {
    const knex = KnexManager.getConnection();
    const query = this.buildJoinQuery(knex).where(`${this.tableName}.uuid`, uuid);
    const record = await query.first();

    if (!record) return null;
    return this.mapWithRelations(record);
  }

  async getAllByWarehouseId(warehouseId: number): Promise<ISheetStock[]> {
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
        knex.raw('to_jsonb(paper_sheets.*) as "paperSheet"')
      )
      .leftJoin("warehouses", `${this.tableName}.warehouseId`, "warehouses.id")
      .leftJoin("warehouse_locations", `${this.tableName}.warehouseLocationId`, "warehouse_locations.id")
      .leftJoin("suppliers", `${this.tableName}.supplierId`, "suppliers.id")
      .leftJoin("manufacturers", `${this.tableName}.manufacturerId`, "manufacturers.id")
      .leftJoin("paper_sheets", `${this.tableName}.paperSheetId`, "paper_sheets.id");
  }

  private mapToInterface(record: any): ISheetStock {
    return {
      uuid: record.uuid,
      warehouseId: record.warehouseId,
      warehouseLocationId: record.warehouseLocationId,
      supplierId: record.supplierId,
      manufacturerId: record.manufacturerId,
      paperSheetId: record.paperSheetId,
      comments: record.comments,
      price: record.price ? parseFloat(record.price) : undefined,
      quantity: record.quantity,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapWithRelations(record: any): ISheetStock {
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
    if (record.paperSheet) {
      const { id, ...paperSheetWithoutId } = record.paperSheet;
      mapped.paperSheet = paperSheetWithoutId;
    }

    return mapped;
  }
}
