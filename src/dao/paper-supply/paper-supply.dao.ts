import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperSupply } from "../../interfaces/paper-supply/paper-supply.interfaces";

export class PaperSupplyDAO implements IBaseDAO<IPaperSupply> {
  private tableName = "paper_supplies";

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
   * Get all paper supplies with pagination
   * Includes manufacturer and supplier details
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
      )
      .leftJoin(
        "manufacturers",
        "paper_supplies.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin("suppliers", "paper_supplies.supplierId", "suppliers.id");

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
        mapped.manufacturer = paperSupply.manufacturer;
        mapped.supplier = paperSupply.supplier;
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
   * Get paper supply with related details (manufacturer, supplier, company) using to_jsonb
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
      )
      .leftJoin(
        "manufacturers",
        "paper_supplies.manufacturerId",
        "manufacturers.id",
      )
      .leftJoin("suppliers", "paper_supplies.supplierId", "suppliers.id")
      .leftJoin("companies", "paper_supplies.companyId", "companies.id")
      .where("paper_supplies.uuid", uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query.where("companies.uuid", companyUuid);
    }

    const paperSupply = await query.first();

    if (!paperSupply) return null;

    const mapped = this.mapToInterface(paperSupply);
    mapped.manufacturer = paperSupply.manufacturer;
    mapped.supplier = paperSupply.supplier;
    mapped.company = paperSupply.company;

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
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      name: record.name,
      manufacturerId: record.manufacturerId,
      supplierId: record.supplierId,
      minimumStock,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
