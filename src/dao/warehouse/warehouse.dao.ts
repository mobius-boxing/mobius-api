import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IWarehouse } from "../../interfaces/warehouse/warehouse.interfaces";
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
import { WarehouseLocationDAO, generateLocationCode } from "../warehouseLocation/warehouseLocation.dao";
import { v4 as uuidv4 } from "uuid";

/**
 * Warehouse filter configuration
 */
const WAREHOUSE_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  companyId: {
    column: "company_id",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

/**
 * Warehouse sort configuration
 */
const WAREHOUSE_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "created_at" },
  updatedAt: { column: "updated_at" },
};

/**
 * Warehouse query builder configuration
 */
const WAREHOUSE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("warehouses", {
  filters: WAREHOUSE_FILTERS,
  sorting: WAREHOUSE_SORTING,
  search: {
    columns: ["name"],
    operator: "ILIKE",
  },
  defaultSort: {
    column: "name",
    order: "asc",
  },
});

export class WarehouseDAO implements IBaseDAO<IWarehouse> {
  private tableName = "warehouses";
  private queryConfig = WAREHOUSE_QUERY_CONFIG;
  private warehouseLocationDAO = new WarehouseLocationDAO();

  /**
   * Create a new warehouse with auto-generated grid locations
   */
  async create(item: IWarehouse): Promise<IWarehouse> {
    const knex = KnexManager.getConnection();

    // Use transaction to ensure warehouse and locations are created atomically
    const warehouse = await knex.transaction(async (trx) => {
      const [newWarehouse] = await trx(this.tableName)
        .insert({
          uuid: item.uuid,
          name: item.name,
          grid_rows: item.gridRows || 10,
          grid_cols: item.gridCols || 10,
          company_id: item.companyId,
        })
        .returning("*");

      // Auto-create locations for the grid
      const gridRows = newWarehouse.grid_rows;
      const gridCols = newWarehouse.grid_cols;
      const locations = [];

      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          locations.push({
            uuid: uuidv4(),
            warehouse_id: newWarehouse.id,
            row,
            col,
            status: "inactive",
            location_type: "storage",
            location_code: generateLocationCode(row, col),
            capacity: null,
            metadata: null,
          });
        }
      }

      // Batch insert all locations
      if (locations.length > 0) {
        await trx("warehouse_locations").insert(locations);
      }

      return newWarehouse;
    });

    return this.mapToInterface(warehouse);
  }

  /**
   * Get warehouse by ID
   */
  async getById(id: number): Promise<IWarehouse | null> {
    const knex = KnexManager.getConnection();
    const warehouse = await knex(this.tableName).where("id", id).first();

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  /**
   * Get warehouse by UUID
   */
  async getByUuid(uuid: string): Promise<IWarehouse | null> {
    const knex = KnexManager.getConnection();
    const warehouse = await knex(this.tableName).where("uuid", uuid).first();

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  /**
   * Get warehouse numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const warehouse = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return warehouse ? warehouse.id : null;
  }

  /**
   * Update warehouse by ID
   * If grid dimensions change, deletes all locations and creates new ones
   */
  async update(
    id: number,
    item: Partial<IWarehouse>,
  ): Promise<IWarehouse | null> {
    const knex = KnexManager.getConnection();

    // Check if grid dimensions are being changed
    const gridChanged = item.gridRows !== undefined || item.gridCols !== undefined;

    if (gridChanged) {
      // Use transaction for atomic update
      const warehouse = await knex.transaction(async (trx) => {
        // Get current warehouse to get old dimensions
        const current = await trx(this.tableName).where("id", id).first();
        if (!current) return null;

        const updateData: any = {};
        if (item.name !== undefined) updateData.name = item.name;
        if (item.gridRows !== undefined) updateData.grid_rows = item.gridRows;
        if (item.gridCols !== undefined) updateData.grid_cols = item.gridCols;
        if (item.companyId !== undefined) updateData.company_id = item.companyId;
        updateData.updated_at = trx.fn.now();

        const [updated] = await trx(this.tableName)
          .where("id", id)
          .update(updateData)
          .returning("*");

        // Delete all existing locations
        await trx("warehouse_locations").where("warehouse_id", id).delete();

        // Create new locations based on new grid dimensions
        const gridRows = updated.grid_rows;
        const gridCols = updated.grid_cols;
        const locations = [];

        for (let row = 0; row < gridRows; row++) {
          for (let col = 0; col < gridCols; col++) {
            locations.push({
              uuid: uuidv4(),
              warehouse_id: updated.id,
              row,
              col,
              status: "inactive",
              location_type: "storage",
              location_code: generateLocationCode(row, col),
              capacity: null,
              metadata: null,
            });
          }
        }

        // Batch insert new locations
        if (locations.length > 0) {
          await trx("warehouse_locations").insert(locations);
        }

        return updated;
      });

      return warehouse ? this.mapToInterface(warehouse) : null;
    } else {
      // Simple update without grid changes
      const updateData: any = {};
      if (item.name !== undefined) updateData.name = item.name;
      if (item.companyId !== undefined) updateData.company_id = item.companyId;
      updateData.updated_at = knex.fn.now();

      const [warehouse] = await knex(this.tableName)
        .where("id", id)
        .update(updateData)
        .returning("*");

      return warehouse ? this.mapToInterface(warehouse) : null;
    }
  }

  /**
   * Delete warehouse by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all warehouses with pagination (legacy - maintains backward compatibility)
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IWarehouse>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [warehouses, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("name", "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: warehouses.map((warehouse) => this.mapToInterface(warehouse)),
      page,
      limit,
      count: warehouses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all warehouses with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   */
  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IWarehouse>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [warehouses, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: warehouses.map((warehouse) => this.mapToInterface(warehouse)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: warehouses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IWarehouse {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      gridRows: record.grid_rows,
      gridCols: record.grid_cols,
      companyId: record.company_id,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }
}
