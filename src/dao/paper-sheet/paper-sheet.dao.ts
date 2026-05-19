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

// companyId is handled separately via a join because the client sends a UUID, not a numeric id.
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

const PAPER_SHEET_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  length: { column: "length" },
  width: { column: "width" },
  minimumStock: { column: "minimumStock" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

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

  async getById(id: number): Promise<IPaperSheet | null> {
    const knex = KnexManager.getConnection();
    const paperSheet = await knex(this.tableName).where("id", id).first();

    return paperSheet ? this.mapToInterface(paperSheet) : null;
  }

  async getByUuid(uuid: string): Promise<IPaperSheet | null> {
    const knex = KnexManager.getConnection();
    const paperSheet = await knex(this.tableName).where("uuid", uuid).first();

    return paperSheet ? this.mapToInterface(paperSheet) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

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

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying */
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPaperSheet>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

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

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

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

  // SECURITY: never expose numeric ids; foreign keys are returned as nested objects keyed by UUID.
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
