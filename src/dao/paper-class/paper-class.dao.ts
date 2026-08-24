import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperClass } from "../../interfaces/paper-class/paper-class.interfaces";
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
import { Request } from "express";

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
const PAPER_CLASS_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  name: {
    column: "name",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const PAPER_CLASS_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const PAPER_CLASS_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "paper_classes",
  {
    filters: PAPER_CLASS_FILTERS,
    sorting: PAPER_CLASS_SORTING,
    search: {
      columns: ["code", "name"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "code",
      order: "asc",
    },
  },
);

export class PaperClassDAO implements IBaseDAO<IPaperClass> {
  private tableName = "paper_classes";
  private queryConfig = PAPER_CLASS_QUERY_CONFIG;

  async create(item: IPaperClass): Promise<IPaperClass> {
    const knex = db("erp");
    const paperClass = await knex.transaction(async (trx) => {
      const [created] = await trx(this.tableName)
        .insert({
          uuid: item.uuid,
          companyId: item.companyId,
          code: item.code,
          name: item.name,
        })
        .returning("*");
      await this.replacePapers(trx, created.id, item.papers ?? []);
      return created;
    });

    return this.mapToInterface(
      paperClass,
      await this.loadPaperUuids(paperClass.id),
    );
  }

  /**
   * Replace the class's paper links (paper_class_papers). `papers` is the API
   * shape: an array of paper-supply UUIDs; unknown uuids are skipped.
   */
  private async replacePapers(
    trx: any,
    paperClassId: number,
    paperUuids: string[],
  ): Promise<void> {
    await trx("paper_class_papers")
      .where("paperClassId", paperClassId)
      .delete();
    // Malformed uuids would make Postgres throw on the uuid-typed column
    // (the old jsonb storage accepted anything) — drop them up front.
    const validUuids = paperUuids.filter((u) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        u ?? "",
      ),
    );
    if (!validUuids.length) return;
    const supplies = await trx("paper_supplies")
      .whereIn("uuid", validUuids)
      .select("id");
    if (supplies.length) {
      await trx("paper_class_papers").insert(
        supplies.map((s: any) => ({ paperClassId, paperSupplyId: s.id })),
      );
    }
  }

  private async loadPaperUuids(paperClassId: number): Promise<string[]> {
    const knex = db("erp");
    const rows = await knex("paper_class_papers")
      .join(
        "paper_supplies",
        "paper_class_papers.paperSupplyId",
        "paper_supplies.id",
      )
      .where("paper_class_papers.paperClassId", paperClassId)
      .select("paper_supplies.uuid");
    return rows.map((r: any) => r.uuid);
  }

  async getById(id: number): Promise<IPaperClass | null> {
    const knex = db("erp");
    const paperClass = await knex(this.tableName).where("id", id).first();

    return paperClass
      ? this.mapToInterface(
          paperClass,
          await this.loadPaperUuids(paperClass.id),
        )
      : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IPaperClass | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const paperClass = await query.select(`${this.tableName}.*`).first();

    return paperClass
      ? this.mapToInterface(
          paperClass,
          await this.loadPaperUuids(paperClass.id),
        )
      : null;
  }

  async update(
    id: number,
    item: Partial<IPaperClass>,
  ): Promise<IPaperClass | null> {
    const knex = db("erp");
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;

    updateData.updatedAt = knex.fn.now();

    const paperClass = await knex.transaction(async (trx) => {
      const [updated] = await trx(this.tableName)
        .where("id", id)
        .update(updateData)
        .returning("*");
      if (updated && item.papers !== undefined) {
        await this.replacePapers(trx, id, item.papers);
      }
      return updated;
    });

    return paperClass
      ? this.mapToInterface(paperClass, await this.loadPaperUuids(id))
      : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * @deprecated Use getAllWithFilters for advanced querying.
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IPaperClass>> {
    const knex = db("erp");
    const offset = (page - 1) * limit;

    const [paperClasses, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("code", "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;
    const papersByClass = await this.loadPaperUuidsForMany(
      paperClasses.map((pc: any) => pc.id),
    );

    return {
      success: true,
      data: paperClasses.map((paperClass) =>
        this.mapToInterface(paperClass, papersByClass.get(paperClass.id) ?? []),
      ),
      page,
      limit,
      count: paperClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /** Batch papers lookup for list endpoints (avoids per-row N+1). */
  private async loadPaperUuidsForMany(
    paperClassIds: number[],
  ): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    if (!paperClassIds.length) return result;
    const knex = db("erp");
    const rows = await knex("paper_class_papers")
      .join(
        "paper_supplies",
        "paper_class_papers.paperSupplyId",
        "paper_supplies.id",
      )
      .whereIn("paper_class_papers.paperClassId", paperClassIds)
      .select("paper_class_papers.paperClassId", "paper_supplies.uuid");
    for (const row of rows as any[]) {
      const list = result.get(row.paperClassId) ?? [];
      list.push(row.uuid);
      result.set(row.paperClassId, list);
    }
    return result;
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPaperClass>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

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

    const [paperClasses, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;
    const papersByClass = await this.loadPaperUuidsForMany(
      paperClasses.map((pc: any) => pc.id),
    );

    return {
      success: true,
      data: paperClasses.map((paperClass) =>
        this.mapToInterface(paperClass, papersByClass.get(paperClass.id) ?? []),
      ),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: paperClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /** `papers` keeps the historical API shape (paper-supply uuid array); the
   *  storage is the paper_class_papers join since 20260720000005. */
  private mapToInterface(record: any, papers: string[] = []): IPaperClass {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      name: record.name,
      papers,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
