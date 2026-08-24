import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IModel } from "../../interfaces/model/model.interfaces";
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
import { assertUuidParam } from "../../utils/query-params";

// companyId is handled via a join (client sends a UUID); flapTypeUuid /
// complementUuid are pre-resolved to numeric ids in getAllWithFilters
// (part.dao.ts pattern) before reaching these configs.
const MODEL_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
};

/**
 * Resolved internal ids. Deliberately NOT in MODEL_FILTERS: this is a uuid-only
 * surface, and a client-supplied `?flapTypeId=3` would be sequential-id
 * enumeration. They are applied to BOTH the data and the count builder below —
 * a resolved id that reaches only one makes `totalCount` disagree with `data`.
 */
const RESOLVED_ID_KEYS = ["flapTypeId", "complementId"] as const;

const MODEL_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
};

const MODEL_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("models", {
  filters: MODEL_FILTERS,
  sorting: MODEL_SORTING,
  search: { columns: ["code", "description"], operator: "ILIKE" },
  defaultSort: { column: "code", order: "asc" },
});

// PARITY (L-010): formula columns are raw text, written byte-for-byte.
const SCALAR_FIELDS = [
  "code",
  "description",
  "sheetLengthFormula",
  "sheetWidthFormula",
  "corrugationScoreLineFormulas",
  "printScoreLineFormulas",
  "lowerFlapFormula",
  "upperFlapFormula",
  "externalLengthDeltaFormula",
  "externalWidthDeltaFormula",
  "externalHeightDeltaFormula",
  "boxSurfaceFormula",
  "imageFileUuid",
  "flapTypeId",
  "complementId",
] as const;

export class ModelDAO {
  private tableName = "models";
  private queryConfig = MODEL_QUERY_CONFIG;

  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(
          `CASE WHEN ft.id IS NOT NULL THEN to_jsonb(ft) END as "flapType"`,
        ),
        knex.raw(
          `CASE WHEN comp.id IS NOT NULL THEN to_jsonb(comp) END as "complement"`,
        ),
      )
      .leftJoin("flap_types as ft", `${this.tableName}.flapTypeId`, "ft.id")
      .leftJoin(
        "complements as comp",
        `${this.tableName}.complementId`,
        "comp.id",
      );
  }

  private buildWriteData(item: Partial<IModel>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const key of SCALAR_FIELDS) {
      if (item[key] !== undefined) data[key] = item[key];
    }
    if (item.textsOnImage !== undefined) {
      // jsonb column: stringify explicitly, or node-postgres renders a JS
      // array as a Postgres array literal and the write fails.
      data.textsOnImage = JSON.stringify(item.textsOnImage ?? []);
    }
    return data;
  }

  async create(item: IModel): Promise<IModel> {
    const knex = db("erp");
    const insertData = {
      uuid: item.uuid,
      companyId: item.companyId,
      ...this.buildWriteData(item),
    };
    const [row] = await knex(this.tableName).insert(insertData).returning("*");
    return (await this.getByUuid(row.uuid)) ?? this.mapToInterface(row);
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IModel | null> {
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

  async update(id: number, item: Partial<IModel>): Promise<IModel | null> {
    const knex = db("erp");
    const updateData = this.buildWriteData(item);
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row
      ? ((await this.getByUuid(row.uuid)) ?? this.mapToInterface(row))
      : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  /** D-8 delete pre-check: how many parts reference the model (max 10 codes). */
  async countPartsReferencing(
    id: number,
  ): Promise<{ count: number; codes: string[] }> {
    const knex = db("erp");
    const [totalResult, rows] = await Promise.all([
      knex("parts").where("modelId", id).count("* as count").first(),
      knex("parts")
        .where("modelId", id)
        .orderBy("id", "asc")
        .limit(10)
        .select("code"),
    ]);
    return {
      count: parseInt(totalResult?.count as string) || 0,
      codes: rows.map((row: { code: string | null }) => row.code ?? ""),
    };
  }

  async getAllWithFilters(
    req: Request,
    scopedCompanyUuid?: string,
  ): Promise<IDataPaginator<IModel>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // SECURITY (L-009): the caller's company scope arrives as an explicit
    // argument from the controller. Express 5 discards writes to req.query,
    // so the enforceCompanyFilter() query-mutation pattern silently stopped
    // scoping lists — never rely on filters.companyId alone here.
    const companyUuid =
      scopedCompanyUuid ??
      (parsedQuery.filters.companyId as string | undefined);
    delete parsedQuery.filters.companyId;

    // uuid filters resolve to numeric ids before buildQuery; a non-existent
    // uuid pins the filter to the impossible id -1 (part.dao.ts pattern).
    // L-007: a malformed uuid is a 400 naming the param, not a DB round trip
    // that surfaces as a generic "Invalid data type provided."
    const flapTypeUuid = assertUuidParam(
      "flapTypeUuid",
      parsedQuery.filters.flapTypeUuid,
    );
    delete parsedQuery.filters.flapTypeUuid;
    if (flapTypeUuid) {
      const flapType = await knex("flap_types")
        .where("uuid", flapTypeUuid)
        .select("id")
        .first();
      parsedQuery.filters.flapTypeId = String(flapType?.id ?? -1);
    }

    const complementUuid = assertUuidParam(
      "complementUuid",
      parsedQuery.filters.complementUuid,
    );
    delete parsedQuery.filters.complementUuid;
    if (complementUuid) {
      const complement = await knex("complements")
        .where("uuid", complementUuid)
        .select("id")
        .first();
      parsedQuery.filters.complementId = String(complement?.id ?? -1);
    }

    // Applied to both builders (see RESOLVED_ID_KEYS).
    const resolvedIds: Array<[string, number]> = [];
    for (const key of RESOLVED_ID_KEYS) {
      const raw = parsedQuery.filters[key];
      if (raw === undefined) continue;
      delete parsedQuery.filters[key];
      resolvedIds.push([key, parseInt(String(raw), 10)]);
    }
    const applyResolvedIds = (q: any) => {
      for (const [key, value] of resolvedIds) {
        q.where(`${this.tableName}.${key}`, value);
      }
      return q;
    };

    const dataQuery = this.selectWithJoins(knex);
    applyResolvedIds(dataQuery);
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    applyResolvedIds(countQuery);
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
  private mapToInterface(record: any): IModel {
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      sheetLengthFormula: record.sheetLengthFormula,
      sheetWidthFormula: record.sheetWidthFormula,
      corrugationScoreLineFormulas: record.corrugationScoreLineFormulas,
      printScoreLineFormulas: record.printScoreLineFormulas,
      lowerFlapFormula: record.lowerFlapFormula,
      upperFlapFormula: record.upperFlapFormula,
      externalLengthDeltaFormula: record.externalLengthDeltaFormula,
      externalWidthDeltaFormula: record.externalWidthDeltaFormula,
      externalHeightDeltaFormula: record.externalHeightDeltaFormula,
      boxSurfaceFormula: record.boxSurfaceFormula,
      imageFileUuid: record.imageFileUuid,
      textsOnImage: record.textsOnImage ?? [],
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      flapTypeUuid: record.flapType?.uuid ?? null,
      complementUuid: record.complement?.uuid ?? null,
      flapType: record.flapType
        ? {
            uuid: record.flapType.uuid,
            code: record.flapType.code,
            description: record.flapType.description,
          }
        : null,
      complement: record.complement
        ? {
            uuid: record.complement.uuid,
            code: record.complement.code,
            description: record.complement.description,
          }
        : null,
    };
  }
}
