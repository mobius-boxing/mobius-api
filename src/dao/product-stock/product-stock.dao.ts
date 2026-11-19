import { Request } from "express";
import type { Knex } from "knex";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IProductStock } from "../../interfaces/product-stock/product-stock.interfaces";
import {
  buildCountQuery,
  buildQuery,
  createQueryConfig,
  parseQueryParams,
  type ParsedQuery,
  type QueryBuilderConfig,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { applyCompanyScope } from "../../utils/daoScope";
import { assertUuidParam } from "../../utils/query-params";
import { rejectUnknownListParams } from "../quotation/quotation.dao";

const TABLE = "product_stock";

const PRODUCT_STOCK_SORTING: SortConfigs = {
  createdAt: { column: "createdAt" },
  quantity: { column: "quantity" },
  productCode: { table: "prod", column: "code", natural: true },
  warehouseName: { table: "wh", column: "name", natural: true },
};

const PRODUCT_STOCK_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  TABLE,
  {
    sorting: PRODUCT_STOCK_SORTING,
    defaultSort: { column: "createdAt", order: "desc" },
  },
);

const LIST_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "warehouseUuid",
  "productUuid",
  "companyId",
] as const;

/** Read-only: rows are written only by the receipt transaction (I-13). */
export class ProductStockDAO {
  /** Inside the caller's receipt transaction. */
  async insertTrx(
    trx: Knex.Transaction,
    item: {
      uuid: string;
      companyId: number;
      warehouseId: number;
      productId: number;
      productionOrderId: number | null;
      quantity: number;
      comments?: string | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await trx(TABLE)
      .insert({ ...item, comments: item.comments ?? null })
      .returning(["id", "uuid"]);
    return row;
  }

  async getAllWithFilters(
    req: Request,
    companyId: number,
  ): Promise<IDataPaginator<IProductStock>> {
    rejectUnknownListParams(
      req,
      LIST_PARAMS,
      Object.keys(PRODUCT_STOCK_SORTING),
    );
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    delete parsedQuery.filters.companyId;

    const resolve = async (
      name: string,
      table: "warehouses" | "products",
    ): Promise<number | undefined> => {
      const uuid = assertUuidParam(name, parsedQuery.filters[name]);
      delete parsedQuery.filters[name];
      if (!uuid) return undefined;
      const scope =
        table === "warehouses" ? { company_id: companyId } : { companyId };
      const row = await knex(table)
        .where({ uuid, ...scope })
        .select("id")
        .first();
      return row?.id ?? -1;
    };
    const warehouseId = await resolve("warehouseUuid", "warehouses");
    const productId = await resolve("productUuid", "products");
    const search = parsedQuery.search?.trim();
    delete parsedQuery.search;

    const applyExtra = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      applyCompanyScope(q, TABLE, companyId);
      if (warehouseId !== undefined)
        q.where(`${TABLE}.warehouseId`, warehouseId);
      if (productId !== undefined) q.where(`${TABLE}.productId`, productId);
      if (search) {
        const pattern = `%${search}%`;
        q.where((b) => {
          b.whereExists(
            knex("products")
              .select(knex.raw("1"))
              .whereRaw(`products.id = ${TABLE}."productId"`)
              .andWhere((p) =>
                p
                  .where("products.code", "ILIKE", pattern)
                  .orWhere("products.description", "ILIKE", pattern),
              ),
          ).orWhereExists(
            knex("production_orders")
              .select(knex.raw("1"))
              .whereRaw(`production_orders.id = ${TABLE}."productionOrderId"`)
              .andWhere("production_orders.number", "ILIKE", pattern),
          );
        });
      }
      return q;
    };

    const dataQuery = applyExtra(
      knex(TABLE)
        .select(
          `${TABLE}.*`,
          knex.raw(
            `jsonb_build_object('uuid', wh.uuid, 'name', wh.name) as "warehouse"`,
          ),
          knex.raw(
            `jsonb_build_object('uuid', prod.uuid, 'code', prod.code, 'description', prod.description) as "product"`,
          ),
          knex.raw(
            `CASE WHEN po.id IS NOT NULL THEN jsonb_build_object('uuid', po.uuid, 'number', po.number) END as "productionOrder"`,
          ),
        )
        .join("warehouses as wh", `${TABLE}.warehouseId`, "wh.id")
        .join("products as prod", `${TABLE}.productId`, "prod.id")
        .leftJoin(
          "production_orders as po",
          `${TABLE}.productionOrderId`,
          "po.id",
        ),
    );
    buildQuery(dataQuery, parsedQuery, PRODUCT_STOCK_QUERY_CONFIG);
    const countQuery = applyExtra(knex(TABLE));
    buildCountQuery(countQuery, parsedQuery, PRODUCT_STOCK_QUERY_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;
    return {
      success: true,
      data: rows.map(
        (row: any): IProductStock => ({
          uuid: row.uuid,
          warehouse: row.warehouse,
          product: row.product,
          productionOrder: row.productionOrder ?? null,
          quantity: row.quantity,
          comments: row.comments ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      ),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }
}
