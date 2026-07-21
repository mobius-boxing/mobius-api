import { Request } from "express";
import { toNumberOut } from "../../utils/numbers";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import { IPalletization } from "../../interfaces/palletization/palletization.interfaces";
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

const PALLETIZATION_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
  name: { column: "name", operator: "ILIKE" },
  palletTypeId: {
    column: "palletTypeId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
};

const PALLETIZATION_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  stackingType: { column: "stackingType" },
  createdAt: { column: "createdAt" },
};

const PALLETIZATION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "palletizations",
  {
    filters: PALLETIZATION_FILTERS,
    sorting: PALLETIZATION_SORTING,
    search: { columns: ["code", "name", "description"], operator: "ILIKE" },
    defaultSort: { column: "code", order: "asc" },
  },
);

const SCALAR_FIELDS = [
  "code",
  "name",
  "description",
  "boxesPerPackage",
  "packagesPerLevel",
  "levelsPerPallet",
  "additionalPackages",
  "sheetsPerPallet",
  "maxPalletHeight",
  "surface",
  "stackingType",
  "observations",
  "technicalFileUuid",
  "imageFileUuid",
  "palletTypeId",
] as const;

export class PalletizationDAO {
  private tableName = "palletizations";
  private queryConfig = PALLETIZATION_QUERY_CONFIG;

  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`CASE WHEN pt.id IS NOT NULL THEN to_jsonb(pt) END as "palletType"`),
      )
      .leftJoin("pallet_types as pt", `${this.tableName}.palletTypeId`, "pt.id");
  }

  async create(item: IPalletization): Promise<IPalletization> {
    const knex = KnexManager.getConnection();
    const insertData: any = { uuid: item.uuid, companyId: item.companyId };
    for (const key of SCALAR_FIELDS) {
      if (item[key] !== undefined) insertData[key] = item[key];
    }
    const [row] = await knex(this.tableName).insert(insertData).returning("*");
    return (await this.getByUuid(row.uuid)) ?? this.mapToInterface(row);
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IPalletization | null> {
    const knex = KnexManager.getConnection();
    const query = this.selectWithJoins(knex).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(id: number, item: Partial<IPalletization>): Promise<IPalletization | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};
    for (const key of SCALAR_FIELDS) {
      if (item[key] !== undefined) updateData[key] = item[key];
    }
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? ((await this.getByUuid(row.uuid)) ?? this.mapToInterface(row)) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPalletization>> {
    const knex = KnexManager.getConnection();
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
  private mapToInterface(record: any): IPalletization {
    const num = toNumberOut;
    const int = (v: any) => (v != null ? parseInt(v, 10) : 0);
    const boxesPerPackage = int(record.boxesPerPackage);
    const packagesPerLevel = int(record.packagesPerLevel);
    const levelsPerPallet = int(record.levelsPerPallet);
    const additionalPackages = int(record.additionalPackages);
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      name: record.name,
      description: record.description,
      boxesPerPackage,
      packagesPerLevel,
      levelsPerPallet,
      additionalPackages,
      sheetsPerPallet: int(record.sheetsPerPallet),
      maxPalletHeight: num(record.maxPalletHeight),
      surface: num(record.surface),
      stackingType: record.stackingType,
      observations: record.observations,
      technicalFileUuid: record.technicalFileUuid,
      imageFileUuid: record.imageFileUuid,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      // Parity with Procusto's transient CajasPorPallet.
      boxesPerPallet:
        boxesPerPackage * (packagesPerLevel * levelsPerPallet + additionalPackages),
      palletType: record.palletType
        ? {
            uuid: record.palletType.uuid,
            code: record.palletType.code,
            description: record.palletType.description,
          }
        : null,
    };
  }
}
