import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";
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
 * Customer filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const CUSTOMER_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  active: {
    column: "active",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  categoryId: {
    column: "categoryId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  salesPersonId: {
    column: "salesPersonId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  supplierCode: {
    column: "supplier_code",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

/**
 * Customer sort configuration
 */
const CUSTOMER_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
  supplierCode: { column: "supplier_code" },
};

/**
 * Customer query builder configuration
 */
const CUSTOMER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "customers",
  {
    filters: CUSTOMER_FILTERS,
    sorting: CUSTOMER_SORTING,
    search: {
      columns: ["name", "supplier_code", "legalName", "tradeName"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  },
);

export class CustomerDAO implements IBaseDAO<ICustomer> {
  private tableName = "customers";
  private queryConfig = CUSTOMER_QUERY_CONFIG;

  /**
   * Create a new customer
   */
  async create(item: ICustomer): Promise<ICustomer> {
    const knex = KnexManager.getConnection();
    const [customer] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        name: item.name,
        supplier_code: item.supplierCode,
        salesPersonId: item.salesPersonId,
        categoryId: item.categoryId,
        active: item.active ?? true,
        legalName: item.legalName,
        legal_code: item.legalCode,
        address: item.address,
        tradeName: item.tradeName,
        contacts: JSON.stringify(item.contacts || []),
        deliveryLocations: JSON.stringify(item.deliveryLocations || []),
        deliveryDays: JSON.stringify(item.deliveryDays || []),
      })
      .returning("*");

    return this.mapToInterface(customer);
  }

  /**
   * Get customer by ID
   */
  async getById(id: number): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();
    const customer = await knex(this.tableName).where("id", id).first();

    return customer ? this.mapToInterface(customer) : null;
  }

  /**
   * Get customer by UUID
   */
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const customer = await query.select(`${this.tableName}.*`).first();

    return customer ? this.mapToInterface(customer) : null;
  }

  /**
   * Get customer numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const customer = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return customer ? customer.id : null;
  }

  /**
   * Update customer by ID
   */
  async update(
    id: number,
    item: Partial<ICustomer>,
  ): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.supplierCode !== undefined)
      updateData.supplier_code = item.supplierCode;
    if (item.salesPersonId !== undefined)
      updateData.salesPersonId = item.salesPersonId;
    if (item.categoryId !== undefined) updateData.categoryId = item.categoryId;
    if (item.active !== undefined) updateData.active = item.active;
    if (item.legalName !== undefined) updateData.legalName = item.legalName;
    if (item.legalCode !== undefined) updateData.legal_code = item.legalCode;
    if (item.address !== undefined) updateData.address = item.address;
    if (item.tradeName !== undefined) updateData.tradeName = item.tradeName;
    if (item.contacts !== undefined)
      updateData.contacts = JSON.stringify(item.contacts);
    if (item.deliveryLocations !== undefined)
      updateData.deliveryLocations = JSON.stringify(item.deliveryLocations);
    if (item.deliveryDays !== undefined)
      updateData.deliveryDays = JSON.stringify(item.deliveryDays);

    updateData.updatedAt = knex.fn.now();

    const [customer] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return customer ? this.mapToInterface(customer) : null;
  }

  /**
   * Delete customer by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all customers with pagination
   */
  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<ICustomer>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
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

    const [customers, totalResult] = await Promise.all([
      query
        .select(`${this.tableName}.*`)
        .orderBy(`${this.tableName}.createdAt`, "desc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: customers.map((customer) => this.mapToInterface(customer)),
      page,
      limit,
      count: customers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all customers with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   * Handles companyId as UUID (joins with companies table)
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICustomer>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Extract companyId (UUID) from filters - handle it separately via join
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

    // Join with companies if filtering by company UUID
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [customers, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: customers.map((customer) => this.mapToInterface(customer)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: customers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Get customer with related details (company, category, salesPerson) using to_jsonb
   */
  async getCustomerWithDetails(
    uuid: string,
    companyUuid?: string,
  ): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();

    const query = knex(this.tableName)
      .select(
        "customers.*",
        knex.raw("to_jsonb(companies.*) as company"),
        knex.raw("to_jsonb(customer_categories.*) as category"),
        knex.raw(
          `to_jsonb(row(users.id, users.uuid, users.email, users.first_name, users.last_name, users.role)::record) as sales_person`,
        ),
      )
      .leftJoin("companies", "customers.companyId", "companies.id")
      .leftJoin(
        "customer_categories",
        "customers.categoryId",
        "customer_categories.id",
      )
      .leftJoin("users", "customers.salesPersonId", "users.id")
      .where("customers.uuid", uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query.where("companies.uuid", companyUuid);
    }

    const customer = await query.first();

    if (!customer) return null;

    const mapped = this.mapToInterface(customer);
    mapped.company = customer.company;
    mapped.category = customer.category;
    mapped.salesPerson = customer.sales_person;

    return mapped;
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ICustomer {
    // Parse JSON fields
    let contacts = [];
    let deliveryLocations = [];
    let deliveryDays = [];

    try {
      if (record.contacts) {
        contacts =
          typeof record.contacts === "string"
            ? JSON.parse(record.contacts)
            : record.contacts;
      }
      if (record.deliveryLocations) {
        deliveryLocations =
          typeof record.deliveryLocations === "string"
            ? JSON.parse(record.deliveryLocations)
            : record.deliveryLocations;
      }
      if (record.deliveryDays) {
        deliveryDays =
          typeof record.deliveryDays === "string"
            ? JSON.parse(record.deliveryDays)
            : record.deliveryDays;
      }
    } catch (error) {
      console.error("Error parsing customer JSON fields:", error);
    }

    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      name: record.name,
      supplierCode: record.supplier_code,
      salesPersonId: record.salesPersonId,
      categoryId: record.categoryId,
      active: record.active ?? true,
      legalName: record.legalName,
      legalCode: record.legal_code,
      address: record.address,
      tradeName: record.tradeName,
      contacts,
      deliveryLocations,
      deliveryDays,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
