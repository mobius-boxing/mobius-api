import { Request } from "express";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { db, withTenant } from "../../database/registry";
import { TenantUnavailableError } from "../../database/tenant-pools";
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
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";

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
   * assets — logos) and in `tenant` (product blueprints, sketches, technical
   * sheets, node-files attachments). `ownership.ts` names `core` its primary
   * owner, so `ownerOf` returns `undefined` and the registry's wrong-database
   * guard cannot arbitrate here — nothing will flag a wrong choice.
   *
   * Every `db("tenant")` below is therefore a PLACEHOLDER, correct only while
   * both planes resolve to one physical database. This DAO serves both planes
   * from one table today, so it must be split **by call site** before the
   * `files` rows are partitioned — company-logo paths to `db("core")`, product
   * asset paths to `db("tenant")` — or logos will be looked for in the wrong
   * database. Do not read the uniform `db("tenant")` as a decision; it is a
   * deferral (see plan R10).
   */
  private tableName = "files";
  private queryConfig = FILE_QUERY_CONFIG;

  async create(item: IFile): Promise<IFile> {
    const knex = db("tenant");
    const [row] = await knex(this.tableName).insert(item).returning("*");
    return row as IFile;
  }

  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<IFile | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId, "companyId");
    const row = await query.select(`${this.tableName}.*`).first();
    return (row as IFile) ?? null;
  }

  /** Company logos, which tenant:move leaves in the central database. */
  async getCentralByUuid(uuid: string, companyId: number): Promise<IFile | null> {
    const knex = db("core");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId, "companyId");
    const row = await query.select(`${this.tableName}.*`).first();
    return (row as IFile) ?? null;
  }

  /**
   * A company logo: the central row first (tenant:move leaves logos there),
   * then the company's own database, where a logo uploaded after its move
   * lands. A company whose database is unavailable has no logo to serve.
   */
  async getLogoFile(uuid: string, companyId: number): Promise<IFile | null> {
    const central = await this.getCentralByUuid(uuid, companyId);
    if (central) return central;
    try {
      return await withTenant(companyId, () => this.getByUuid(uuid, companyId));
    } catch (error) {
      if (error instanceof TenantUnavailableError) return null;
      throw error;
    }
  }

  async update(id: number, item: Partial<IFile>): Promise<IFile | null> {
    const knex = db("tenant");
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update({ ...item, updatedAt: knex.fn.now() })
      .returning("*");
    return (row as IFile) ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("tenant");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IFile>> {
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    applyCompanyScope(dataQuery, this.tableName, companyId);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    applyCompanyScope(countQuery, this.tableName, companyId);
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
