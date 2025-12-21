import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IWarehouseLocation } from "../../interfaces/warehouseLocation/warehouseLocation.interfaces";
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

/**
 * Generate Excel-style column letter(s) from 0-indexed column number
 * Examples: 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, etc.
 */
function columnNumberToLetter(col: number): string {
  let result = "";
  let num = col;

  while (num >= 0) {
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  }

  return result;
}

/**
 * Generate location code like "A-05", "B-12", "AA-03"
 */
export function generateLocationCode(row: number, col: number): string {
  const colLetter = columnNumberToLetter(col);
  const rowNumber = String(row + 1).padStart(2, "0"); // 1-indexed, zero-padded
  return `${colLetter}-${rowNumber}`;
}

/**
 * Warehouse location filter configuration
 */
const WAREHOUSE_LOCATION_FILTERS: FilterConfigs = {
  warehouseId: {
    column: "warehouse_id",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  status: {
    column: "status",
    operator: "=",
  },
  locationType: {
    column: "location_type",
    operator: "=",
  },
  locationCode: {
    column: "location_code",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

/**
 * Warehouse location sort configuration
 */
const WAREHOUSE_LOCATION_SORTING: SortConfigs = {
  row: { column: "row" },
  col: { column: "col" },
  locationCode: { column: "location_code" },
  createdAt: { column: "created_at" },
  updatedAt: { column: "updated_at" },
};

/**
 * Warehouse location query builder configuration
 */
const WAREHOUSE_LOCATION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "warehouse_locations",
  {
    filters: WAREHOUSE_LOCATION_FILTERS,
    sorting: WAREHOUSE_LOCATION_SORTING,
    search: {
      columns: ["location_code"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "row",
      order: "asc",
    },
  },
);

export class WarehouseLocationDAO implements IBaseDAO<IWarehouseLocation> {
  private tableName = "warehouse_locations";
  private queryConfig = WAREHOUSE_LOCATION_QUERY_CONFIG;

  /**
   * Create a new warehouse location
   */
  async create(item: IWarehouseLocation): Promise<IWarehouseLocation> {
    const knex = KnexManager.getConnection();
    const [location] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        warehouse_id: item.warehouseId,
        row: item.row,
        col: item.col,
        status: item.status,
        location_type: item.locationType,
        location_code: item.locationCode,
        capacity: item.capacity ? JSON.stringify(item.capacity) : null,
        metadata: item.metadata ? JSON.stringify(item.metadata) : null,
      })
      .returning("*");

    return this.mapToInterface(location);
  }

  /**
   * Batch create warehouse locations (for warehouse creation/resize)
   */
  async batchCreate(
    items: IWarehouseLocation[],
  ): Promise<IWarehouseLocation[]> {
    const knex = KnexManager.getConnection();
    const records = items.map((item) => ({
      uuid: item.uuid,
      warehouse_id: item.warehouseId,
      row: item.row,
      col: item.col,
      status: item.status,
      location_type: item.locationType,
      location_code: item.locationCode,
      capacity: item.capacity ? JSON.stringify(item.capacity) : null,
      metadata: item.metadata ? JSON.stringify(item.metadata) : null,
    }));

    const locations = await knex(this.tableName).insert(records).returning("*");

    return locations.map((loc) => this.mapToInterface(loc));
  }

  /**
   * Batch update warehouse locations
   */
  async batchUpdate(
    warehouseId: number,
    updates: Array<{ row: number; col: number; [key: string]: any }>,
  ): Promise<IWarehouseLocation[]> {
    const knex = KnexManager.getConnection();
    const results: IWarehouseLocation[] = [];

    // Use a transaction for atomic batch updates
    await knex.transaction(async (trx) => {
      for (const update of updates) {
        const { row, col, ...updateData } = update;
        const dbUpdateData: any = {};

        if (updateData.status !== undefined)
          dbUpdateData.status = updateData.status;
        if (updateData.locationType !== undefined)
          dbUpdateData.location_type = updateData.locationType;
        if (updateData.locationCode !== undefined)
          dbUpdateData.location_code = updateData.locationCode;
        if (updateData.capacity !== undefined) {
          dbUpdateData.capacity = updateData.capacity
            ? JSON.stringify(updateData.capacity)
            : null;
        }
        if (updateData.metadata !== undefined) {
          dbUpdateData.metadata = updateData.metadata
            ? JSON.stringify(updateData.metadata)
            : null;
        }

        dbUpdateData.updated_at = trx.fn.now();

        const [location] = await trx(this.tableName)
          .where({ warehouse_id: warehouseId, row, col })
          .update(dbUpdateData)
          .returning("*");

        if (location) {
          results.push(this.mapToInterface(location));
        }
      }
    });

    return results;
  }

  /**
   * Get location by ID
   */
  async getById(id: number): Promise<IWarehouseLocation | null> {
    const knex = KnexManager.getConnection();
    const location = await knex(this.tableName).where("id", id).first();

    return location ? this.mapToInterface(location) : null;
  }

  /**
   * Get location by UUID
   */
  async getByUuid(uuid: string): Promise<IWarehouseLocation | null> {
    const knex = KnexManager.getConnection();
    const location = await knex(this.tableName).where("uuid", uuid).first();

    return location ? this.mapToInterface(location) : null;
  }

  /**
   * Get location numeric ID by UUID string
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const location = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return location ? location.id : null;
  }

  /**
   * Get all locations for a specific warehouse
   */
  async getAllByWarehouseId(
    warehouseId: number,
  ): Promise<IWarehouseLocation[]> {
    const knex = KnexManager.getConnection();
    const locations = await knex(this.tableName)
      .where("warehouse_id", warehouseId)
      .orderBy("row", "asc")
      .orderBy("col", "asc");

    return locations.map((loc) => this.mapToInterface(loc));
  }

  /**
   * Update location by ID
   */
  async update(
    id: number,
    item: Partial<IWarehouseLocation>,
  ): Promise<IWarehouseLocation | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.status !== undefined) updateData.status = item.status;
    if (item.locationType !== undefined)
      updateData.location_type = item.locationType;
    if (item.locationCode !== undefined)
      updateData.location_code = item.locationCode;
    if (item.capacity !== undefined) {
      updateData.capacity = item.capacity
        ? JSON.stringify(item.capacity)
        : null;
    }
    if (item.metadata !== undefined) {
      updateData.metadata = item.metadata
        ? JSON.stringify(item.metadata)
        : null;
    }

    updateData.updated_at = knex.fn.now();

    const [location] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return location ? this.mapToInterface(location) : null;
  }

  /**
   * Delete location by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Delete all locations for a specific warehouse (used on resize)
   */
  async deleteByWarehouseId(warehouseId: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName)
      .where("warehouse_id", warehouseId)
      .delete();

    return deleted > 0;
  }

  /**
   * Get all locations with pagination (legacy - maintains backward compatibility)
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IWarehouseLocation>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [locations, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("row", "asc")
        .orderBy("col", "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: locations.map((location) => this.mapToInterface(location)),
      page,
      limit,
      count: locations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all locations with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   */
  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IWarehouseLocation>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [locations, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: locations.map((location) => this.mapToInterface(location)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: locations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IWarehouseLocation {
    return {
      id: record.id,
      uuid: record.uuid,
      warehouseId: record.warehouse_id,
      row: record.row,
      col: record.col,
      status: record.status,
      locationType: record.location_type,
      locationCode: record.location_code,
      capacity: record.capacity,
      metadata: record.metadata,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }
}
