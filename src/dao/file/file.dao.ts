import { Request } from "express";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IFile } from "../../interfaces/file/file.interfaces";
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

const FILE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  originalName: { column: "originalName", operator: "ILIKE" },
  contentType: { column: "contentType", operator: "ILIKE" },
};

const FILE_SORTING: SortConfigs = {
  originalName: { column: "originalName" },
  sizeBytes: { column: "sizeBytes" },
  createdAt: { column: "createdAt" },
};

const FILE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("files", {
  filters: FILE_FILTERS,
  sorting: FILE_SORTING,
  search: { columns: ["originalName", "description"], operator: "ILIKE" },
  defaultSort: { column: "createdAt", order: "desc" },
});

export class FileDAO {
  /**
   * `files` is a FANNED-OUT table (G-2 / AC-2): it exists in `core` (company
   * assets — logos), `erp` (product blueprints, sketches, technical sheets) and
   * `countdown`. `ownership.ts` names `core` its primary owner, so `ownerOf`
   * returns `undefined` and the registry's wrong-database guard cannot arbitrate
   * here — nothing will flag a wrong choice.
   *
   * Every `db("erp")` below is therefore a PLACEHOLDER, correct only while all
   * four keys resolve to one physical database (state S1). This DAO serves both
   * planes from one table today, so T6 must split it **by call site** before the
   * `files` rows are partitioned — company-logo paths to `db("core")`, product
   * asset paths to `db("erp")` — or logos will be looked for in the wrong
   * database. Do not read the uniform `db("erp")` as a decision; it is a
   * deferral (see plan R10).
   */
  private tableName = "files";
  private queryConfig = FILE_QUERY_CONFIG;

  async create(item: IFile): Promise<IFile> {
    const knex = db("erp");
    const [row] = await knex(this.tableName).insert(item).returning("*");
    return row as IFile;
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IFile | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid, "companyId");
    const row = await query.select(`${this.tableName}.*`).first();
    return (row as IFile) ?? null;
  }

  async update(id: number, item: Partial<IFile>): Promise<IFile | null> {
    const knex = db("erp");
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update({ ...item, updatedAt: knex.fn.now() })
      .returning("*");
    return (row as IFile) ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IFile>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

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

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows as IFile[],
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async resolveCompanyId(companyUuid: string): Promise<number | null> {
    return getIdByUuid(companyUuid, "companies");
  }

  async resolveUserId(userUuid: string): Promise<number | null> {
    return getIdByUuid(userUuid, "users");
  }
}
