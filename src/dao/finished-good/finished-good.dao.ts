import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IFinishedGood } from "../../interfaces/finished-good/finished-good.interfaces";
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
import { applyCompanyUuidScope } from "../../utils/daoScope";

const FINISHED_GOOD_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
  name: { column: "name", operator: "ILIKE" },
  supplierId: {
    column: "supplierId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
};

const FINISHED_GOOD_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  minimumStock: { column: "minimumStock" },
  createdAt: { column: "createdAt" },
};

const FINISHED_GOOD_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "finished_goods",
  {
    filters: FINISHED_GOOD_FILTERS,
    sorting: FINISHED_GOOD_SORTING,
    search: { columns: ["code", "name", "description"], operator: "ILIKE" },
    defaultSort: { column: "code", order: "asc" },
  },
);

export class FinishedGoodDAO {
  private tableName = "finished_goods";
  private queryConfig = FINISHED_GOOD_QUERY_CONFIG;

  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(
          `CASE WHEN s.id IS NOT NULL THEN to_jsonb(s) END as "supplier"`,
        ),
        knex.raw(
          `CASE WHEN m.id IS NOT NULL THEN to_jsonb(m) END as "manufacturer"`,
        ),
      )
      .leftJoin("suppliers as s", `${this.tableName}.supplierId`, "s.id")
      .leftJoin(
        "manufacturers as m",
        `${this.tableName}.manufacturerId`,
        "m.id",
      );
  }

  async create(item: IFinishedGood): Promise<IFinishedGood> {
    const knex = db("erp");
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code ?? null,
        name: item.name,
        description: item.description ?? null,
        supplierId: item.supplierId ?? null,
        manufacturerId: item.manufacturerId ?? null,
        partId: item.partId ?? null,
        stageId: item.stageId ?? null,
        minimumStock: item.minimumStock ?? null,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IFinishedGood | null> {
    const knex = db("erp");
    const query = this.selectWithJoins(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(
    id: number,
    item: Partial<IFinishedGood>,
  ): Promise<IFinishedGood | null> {
    const knex = db("erp");
    const updateData: any = {};
    for (const key of [
      "code",
      "name",
      "description",
      "supplierId",
      "manufacturerId",
      "partId",
      "stageId",
      "minimumStock",
    ] as const) {
      if (item[key] !== undefined) updateData[key] = item[key];
    }
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IFinishedGood>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = this.selectWithJoins(knex);
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

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  // SECURITY: uuid-only surface; numeric ids stripped from nested objects.
  private mapToInterface(record: any): IFinishedGood {
    const strip = (obj: any) => {
      if (!obj) return null;
      const { id, companyId, ...rest } = obj;
      return rest;
    };
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      name: record.name,
      description: record.description,
      partId: record.partId,
      stageId: record.stageId,
      minimumStock:
        record.minimumStock != null ? parseFloat(record.minimumStock) : null,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      supplier: strip(record.supplier),
      manufacturer: strip(record.manufacturer),
    };
  }
}
