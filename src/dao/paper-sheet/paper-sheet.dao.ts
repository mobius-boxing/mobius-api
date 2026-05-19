import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperSheet } from "../../interfaces/paper-sheet/paper-sheet.interfaces";
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
 * Paper Sheet filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const PAPER_SHEET_FILTERS: FilterConfigs = {
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
  corrugationId: {
    column: "corrugationId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  minLength: {
    column: "length",
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxLength: {
    column: "length",
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
  minWidth: {
    column: "width",
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxWidth: {
    column: "width",
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
};

/**
 * Paper Sheet sort configuration
 */
const PAPER_SHEET_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  length: { column: "length" },
  width: { column: "width" },
  minimumStock: { column: "minimumStock" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Query builder configuration for paper sheets
 */
const PAPER_SHEET_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "paper_sheets",
  {
    filters: PAPER_SHEET_FILTERS,
    sorting: PAPER_SHEET_SORTING,
    search: {
      columns: ["code", "name", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  },
);

export class PaperSheetDAO implements IBaseDAO<IPaperSheet> {
  private tableName = "paper_sheets";
  private queryConfig = PAPER_SHEET_QUERY_CONFIG;

  /**
   * Create a new paper sheet
   */
  async create(item: IPaperSheet): Promise<IPaperSheet> {
    const knex = KnexManager.getConnection();
    const [paperSheet] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
        description: item.description,
        supplierId: item.supplierId,
        manufacturerId: item.manufacturerId,
        corrugationId: item.corrugationId,
        minimumStock: item.minimumStock ?? 0,
        length: item.length,
        width: item.width,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(paperSheet);
  }

  /**
   * Get paper sheet by ID
   */
  async getById(id: number): Promise<IPaperSheet | null> {
    const knex = KnexManager.getConnection();
    const paperSheet = await knex(this.tableName).where("id", id).first();

    return paperSheet ? this.mapToInterface(paperSheet) : null;
  }

  /**
   * Get paper sheet by UUID
   */
  async getByUuid(uuid: string): Promise<IPaperSheet | null> {
    const knex = KnexManager.getConnection();
    const paperSheet = await knex(this.tableName).where("uuid", uuid).first();

    return paperSheet ? this.mapToInterface(paperSheet) : null;
  }

  /**
   * Get paper sheet internal ID by UUID
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

  /**
   * Update paper sheet by ID
   */
  async update(
    id: number,
    item: Partial<IPaperSheet>,
  ): Promise<IPaperSheet | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.manufacturerId !== undefined)
      updateData.manufacturerId = item.manufacturerId;
    if (item.corrugationId !== undefined)
      updateData.corrugationId = item.corrugationId;
    if (item.minimumStock !== undefined)
      updateData.minimumStock = item.minimumStock;
    if (item.length !== undefined) updateData.length = item.length;
    if (item.width !== undefined) updateData.width = item.width;

    updateData.updatedAt = knex.fn.now();

    const [paperSheet] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperSheet ? this.mapToInterface(paperSheet) : null;
  }

  /**
   * Delete paper sheet by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all paper sheets with pagination (legacy - for backward compatibility)
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IPaperSheet>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = knex(this.tableName)
      .select(
        "paper_sheets.*",
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(corrugations.*) as corrugation"),
      )
      .leftJoin("suppliers", "paper_sheets.supplierId", "suppliers.id")
      .leftJoin(
        "manufacturers",
        "paper_sheets.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin(
        "corrugations",
        "paper_sheets.corrugationId",
        "corrugations.id",
      );

    const countQuery = knex(this.tableName);

    const [paperSheets, totalResult] = await Promise.all([
      query
        .orderBy("paper_sheets.createdAt", "desc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperSheets.map((ps) => this.mapWithRelations(ps)),
      page,
      limit,
      count: paperSheets.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all paper sheets with advanced filtering, sorting, and search
   * This is the STANDARD method that should be used by controllers
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPaperSheet>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Extract companyId (UUID) from filters - handle it separately via join
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // Build data query with joins
    const dataQuery = knex(this.tableName)
      .select(
        "paper_sheets.*",
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(corrugations.*) as corrugation"),
      )
      .leftJoin("suppliers", "paper_sheets.supplierId", "suppliers.id")
      .leftJoin(
        "manufacturers",
        "paper_sheets.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin(
        "corrugations",
        "paper_sheets.corrugationId",
        "corrugations.id",
      );

    // Join with companies if filtering by company UUID
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    // Build count query
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    // Apply query builder filters, sorting, pagination
    buildQuery(dataQuery, parsedQuery, this.queryConfig);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both in parallel
    const [paperSheets, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperSheets.map((ps) => this.mapWithRelations(ps)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: paperSheets.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface (strips numeric IDs)
   */
  private mapToInterface(record: any): IPaperSheet {
    return {
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      description: record.description,
      minimumStock: record.minimumStock,
      length: record.length ? parseFloat(record.length) : undefined,
      width: record.width ? parseFloat(record.width) : undefined,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Map database record with related entities (strips numeric IDs)
   */
  private mapWithRelations(record: any): IPaperSheet {
    const mapped = this.mapToInterface(record);

    if (record.supplier) {
      const { id, ...supplierWithoutId } = record.supplier;
      mapped.supplier = supplierWithoutId;
    }
    if (record.manufacturer) {
      const { id, ...manufacturerWithoutId } = record.manufacturer;
      mapped.manufacturer = manufacturerWithoutId;
    }
    if (record.corrugation) {
      const { id, ...corrugationWithoutId } = record.corrugation;
      mapped.corrugation = corrugationWithoutId;
    }

    return mapped;
  }
}
