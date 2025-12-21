import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperSupply } from "../../interfaces/paper-supply/paper-supply.interfaces";
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
 * Paper Supply filter configuration
 */
const PAPER_SUPPLY_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  name: {
    column: "name",
    operator: "ILIKE",
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
  paperTypeId: {
    column: "paperTypeId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  minGrammage: {
    column: "grammage",
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxGrammage: {
    column: "grammage",
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
  minPrice: {
    column: "price",
    operator: ">=",
    transform: (value: string) => parseFloat(value),
  },
  maxPrice: {
    column: "price",
    operator: "<=",
    transform: (value: string) => parseFloat(value),
  },
};

/**
 * Paper Supply sort configuration
 */
const PAPER_SUPPLY_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  grammage: { column: "grammage" },
  price: { column: "price" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Query builder configuration for paper supplies
 */
const PAPER_SUPPLY_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "paper_supplies",
  {
    filters: PAPER_SUPPLY_FILTERS,
    sorting: PAPER_SUPPLY_SORTING,
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

export class PaperSupplyDAO implements IBaseDAO<IPaperSupply> {
  private tableName = "paper_supplies";
  private queryConfig = PAPER_SUPPLY_QUERY_CONFIG;

  /**
   * Create a new paper supply
   */
  async create(item: IPaperSupply): Promise<IPaperSupply> {
    const knex = KnexManager.getConnection();
    const [paperSupply] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
        name: item.name,
        manufacturerId: item.manufacturerId,
        supplierId: item.supplierId,
        paperTypeId: item.paperTypeId,
        grammage: item.grammage,
        price: item.price,
        minimumStock: JSON.stringify(
          item.minimumStock || { pallets: 0, boxes: 0 },
        ),
      })
      .returning("*");

    return this.mapToInterface(paperSupply);
  }

  /**
   * Get paper supply by ID
   */
  async getById(id: number): Promise<IPaperSupply | null> {
    const knex = KnexManager.getConnection();
    const paperSupply = await knex(this.tableName).where("id", id).first();

    return paperSupply ? this.mapToInterface(paperSupply) : null;
  }

  /**
   * Get paper supply by UUID
   */
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IPaperSupply | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const paperSupply = await query.select(`${this.tableName}.*`).first();

    return paperSupply ? this.mapToInterface(paperSupply) : null;
  }

  /**
   * Get paper supply internal ID by UUID
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
   * Update paper supply by ID
   */
  async update(
    id: number,
    item: Partial<IPaperSupply>,
  ): Promise<IPaperSupply | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.manufacturerId !== undefined)
      updateData.manufacturerId = item.manufacturerId;
    if (item.supplierId !== undefined) updateData.supplierId = item.supplierId;
    if (item.paperTypeId !== undefined)
      updateData.paperTypeId = item.paperTypeId;
    if (item.grammage !== undefined) updateData.grammage = item.grammage;
    if (item.price !== undefined) updateData.price = item.price;
    if (item.minimumStock !== undefined)
      updateData.minimumStock = JSON.stringify(item.minimumStock);

    updateData.updatedAt = knex.fn.now();

    const [paperSupply] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperSupply ? this.mapToInterface(paperSupply) : null;
  }

  /**
   * Delete paper supply by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all paper supplies with pagination (legacy - for backward compatibility)
   * Includes manufacturer, supplier, and paper type details
   */
  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<IPaperSupply>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = knex(this.tableName)
      .select(
        "paper_supplies.*",
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw('to_jsonb(paper_types.*) as "paperType"'),
      )
      .leftJoin(
        "manufacturers",
        "paper_supplies.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin("suppliers", "paper_supplies.supplierId", "suppliers.id")
      .leftJoin("paper_types", "paper_supplies.paperTypeId", "paper_types.id");

    const countQuery = knex(this.tableName);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const [paperSupplies, totalResult] = await Promise.all([
      query
        .orderBy(`${this.tableName}.createdAt`, "desc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperSupplies.map((paperSupply) => {
        const mapped = this.mapToInterface(paperSupply);
        if (paperSupply.manufacturer) {
          const { id, ...manufacturerWithoutId } = paperSupply.manufacturer;
          mapped.manufacturer = manufacturerWithoutId;
        }
        if (paperSupply.supplier) {
          const { id, ...supplierWithoutId } = paperSupply.supplier;
          mapped.supplier = supplierWithoutId;
        }
        if (paperSupply.paperType) {
          const { id, ...paperTypeWithoutId } = paperSupply.paperType;
          mapped.paperType = paperTypeWithoutId;
        }
        return mapped;
      }),
      page,
      limit,
      count: paperSupplies.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all paper supplies with advanced filtering, sorting, and search
   * This is the STANDARD method that should be used by controllers
   */
  async getAllWithFilters(
    req: Request,
    companyUuid?: string,
  ): Promise<IDataPaginator<IPaperSupply>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build data query with joins
    const dataQuery = knex(this.tableName)
      .select(
        "paper_supplies.*",
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw('to_jsonb(paper_types.*) as "paperType"'),
      )
      .leftJoin(
        "manufacturers",
        "paper_supplies.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin("suppliers", "paper_supplies.supplierId", "suppliers.id")
      .leftJoin("paper_types", "paper_supplies.paperTypeId", "paper_types.id");

    // Build count query
    const countQuery = knex(this.tableName);

    // Filter by company UUID if provided
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    // Apply query builder filters, sorting, pagination
    buildQuery(dataQuery, parsedQuery, this.queryConfig);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both in parallel
    const [paperSupplies, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperSupplies.map((paperSupply) => {
        const mapped = this.mapToInterface(paperSupply);
        if (paperSupply.manufacturer) {
          const { id, ...manufacturerWithoutId } = paperSupply.manufacturer;
          mapped.manufacturer = manufacturerWithoutId;
        }
        if (paperSupply.supplier) {
          const { id, ...supplierWithoutId } = paperSupply.supplier;
          mapped.supplier = supplierWithoutId;
        }
        if (paperSupply.paperType) {
          const { id, ...paperTypeWithoutId } = paperSupply.paperType;
          mapped.paperType = paperTypeWithoutId;
        }
        return mapped;
      }),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: paperSupplies.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Get paper supply with related details (manufacturer, supplier, company, paperType) using to_jsonb
   */
  async getWithDetails(
    uuid: string,
    companyUuid?: string,
  ): Promise<IPaperSupply | null> {
    const knex = KnexManager.getConnection();

    const query = knex(this.tableName)
      .select(
        "paper_supplies.*",
        knex.raw("to_jsonb(manufacturers.*) as manufacturer"),
        knex.raw("to_jsonb(suppliers.*) as supplier"),
        knex.raw("to_jsonb(companies.*) as company"),
        knex.raw('to_jsonb(paper_types.*) as "paperType"'),
      )
      .leftJoin(
        "manufacturers",
        "paper_supplies.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin("suppliers", "paper_supplies.supplierId", "suppliers.id")
      .leftJoin("companies", "paper_supplies.companyId", "companies.id")
      .leftJoin("paper_types", "paper_supplies.paperTypeId", "paper_types.id")
      .where("paper_supplies.uuid", uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query.where("companies.uuid", companyUuid);
    }

    const paperSupply = await query.first();

    if (!paperSupply) return null;

    const mapped = this.mapToInterface(paperSupply);
    if (paperSupply.manufacturer) {
      const { id, ...manufacturerWithoutId } = paperSupply.manufacturer;
      mapped.manufacturer = manufacturerWithoutId;
    }
    if (paperSupply.supplier) {
      const { id, ...supplierWithoutId } = paperSupply.supplier;
      mapped.supplier = supplierWithoutId;
    }
    if (paperSupply.company) {
      const { id, ...companyWithoutId } = paperSupply.company;
      mapped.company = companyWithoutId;
    }
    if (paperSupply.paperType) {
      const { id, ...paperTypeWithoutId } = paperSupply.paperType;
      mapped.paperType = paperTypeWithoutId;
    }

    return mapped;
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IPaperSupply {
    // Parse JSON minimumStock field
    let minimumStock = { pallets: 0, boxes: 0 };

    try {
      if (record.minimumStock) {
        minimumStock =
          typeof record.minimumStock === "string"
            ? JSON.parse(record.minimumStock)
            : record.minimumStock;
      }
    } catch (error) {
      console.error("Error parsing minimumStock JSON field:", error);
    }

    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      name: record.name,
      manufacturerId: record.manufacturerId,
      supplierId: record.supplierId,
      paperTypeId: record.paperTypeId,
      grammage: record.grammage ? parseFloat(record.grammage) : undefined,
      price: record.price ? parseFloat(record.price) : undefined,
      minimumStock,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
