import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IProduct } from "../../interfaces/product/product.interfaces";
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
const PRODUCT_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  clientCode: {
    column: "clientCode",
    operator: "ILIKE",
  },
  description: {
    column: "description",
    operator: "ILIKE",
  },
  customerId: {
    column: "customerId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const PRODUCT_SORTING: SortConfigs = {
  code: { column: "code" },
  clientCode: { column: "clientCode" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const PRODUCT_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("products", {
  filters: PRODUCT_FILTERS,
  sorting: PRODUCT_SORTING,
  search: {
    columns: ["code", "clientCode", "description"],
    operator: "ILIKE",
  },
  defaultSort: {
    column: "createdAt",
    order: "desc",
  },
});

export class ProductDAO implements IBaseDAO<IProduct> {
  private tableName = "products";
  private queryConfig = PRODUCT_QUERY_CONFIG;

  async create(item: IProduct): Promise<IProduct> {
    const knex = KnexManager.getConnection();
    const [product] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        clientCode: item.clientCode,
        description: item.description,
        customerId: item.customerId,
        revision: item.revision ?? 0,
        vip: item.vip ?? false,
        productTypeId: item.productTypeId,
        boxTypeId: item.boxTypeId,
      })
      .returning("*");

    return this.mapToInterface(product);
  }

  async getById(id: number): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();
    const product = await knex(this.tableName).where("id", id).first();

    return product ? this.mapToInterface(product) : null;
  }

  // companyUuid filter, when present, doubles as an ownership check (null if not in user's company).
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const product = await query.select(`${this.tableName}.*`).first();

    return product ? this.mapToInterface(product) : null;
  }

  async update(id: number, item: Partial<IProduct>): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.clientCode !== undefined) updateData.clientCode = item.clientCode;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.customerId !== undefined) updateData.customerId = item.customerId;
    if (item.revision !== undefined) updateData.revision = item.revision;
    if (item.vip !== undefined) updateData.vip = item.vip;
    if (item.productTypeId !== undefined)
      updateData.productTypeId = item.productTypeId;
    if (item.boxTypeId !== undefined) updateData.boxTypeId = item.boxTypeId;

    updateData.updatedAt = knex.fn.now();

    const [product] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return product ? this.mapToInterface(product) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<IProduct>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const [products, totalResult] = await Promise.all([
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
      data: products.map((product) => this.mapToInterface(product)),
      page,
      limit,
      count: products.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IProduct>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw("to_jsonb(customers.*) as customer"),
        knex.raw("to_jsonb(product_types.*) as \"productType\""),
        knex.raw("to_jsonb(box_types.*) as \"boxType\""),
      )
      .leftJoin("customers", `${this.tableName}.customerId`, "customers.id")
      .leftJoin(
        "product_types",
        `${this.tableName}.productTypeId`,
        "product_types.id",
      )
      .leftJoin(
        "box_types",
        `${this.tableName}.boxTypeId`,
        "box_types.id",
      );

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [products, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: products.map((product) => {
        const mapped = this.mapToInterface(product);
        if (product.customer) {
          const { id, companyId, categoryId, salesPersonId, ...customerClean } = product.customer;
          mapped.customer = customerClean;
        }
        if (product.productType) {
          const { id, companyId, ...withoutId } = product.productType;
          mapped.productType = withoutId;
        }
        if (product.boxType) {
          const { id, companyId, ...withoutId } = product.boxType;
          mapped.boxType = withoutId;
        }
        return mapped;
      }),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: products.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName)
      .select(`${this.tableName}.id`)
      .where(`${this.tableName}.uuid`, uuid);

    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const record = await query.first();
    return record ? record.id : null;
  }

  async getWithDetails(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProduct | null> {
    const knex = KnexManager.getConnection();

    const query = knex(this.tableName)
      .select("products.*", knex.raw("to_jsonb(customers.*) as customer"))
      .leftJoin("customers", "products.customerId", "customers.id")
      .where("products.uuid", uuid);

    if (companyUuid) {
      query
        .join("companies", "products.companyId", "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const product = await query.first();

    if (!product) return null;

    const mapped = this.mapToInterface(product);
    if (product.customer) {
      const { id, companyId, categoryId, salesPersonId, ...customerClean } = product.customer;
      mapped.customer = customerClean;
    }

    return mapped;
  }

  private mapToInterface(record: any): IProduct {
    return {
      uuid: record.uuid,
      code: record.code,
      clientCode: record.clientCode,
      description: record.description,
      revision: record.revision,
      vip: record.vip,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
