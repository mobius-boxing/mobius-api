import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import {
  deriveProductApprovalStatus,
  IProduct,
} from "../../interfaces/product/product.interfaces";
import { toNumberOut } from "../../utils/numbers";
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
import {
  dayRangeFilters,
  numberRangeFilters,
  booleanFilter,
} from "../../utils/filterRanges";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import { assertUuidParam, parseEnumParam } from "../../utils/query-params";
import { Request } from "express";

// companyId is handled separately (companyFilterScope): `filters.companyId` holds a uuid, not a column value.
// The customer filter is `customerUuid`, applied directly on the query in
// getAllWithFilters. There is deliberately NO `customerId` entry here: it
// parseInt'ed a value that, under the uuid-only API, is always a UUID — i.e. it
// was accepted and broken, which L-007 forbids (gate decision OQ-1).
// `approvalState` (I-24) is likewise resolved outside this config, exactly
// like `customerUuid` — see getAllWithFilters.
export const PRODUCT_FILTERS: FilterConfigs = {
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
  uuid: {
    column: "uuid",
    operator: "=",
  },
  vip: booleanFilter("vip"),
  ...dayRangeFilters("createdAt", "createdAt", { timestamp: true }),
  ...numberRangeFilters("revision", "revision"),
  // Many-to-one FKs on `products`; both `product_types` and `box_types` are
  // joined in `selectWithJoins` AND `getAllWithFilters`'s count query (I-2).
  productTypeUuid: { table: "product_types", column: "uuid", operator: "=" },
  boxTypeUuid: { table: "box_types", column: "uuid", operator: "=" },
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

/** I-24: the only valid values of `?approvalState=`. */
const APPROVAL_STATE_VALUES = ["pending", "approved", "cancelled"] as const;

/** double precision columns of the folded recipe (model.md §Persistence). */
const RECIPE_NUMERIC_COLUMNS = [
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "sheetLength",
  "sheetWidth",
  "additionalSheetLength",
  "preferredWidth",
  "flap",
  "lowerFlap",
  "upperFlap",
  "flapOverlap",
  "printSides",
  "compressionTest",
  "burstTest",
  "cobbTest",
  "ect",
  "grammage",
  "lengthUpperTolerance",
  "lengthLowerTolerance",
  "widthUpperTolerance",
  "widthLowerTolerance",
  "overrunPercentage",
  "underrunPercentage",
  "corrugationOverproduction",
  "boxSurface",
  "boxWeight",
  "averageWeight",
  "associatedQuantity",
] as const;

const RECIPE_INT_COLUMNS = ["colorCount", "labelsPerPallet"] as const;

const RECIPE_BOOL_COLUMNS = [
  "symmetricScoreLines",
  "printCode",
  "printDate",
  "printRecyclable",
  "printWarranty",
  "printLogo",
  "printNationalIndustry",
  "printExport",
  "allowsRotation",
  "allowsPartialRotation",
  "mandatoryRotation",
  "allowsGluing",
] as const;

const RECIPE_TEXT_COLUMNS = [
  "corrugationScoreLines",
  "printScoreLines",
  "inks",
  "labelText",
  "claspClosure",
  "foodSafetyNumber",
  "blueprintRef",
  "notes",
  "quotingNotes",
] as const;

/** Internal numeric FK columns; never leave the API (nested uuid refs instead). */
const RECIPE_FK_COLUMNS = [
  "corrugationId",
  "productionRouteId",
  "palletizationId",
  "modelId",
  "flapTypeId",
  "glueTypeId",
  "strappingTypeId",
  "traceTypeId",
  "complementId",
] as const;

const RECIPE_MISC_COLUMNS = ["registeredAt"] as const;

/** Every column a create/update payload may write, base product fields + the folded recipe. */
const ALL_WRITABLE_COLUMNS = [
  "code",
  "clientCode",
  "description",
  "customerId",
  "revision",
  "vip",
  "productTypeId",
  "boxTypeId",
  "technicalSheetFileUuid",
  "blueprintFileUuid",
  "sketchFileUuid",
  "imageFileUuid",
  ...RECIPE_NUMERIC_COLUMNS,
  ...RECIPE_INT_COLUMNS,
  ...RECIPE_BOOL_COLUMNS,
  ...RECIPE_TEXT_COLUMNS,
  ...RECIPE_FK_COLUMNS,
  ...RECIPE_MISC_COLUMNS,
] as const;

/** Every double-precision column, so mapToInterface never leaks a pg string (L-010). */
const FLOAT_COLUMNS = RECIPE_NUMERIC_COLUMNS;

export class ProductDAO implements IBaseDAO<IProduct> {
  private tableName = "products";
  private queryConfig = PRODUCT_QUERY_CONFIG;

  // ── Reads ────────────────────────────────────────────────────────────────
  /** Every nested ref this feature's GET shape carries (model.md §API contracts). */
  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw("to_jsonb(customers.*) as customer"),
        knex.raw('to_jsonb(product_types.*) as "productType"'),
        knex.raw('to_jsonb(box_types.*) as "boxType"'),
        knex.raw(
          `CASE WHEN corr.id IS NOT NULL THEN to_jsonb(corr) END as "corrugation"`,
        ),
        knex.raw(
          `CASE WHEN route.id IS NOT NULL THEN to_jsonb(route) END as "productionRoute"`,
        ),
        knex.raw(
          `CASE WHEN pall.id IS NOT NULL THEN to_jsonb(pall) END as "palletization"`,
        ),
        knex.raw(
          `CASE WHEN mdl.id IS NOT NULL THEN to_jsonb(mdl) END as "model"`,
        ),
        knex.raw(
          `CASE WHEN ft.id IS NOT NULL THEN to_jsonb(ft) END as "flapType"`,
        ),
        knex.raw(
          `CASE WHEN gt.id IS NOT NULL THEN to_jsonb(gt) END as "glueType"`,
        ),
        knex.raw(
          `CASE WHEN st.id IS NOT NULL THEN to_jsonb(st) END as "strappingType"`,
        ),
        knex.raw(
          `CASE WHEN tt.id IS NOT NULL THEN to_jsonb(tt) END as "traceType"`,
        ),
        knex.raw(
          `CASE WHEN comp.id IS NOT NULL THEN to_jsonb(comp) END as "complement"`,
        ),
      )
      .leftJoin("customers", `${this.tableName}.customerId`, "customers.id")
      .leftJoin(
        "product_types",
        `${this.tableName}.productTypeId`,
        "product_types.id",
      )
      .leftJoin("box_types", `${this.tableName}.boxTypeId`, "box_types.id")
      .leftJoin(
        "corrugations as corr",
        `${this.tableName}.corrugationId`,
        "corr.id",
      )
      .leftJoin(
        "production_routes as route",
        `${this.tableName}.productionRouteId`,
        "route.id",
      )
      .leftJoin(
        "palletizations as pall",
        `${this.tableName}.palletizationId`,
        "pall.id",
      )
      .leftJoin("models as mdl", `${this.tableName}.modelId`, "mdl.id")
      .leftJoin("flap_types as ft", `${this.tableName}.flapTypeId`, "ft.id")
      .leftJoin("glue_types as gt", `${this.tableName}.glueTypeId`, "gt.id")
      .leftJoin(
        "strapping_types as st",
        `${this.tableName}.strappingTypeId`,
        "st.id",
      )
      .leftJoin("trace_types as tt", `${this.tableName}.traceTypeId`, "tt.id")
      .leftJoin(
        "complements as comp",
        `${this.tableName}.complementId`,
        "comp.id",
      );
  }

  /**
   * `options.autoAssignRoute` (D-14, I-2): when the caller sent a
   * `corrugationUuid` and no `productionRouteUuid`, a route is resolved
   * (company default global active route, else a private RUTA PROPIA created
   * in this SAME transaction) so `item.productionRouteId` is never left NULL
   * next to a set `corrugationId` (I-15). At most one `production_routes` row
   * is written; a failure leaves neither row behind (I-2).
   */
  async create(
    item: IProduct,
    options?: { autoAssignRoute?: boolean },
  ): Promise<IProduct> {
    const knex = db("tenant");
    const created = await knex.transaction(async (trx) => {
      let productionRouteId = (item.productionRouteId as number | null) ?? null;
      if (options?.autoAssignRoute && !productionRouteId) {
        productionRouteId = await this.resolveAutoRoute(
          trx,
          item.companyId as number,
          item.description || item.code,
        );
      }

      const insertData: Record<string, unknown> = {
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        customerId: item.customerId,
        revision: item.revision ?? 0,
        vip: item.vip ?? false,
        productionRouteId,
      };
      for (const key of ALL_WRITABLE_COLUMNS) {
        if (
          key === "code" ||
          key === "customerId" ||
          key === "revision" ||
          key === "vip" ||
          key === "productionRouteId"
        )
          continue;
        const value = (item as unknown as Record<string, unknown>)[key];
        if (value !== undefined) insertData[key] = value;
      }

      const [row] = await trx(this.tableName).insert(insertData).returning("*");
      return row;
    });

    return (await this.getByUuid(created.uuid)) ?? this.mapToInterface(created);
  }

  /**
   * D-14 route auto-assign: company default global active route, else a new
   * RUTA PROPIA named `{label} (RUTA PROPIA)` — the product's description, or
   * its code when the description is empty (a part always had one).
   */
  private async resolveAutoRoute(
    trx: any,
    companyId: number,
    label: string | null | undefined,
  ): Promise<number> {
    const defaultRoute = await trx("production_routes")
      .where({
        companyId,
        isDefault: true,
        isGlobal: true,
        active: true,
      })
      .select("id")
      .first();
    if (defaultRoute) return defaultRoute.id;

    const [route] = await trx("production_routes")
      .insert({
        uuid: uuidv4(),
        companyId,
        name: `${label ?? ""} (RUTA PROPIA)`,
        isGlobal: false,
        active: true,
        isDefault: false,
      })
      .returning("id");
    return (route as any).id ?? route;
  }

  async getById(id: number): Promise<IProduct | null> {
    const knex = db("tenant");
    const product = await knex(this.tableName).where("id", id).first();

    return product ? this.mapToInterface(product) : null;
  }

  // companyId filter, when present, doubles as an ownership check (null if not in user's company).
  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<IProduct | null> {
    const query = this.selectWithJoins(db("tenant")).where(
      `${this.tableName}.uuid`,
      uuid,
    );

    applyCompanyScope(query, this.tableName, companyId);

    const product = await query.first();

    return product ? this.mapToInterface(product) : null;
  }

  /**
   * `options.autoAssignRoute` (I-15 carve-out): when the caller sent a
   * `corrugationUuid` and no `productionRouteUuid` on a product that has
   * neither yet, a route is resolved the same way `create` does, in this
   * SAME transaction as the UPDATE — so a route-less product never ends up
   * with `corrugationId` set and `productionRouteId` still NULL. I-3: one
   * UPDATE products, plus at most one `production_routes` row in that case.
   */
  async update(
    id: number,
    item: Partial<IProduct>,
    options?: {
      autoAssignRoute?: boolean;
      companyId?: number;
      description?: string | null;
    },
  ): Promise<IProduct | null> {
    const knex = db("tenant");
    const updated = await knex.transaction(async (trx) => {
      const updateData: Record<string, unknown> = {};

      for (const key of ALL_WRITABLE_COLUMNS) {
        const value = (item as unknown as Record<string, unknown>)[key];
        if (value !== undefined) updateData[key] = value;
      }

      if (
        options?.autoAssignRoute &&
        updateData.productionRouteId === undefined &&
        options.companyId != null
      ) {
        updateData.productionRouteId = await this.resolveAutoRoute(
          trx,
          options.companyId,
          options.description,
        );
      }

      updateData.updatedAt = trx.fn.now();

      const [row] = await trx(this.tableName)
        .where("id", id)
        .update(updateData)
        .returning("*");
      return row;
    });

    return updated
      ? ((await this.getByUuid(updated.uuid)) ?? this.mapToInterface(updated))
      : null;
  }

  /**
   * `products."productionRouteId"` is the sole owner of a private RUTA PROPIA
   * (D-6, L-006): no cascade performs this cleanup, so a product's own
   * private route is dropped here when nothing else references it.
   */
  async delete(id: number): Promise<boolean> {
    const knex = db("tenant");
    return knex.transaction(async (trx) => {
      const product = await trx(this.tableName)
        .where("id", id)
        .whereNotNull("productionRouteId")
        .select("productionRouteId")
        .first();

      const deleted = await trx(this.tableName).where("id", id).delete();

      if (deleted > 0 && product?.productionRouteId) {
        await trx("production_routes")
          .where("id", product.productionRouteId)
          .where("isGlobal", false)
          .whereNotExists(
            trx(this.tableName).whereRaw(
              `"${this.tableName}"."productionRouteId" = production_routes.id`,
            ),
          )
          .delete();
      }

      return deleted > 0;
    });
  }

  async getAll(
    page: number,
    limit: number,
    companyId?: CompanyScope,
  ): Promise<IDataPaginator<IProduct>> {
    const knex = db("tenant");
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
    const countQuery = knex(this.tableName);

    applyCompanyScope(query, this.tableName, companyId);
    applyCompanyScope(countQuery, this.tableName, companyId);

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
      data: products.map((product: any) => this.mapToInterface(product)),
      page,
      limit,
      count: products.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IProduct>> {
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    // customerUuid → the numeric column, applied on the query (not through the
    // filter config, so no numeric internal id is client-reachable). A miss
    // pins the impossible id -1 rather than returning everything. The value is
    // shape-checked first: `customers.uuid` is a uuid column, so a malformed
    // value would reach Postgres and come back as 22P02 — a 500 whose body can
    // echo the generated SQL — instead of a 400.
    const customerUuid = assertUuidParam(
      "customerUuid",
      parsedQuery.filters.customerUuid,
    );
    delete parsedQuery.filters.customerUuid;
    let customerId: number | undefined;
    if (customerUuid) {
      const customer = await knex("customers")
        .where("uuid", customerUuid)
        .select("id")
        .first();
      customerId = customer?.id ?? -1;
    }

    // I-24: pre-resolved exactly like customerUuid, applied to data AND count.
    const approvalState = parseEnumParam(
      "approvalState",
      parsedQuery.filters.approvalState,
      APPROVAL_STATE_VALUES,
    );
    delete parsedQuery.filters.approvalState;

    const applyExtra = (q: any) => {
      applyCompanyScope(q, this.tableName, companyId);
      if (customerId !== undefined) {
        q.where(`${this.tableName}.customerId`, customerId);
      }
      if (approvalState === "approved") {
        q.whereNotNull(`${this.tableName}.productApprovalAt`);
      } else if (approvalState === "cancelled") {
        q.whereNotNull(`${this.tableName}.productCancellationAt`);
      } else if (approvalState === "pending") {
        q.whereNull(`${this.tableName}.productApprovalAt`).whereNull(
          `${this.tableName}.productCancellationAt`,
        );
      }
      return q;
    };

    const dataQuery = applyExtra(this.selectWithJoins(knex));
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // `productTypeUuid`/`boxTypeUuid` (I-2, C-1) qualify against these same
    // joins; `selectWithJoins` carries them for the data query already.
    const countQuery = applyExtra(
      knex(this.tableName)
        .leftJoin(
          "product_types",
          `${this.tableName}.productTypeId`,
          "product_types.id",
        )
        .leftJoin("box_types", `${this.tableName}.boxTypeId`, "box_types.id"),
    );
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [products, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: products.map((product: any) => this.mapToInterface(product)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: products.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getIdByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<number | null> {
    const knex = db("tenant");
    const query = knex(this.tableName)
      .select(`${this.tableName}.id`)
      .where(`${this.tableName}.uuid`, uuid);

    applyCompanyScope(query, this.tableName, companyId);

    const record = await query.first();
    return record ? record.id : null;
  }

  async getWithDetails(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<IProduct | null> {
    const query = this.selectWithJoins(db("tenant")).where(
      `${this.tableName}.uuid`,
      uuid,
    );

    applyCompanyScope(query, this.tableName, companyId);

    const product = await query.first();

    return product ? this.mapToInterface(product) : null;
  }

  // ── Mapping ──────────────────────────────────────────────────────────────
  // SECURITY: uuid-only surface; numeric ids stripped from nested objects.
  private mapToInterface(record: any): IProduct {
    const num = toNumberOut;
    const pick = (obj: any, fields: string[]) => {
      if (!obj) return null;
      const out: any = { uuid: obj.uuid };
      for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
      return out;
    };

    const product: IProduct = {
      uuid: record.uuid,
      // Internal: the response middleware strips numeric *Id keys globally;
      // the controller needs it to scope the I-15 route auto-assign on PUT.
      companyId: record.companyId,
      code: record.code,
      clientCode: record.clientCode,
      description: record.description,
      revision: record.revision,
      vip: record.vip,
      technicalSheetFileUuid: record.technicalSheetFileUuid,
      blueprintFileUuid: record.blueprintFileUuid,
      sketchFileUuid: record.sketchFileUuid,
      imageFileUuid: record.imageFileUuid,
      productApprovalAt: record.productApprovalAt,
      productApprovalBy: record.productApprovalBy,
      productCancellationAt: record.productCancellationAt,
      productCancellationBy: record.productCancellationBy,
      partLegacyId: record.partLegacyId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    for (const key of FLOAT_COLUMNS) {
      (product as unknown as Record<string, unknown>)[key] = num(record[key]);
    }
    for (const key of RECIPE_INT_COLUMNS) {
      (product as unknown as Record<string, unknown>)[key] =
        record[key] != null ? parseInt(record[key], 10) : null;
    }
    for (const key of RECIPE_BOOL_COLUMNS) {
      (product as unknown as Record<string, unknown>)[key] =
        record[key] ?? false;
    }
    for (const key of RECIPE_TEXT_COLUMNS) {
      (product as unknown as Record<string, unknown>)[key] =
        record[key] ?? null;
    }
    product.registeredAt = record.registeredAt ?? null;

    // Transients (I-7, I-8): computed here, never persisted.
    product.approvalStatus = deriveProductApprovalStatus(product);
    product.effectiveGrammage =
      num(record.grammage) ??
      num(record.corrugation?.theoreticalGrammage) ??
      null;
    product.sheetSurface =
      record.sheetLength != null && record.sheetWidth != null
        ? (parseFloat(record.sheetLength) * parseFloat(record.sheetWidth)) /
          1_000_000
        : null;

    if (record.customer) {
      const { id, companyId, categoryId, salesPersonId, ...customerClean } =
        record.customer;
      product.customer = customerClean;
    }
    if (record.productType) {
      const { id, companyId, ...withoutId } = record.productType;
      product.productType = withoutId;
    }
    if (record.boxType) {
      const { id, companyId, ...withoutId } = record.boxType;
      product.boxType = withoutId;
    }
    product.corrugation = pick(record.corrugation, [
      "code",
      "theoreticalGrammage",
    ]);
    product.productionRoute = pick(record.productionRoute, [
      "name",
      "isGlobal",
    ]);
    product.palletization = pick(record.palletization, ["code", "name"]);
    product.model = pick(record.model, ["code", "description"]);
    product.flapType = pick(record.flapType, ["code"]);
    product.glueType = pick(record.glueType, ["code"]);
    product.strappingType = pick(record.strappingType, ["code"]);
    product.traceType = pick(record.traceType, ["code"]);
    product.complement = pick(record.complement, ["code"]);

    return product;
  }

  /**
   * Product approval pair semantics (module 06 §04-state-and-lifecycle):
   * approve sets AprobacionProducto(+user snapshot) and CLEARS the
   * cancellation pair; cancel does the reverse. Pending = both NULL.
   */
  async setApproval(
    id: number,
    action: "approve" | "cancel",
    username: string,
    trx?: any,
  ): Promise<IProduct | null> {
    const knex = trx ?? db("tenant");
    const updateData =
      action === "approve"
        ? {
            productApprovalAt: knex.fn.now(),
            productApprovalBy: username,
            productCancellationAt: null,
            productCancellationBy: null,
          }
        : {
            productCancellationAt: knex.fn.now(),
            productCancellationBy: username,
            productApprovalAt: null,
            productApprovalBy: null,
          };
    const [product] = await knex(this.tableName)
      .where("id", id)
      .update({ ...updateData, updatedAt: knex.fn.now() })
      .returning("*");
    return product ? this.mapToInterface(product) : null;
  }
}
