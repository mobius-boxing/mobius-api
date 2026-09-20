import { db } from "../../database/registry";
import { DeliveryLocationDAO } from "../delivery-location/delivery-location.dao";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";
import {
  asCompanyPayload,
  CoreClient,
} from "../../services/core-client.service";
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
import { dayRangeFilters } from "../../utils/filterRanges";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import { Request } from "express";

// companyId is intentionally absent — getAllWithFilters scopes through
// companyFilterScope(req); `filters.companyId` holds a uuid, not a column value.
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
  // Joined in getAllWithFilters (data + count, I-2): many-to-one FK on customers.
  categoryUuid: { table: "customer_categories", column: "uuid", operator: "=" },
  ...dayRangeFilters("createdAt", "createdAt", { timestamp: true }),
  // salesPersonUuid is NOT here: `users` lives in the core database (a separate
  // connection from `customers`' tenant db — see `services/core-client.service.ts`),
  // so it cannot be a SQL join like `categoryUuid`. Resolved via
  // `CoreClient.userIdByUuid` in getAllWithFilters instead, exactly like
  // `customerUuid` on `product.dao.ts` (D-9).
};

const CUSTOMER_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
  supplierCode: { column: "supplier_code" },
};

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
  private addressLocationDAO = new DeliveryLocationDAO();
  private tableName = "customers";
  private queryConfig = CUSTOMER_QUERY_CONFIG;

  async create(item: ICustomer): Promise<ICustomer> {
    const knex = db("tenant");
    const customer = await knex.transaction(async (trx) => {
      const [row] = await trx(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        name: item.name,
        code: item.code,
        dispatchable: item.dispatchable ?? true,
        notes: item.notes,
        excludeLogoOnLabels: item.excludeLogoOnLabels ?? false,
        requiresQualityCertificate: item.requiresQualityCertificate ?? false,
        supplier_code: item.supplierCode,
        salesPersonId: item.salesPersonId,
        categoryId: item.categoryId,
        active: item.active ?? true,
        legalName: item.legalName,
        legal_code: item.legalCode,
        address: item.address,
        tradeName: item.tradeName,
        contacts: JSON.stringify(item.contacts || []),
        // deliveryLocations/deliveryDays live in delivery_locations /
        // delivery_schedules since 20260720000008 (§L.6).
      })
      .returning("*");
      await this.addressLocationDAO.syncCustomerAddressTrx(trx, row);
      return row;
    });

    return this.mapToInterface(customer);
  }

  async getById(id: number): Promise<ICustomer | null> {
    const knex = db("tenant");
    const customer = await knex(this.tableName).where("id", id).first();

    return customer ? this.mapToInterface(customer) : null;
  }

  // companyId filter, when present, doubles as an ownership check (null if not in user's company).
  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<ICustomer | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    applyCompanyScope(query, this.tableName, companyId);

    const customer = await query.select(`${this.tableName}.*`).first();

    return customer ? this.mapToInterface(customer) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<number | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where("uuid", uuid);

    applyCompanyScope(query, this.tableName, companyId);

    const customer = await query.select("id").first();

    return customer ? customer.id : null;
  }

  async update(
    id: number,
    item: Partial<ICustomer>,
  ): Promise<ICustomer | null> {
    const knex = db("tenant");
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.code !== undefined) updateData.code = item.code;
    if (item.dispatchable !== undefined)
      updateData.dispatchable = item.dispatchable;
    if (item.notes !== undefined) updateData.notes = item.notes;
    if (item.excludeLogoOnLabels !== undefined)
      updateData.excludeLogoOnLabels = item.excludeLogoOnLabels;
    if (item.requiresQualityCertificate !== undefined)
      updateData.requiresQualityCertificate = item.requiresQualityCertificate;
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
    // deliveryLocations/deliveryDays moved to real tables (20260720000008).

    updateData.updatedAt = knex.fn.now();

    const customer = await knex.transaction(async (trx) => {
      const [row] = await trx(this.tableName)
        .where("id", id)
        .update(updateData)
        .returning("*");
      if (row && item.address !== undefined) {
        await this.addressLocationDAO.syncCustomerAddressTrx(trx, row);
      }
      return row;
    });

    return customer ? this.mapToInterface(customer) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("tenant");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
    companyId?: CompanyScope,
  ): Promise<IDataPaginator<ICustomer>> {
    const knex = db("tenant");
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
    const countQuery = knex(this.tableName);

    applyCompanyScope(query, this.tableName, companyId);
    applyCompanyScope(countQuery, this.tableName, companyId);

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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICustomer>> {
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    // salesPersonUuid: resolved outside the generic filter config, exactly
    // like product.dao's customerUuid — `users` is a core-db entity (D-9), so
    // there is no local table to qualify with `table:`. A miss pins the
    // impossible id -1 rather than matching every customer.
    const salesPersonUuid = parsedQuery.filters.salesPersonUuid as
      | string
      | undefined;
    delete parsedQuery.filters.salesPersonUuid;
    let salesPersonId: number | undefined;
    if (salesPersonUuid) {
      salesPersonId = (await CoreClient.userIdByUuid(salesPersonUuid)) ?? -1;
    }

    // `categoryUuid` qualifies against this join (I-2, C-1); many-to-one FK
    // on `customers`, so neither query's row count is affected by it.
    const withCategoryJoin = (q: any) =>
      q.leftJoin(
        "customer_categories",
        `${this.tableName}.categoryId`,
        "customer_categories.id",
      );

    const dataQuery = withCategoryJoin(
      knex(this.tableName).select(`${this.tableName}.*`),
    );

    applyCompanyScope(dataQuery, this.tableName, companyId);
    if (salesPersonId !== undefined) {
      dataQuery.where(`${this.tableName}.salesPersonId`, salesPersonId);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = withCategoryJoin(knex(this.tableName));

    applyCompanyScope(countQuery, this.tableName, companyId);
    if (salesPersonId !== undefined) {
      countQuery.where(`${this.tableName}.salesPersonId`, salesPersonId);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [customers, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: customers.map((customer: any) => this.mapToInterface(customer)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: customers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getCustomerWithDetails(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<ICustomer | null> {
    const knex = db("tenant");

    const query = knex(this.tableName)
      .select(
        "customers.*",
        knex.raw("to_jsonb(customer_categories.*) as category"),
      )
      .leftJoin(
        "customer_categories",
        "customers.categoryId",
        "customer_categories.id",
      )
      .where("customers.uuid", uuid);

    applyCompanyScope(query, this.tableName, companyId);

    const customer = await query.first();

    if (!customer) return null;

    const [[company], [salesPerson]] = await Promise.all([
      typeof customer.companyId === "number"
        ? CoreClient.companiesByIds([customer.companyId])
        : [],
      typeof customer.salesPersonId === "number"
        ? CoreClient.usersByIds([customer.salesPersonId])
        : [],
    ]);

    const mapped = this.mapToInterface(customer);
    mapped.company = company && asCompanyPayload(company);
    mapped.category = customer.category;
    mapped.salesPerson = salesPerson
      ? {
          uuid: salesPerson.uuid,
          email: salesPerson.email,
          firstName: salesPerson.firstName,
          lastName: salesPerson.lastName,
          role: salesPerson.role,
        }
      : null;

    return mapped;
  }

  private mapToInterface(record: any): ICustomer {
    let contacts = [];

    try {
      if (record.contacts) {
        contacts =
          typeof record.contacts === "string"
            ? JSON.parse(record.contacts)
            : record.contacts;
      }
    } catch (error) {
      console.error("Error parsing customer JSON fields:", error);
    }

    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      name: record.name,
      code: record.code,
      dispatchable: record.dispatchable ?? true,
      notes: record.notes,
      excludeLogoOnLabels: record.excludeLogoOnLabels ?? false,
      requiresQualityCertificate: record.requiresQualityCertificate ?? false,
      supplierCode: record.supplier_code,
      salesPersonId: record.salesPersonId,
      categoryId: record.categoryId,
      active: record.active ?? true,
      legalName: record.legalName,
      legalCode: record.legal_code,
      address: record.address,
      tradeName: record.tradeName,
      contacts,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
