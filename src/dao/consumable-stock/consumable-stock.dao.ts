import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IConsumableStock } from "../../interfaces/consumable-stock/consumable-stock.interfaces";
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
import { applyCompanyUuidScopeViaWarehouse } from "../../utils/daoScope";
import { Request } from "express";

const CONSUMABLE_STOCK_FILTERS: FilterConfigs = {
  warehouseId: {
    column: `"consumable_stock"."warehouseId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  supplierId: {
    column: `"consumable_stock"."supplierId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  manufacturerId: {
    column: `"consumable_stock"."manufacturerId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  consumableSupplyId: {
    column: `"consumable_stock"."consumableSupplyId"`,
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  minPrice: {
    column: `"consumable_stock"."price"`,
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxPrice: {
    column: `"consumable_stock"."price"`,
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
  minQuantity: {
    column: `"consumable_stock"."quantity"`,
    operator: ">=",
    transform: (value: string) => parseInt(value, 10),
  },
  maxQuantity: {
    column: `"consumable_stock"."quantity"`,
    operator: "<=",
    transform: (value: string) => parseInt(value, 10),
  },
};

const CONSUMABLE_STOCK_SORTING: SortConfigs = {
  price: { column: "price" },
  quantity: { column: "quantity" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const CONSUMABLE_STOCK_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "consumable_stock",
  {
    filters: CONSUMABLE_STOCK_FILTERS,
    sorting: CONSUMABLE_STOCK_SORTING,
    search: {
      columns: ["comments"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  },
);

export class ConsumableStockDAO implements IBaseDAO<IConsumableStock> {
  private tableName = "consumable_stock";
  private queryConfig = CONSUMABLE_STOCK_QUERY_CONFIG;

  async create(item: IConsumableStock): Promise<IConsumableStock> {
    const knex = db("erp");
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        warehouseId: item.warehouseId,
        warehouseLocationId: item.warehouseLocationId,
        supplierId: item.supplierId,
        manufacturerId: item.manufacturerId,
        consumableSupplyId: item.consumableSupplyId,
        comments: item.comments,
        price: item.price,
        quantity: item.quantity,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IConsumableStock | null> {
    const knex = db("erp");
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IConsumableStock | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    // SECURITY (C2): no direct companyId column — scope via warehouses.company_id.
    applyCompanyUuidScopeViaWarehouse(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.*`).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScopeViaWarehouse(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.id`).first();
    return record ? record.id : null;
  }

  async update(
    id: number,
    item: Partial<IConsumableStock>,
  ): Promise<IConsumableStock | null> {
    const knex = db("erp");
    const updateData: any = {};

    if (item.warehouseId !== undefined)
      updateData.warehouseId = item.warehouseId;
    if (item.warehouseLocationId !== undefined)
      updateData.warehouseLocationId = item.warehouseLocationId;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.manufacturerId !== undefined)
      updateData.manufacturerId = item.manufacturerId;
    if (item.consumableSupplyId !== undefined)
      updateData.consumableSupplyId = item.consumableSupplyId;
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
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IConsumableStock>> {
    const knex = db("erp");
    const offset = (page - 1) * limit;

    const query = this.buildJoinQuery(knex);
    const countQuery = knex(this.tableName);

    const [records, totalResult] = await Promise.all([
      query
        .orderBy(`${this.tableName}.createdAt`, "desc")
        .limit(limit)
        .offset(offset),
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

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IConsumableStock>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // companyId arrives as a UUID; resolve via warehouses → companies join (consumable_stock has
    // no direct companyId column).
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = this.buildJoinQuery(knex);
    // Count query must join warehouses too so the company-uuid filter resolves.
    const countQuery = knex(this.tableName).leftJoin(
      "warehouses",
      `${this.tableName}.warehouseId`,
      "warehouses.id",
    );

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

  async getWithDetails(uuid: string): Promise<IConsumableStock | null> {
    const knex = db("erp");
    const query = this.buildJoinQuery(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    const record = await query.first();

    if (!record) return null;
    return this.mapWithRelations(record);
  }

  async getAllByWarehouseId(warehouseId: number): Promise<IConsumableStock[]> {
    const knex = db("erp");
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
        knex.raw('to_jsonb(consumable_supplies.*) as "consumableSupply"'),
      )
      .leftJoin("warehouses", `${this.tableName}.warehouseId`, "warehouses.id")
      .leftJoin(
        "warehouse_locations",
        `${this.tableName}.warehouseLocationId`,
        "warehouse_locations.id",
      )
      .leftJoin("suppliers", `${this.tableName}.supplierId`, "suppliers.id")
      .leftJoin(
        "manufacturers",
        `${this.tableName}.manufacturerId`,
        "manufacturers.id",
      )
      .leftJoin(
        "consumable_supplies",
        `${this.tableName}.consumableSupplyId`,
        "consumable_supplies.id",
      );
  }

  private mapToInterface(record: any): IConsumableStock {
    return {
      uuid: record.uuid,
      warehouseId: record.warehouseId,
      warehouseLocationId: record.warehouseLocationId,
      supplierId: record.supplierId,
      manufacturerId: record.manufacturerId,
      consumableSupplyId: record.consumableSupplyId,
      comments: record.comments,
      price: record.price ? parseFloat(record.price) : undefined,
      quantity: record.quantity,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapWithRelations(record: any): IConsumableStock {
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
    if (record.consumableSupply) {
      const { id, ...consumableSupplyWithoutId } = record.consumableSupply;
      mapped.consumableSupply = consumableSupplyWithoutId;
    }

    return mapped;
  }
}
