import { db } from "../../database/registry";
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
import {
  WarehouseLocationDAO,
  generateLocationCode,
} from "../warehouseLocation/warehouseLocation.dao";
import { v4 as uuidv4 } from "uuid";

import { applyCompanyUuidScope } from "../../utils/daoScope";
// companyId is handled separately via a join because the client sends a UUID, not a numeric id.
const WAREHOUSE_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const WAREHOUSE_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "created_at" },
  updatedAt: { column: "updated_at" },
};

const WAREHOUSE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "warehouses",
  {
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
  },
);

export class WarehouseDAO implements IBaseDAO<IWarehouse> {
  private tableName = "warehouses";
  private queryConfig = WAREHOUSE_QUERY_CONFIG;
  private warehouseLocationDAO = new WarehouseLocationDAO();

  // A warehouse is created together with one row in warehouse_locations per grid cell,
  // atomically. Defaults to a 10x10 grid if dimensions are not provided.
  async create(item: IWarehouse): Promise<IWarehouse> {
    const knex = db("erp");

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

      if (locations.length > 0) {
        await trx("warehouse_locations").insert(locations);
      }

      return newWarehouse;
    });

    return this.mapToInterface(warehouse);
  }

  async getById(id: number): Promise<IWarehouse | null> {
    const knex = db("erp");
    const warehouse = await knex(this.tableName).where("id", id).first();

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IWarehouse | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    // warehouses link to companies via the snake_case `company_id` column.
    applyCompanyUuidScope(query, this.tableName, companyUuid, "company_id");
    const warehouse = await query.select(`${this.tableName}.*`).first();

    return warehouse ? this.mapToInterface(warehouse) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid, "company_id");
    const warehouse = await query.select(`${this.tableName}.id`).first();

    return warehouse ? warehouse.id : null;
  }

  // WARNING: changing grid dimensions is destructive — all existing warehouse_locations
  // rows for this warehouse (including any stock placement metadata) are deleted and
  // recreated from scratch. Callers must validate this is safe before invoking.
  async update(
    id: number,
    item: Partial<IWarehouse>,
  ): Promise<IWarehouse | null> {
    const knex = db("erp");

    const gridChanged =
      item.gridRows !== undefined || item.gridCols !== undefined;

    if (gridChanged) {
      const warehouse = await knex.transaction(async (trx) => {
        const current = await trx(this.tableName).where("id", id).first();
        if (!current) return null;

        const updateData: any = {};
        if (item.name !== undefined) updateData.name = item.name;
        if (item.gridRows !== undefined) updateData.grid_rows = item.gridRows;
        if (item.gridCols !== undefined) updateData.grid_cols = item.gridCols;
        if (item.companyId !== undefined)
          updateData.company_id = item.companyId;
        updateData.updated_at = trx.fn.now();

        const [updated] = await trx(this.tableName)
          .where("id", id)
          .update(updateData)
          .returning("*");

        await trx("warehouse_locations").where("warehouse_id", id).delete();

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

        if (locations.length > 0) {
          await trx("warehouse_locations").insert(locations);
        }

        return updated;
      });

      return warehouse ? this.mapToInterface(warehouse) : null;
    } else {
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

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IWarehouse>> {
    const knex = db("erp");
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IWarehouse>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.company_id`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.company_id`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

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
