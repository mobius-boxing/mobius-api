import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  INodeFilesField,
  INodeFilesWorkflow,
  INodeFilesWorkflowRow,
  NodeFilesWorkflowStatus,
} from "../../interfaces/node-files/node-files.interfaces";
import {
  buildCountQuery,
  buildQuery,
  createQueryConfig,
  parseQueryParams,
  type FilterConfigs,
  type ParsedQuery,
  type QueryBuilderConfig,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { toCountOut } from "../../utils/numbers";

const TABLE = "nf_workflows";

/** Filter/sort configs live OUTSIDE the class (house rule). */
const WORKFLOW_FILTERS: FilterConfigs = {
  status: { column: "status", operator: "=" },
};

const WORKFLOW_SORTING: SortConfigs = {
  name: { column: "name" },
  status: { column: "status" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const WORKFLOW_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(TABLE, {
  filters: WORKFLOW_FILTERS,
  sorting: WORKFLOW_SORTING,
  search: { columns: ["name", "description"], operator: "ILIKE" },
  defaultSort: { column: "createdAt", order: "desc" },
});

export interface INodeFilesWorkflowWriteInput {
  uuid: string;
  companyId: number;
  name: string;
  description: string | null;
  requireReview: boolean;
  status: NodeFilesWorkflowStatus;
  fields: INodeFilesField[];
  createdByUserId: number | null;
  createdByName: string | null;
}

export interface INodeFilesWorkflowPatch {
  name?: string;
  description?: string | null;
  requireReview?: boolean;
  status?: NodeFilesWorkflowStatus;
  fields?: INodeFilesField[];
}

/**
 * Workflows, always scoped to one company (L-009): every method takes a
 * `companyId` and filters `"companyId"` with it DIRECTLY — no method here joins
 * `companies` or `users`, which live behind another database key and would make
 * the module unsplittable. `createdByName` is denormalized for the same reason.
 *
 * A workflow from another tenant resolves to nothing, which the controller
 * turns into a 404: existence never leaks across companies, and never as a 403.
 */
export class NfWorkflowDAO {
  private scoped(companyId: number) {
    return db("nodefiles")(TABLE).where(`${TABLE}.companyId`, companyId);
  }

  async create(
    input: INodeFilesWorkflowWriteInput,
  ): Promise<INodeFilesWorkflow> {
    const [row] = await db("nodefiles")(TABLE)
      .insert({
        uuid: input.uuid,
        companyId: input.companyId,
        name: input.name,
        description: input.description,
        requireReview: input.requireReview,
        status: input.status,
        fields: JSON.stringify(input.fields),
        createdByUserId: input.createdByUserId,
        createdByName: input.createdByName,
      })
      .returning("*");
    return this.mapToInterface(row as INodeFilesWorkflowRow);
  }

  async getAllWithFilters(
    req: Request,
    companyId: number,
  ): Promise<IDataPaginator<INodeFilesWorkflow>> {
    const knex = db("nodefiles");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    // superAdmins pin the tenant with ?companyId=<uuid>; it is already resolved
    // to `companyId` here and must never reach the filter builder as a column.
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(TABLE)
      .select(`${TABLE}.*`)
      .where(`${TABLE}.companyId`, companyId);
    buildQuery(dataQuery, parsedQuery, WORKFLOW_QUERY_CONFIG);

    const countQuery = knex(TABLE).where(`${TABLE}.companyId`, companyId);
    buildCountQuery(countQuery, parsedQuery, WORKFLOW_QUERY_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = toCountOut(totalResult?.count);

    return {
      success: true,
      data: (rows as INodeFilesWorkflowRow[]).map((row) =>
        this.mapToInterface(row),
      ),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  async getByUuid(
    uuid: string,
    companyId: number,
  ): Promise<INodeFilesWorkflow | null> {
    const row = await this.scoped(companyId)
      .where(`${TABLE}.uuid`, uuid)
      .first();
    return row ? this.mapToInterface(row as INodeFilesWorkflowRow) : null;
  }

  /**
   * uuid → numeric id, company-scoped. Resolved explicitly rather than read off
   * a mapped entity, whose numeric id the mapper strips (L-005).
   */
  async getIdByUuid(uuid: string, companyId: number): Promise<number | null> {
    const row = await this.scoped(companyId)
      .where(`${TABLE}.uuid`, uuid)
      .select(`${TABLE}.id`)
      .first();
    return row ? (row.id as number) : null;
  }

  /** The row the worker needs: declared fields plus the review policy. */
  async getById(
    id: number,
    companyId: number,
  ): Promise<INodeFilesWorkflowRow | null> {
    const row = await this.scoped(companyId).where(`${TABLE}.id`, id).first();
    return (row as INodeFilesWorkflowRow) ?? null;
  }

  async update(
    id: number,
    companyId: number,
    patch: INodeFilesWorkflowPatch,
  ): Promise<INodeFilesWorkflow | null> {
    const knex = db("nodefiles");
    const changes: Record<string, unknown> = { updatedAt: knex.fn.now() };
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.description !== undefined)
      changes.description = patch.description;
    if (patch.requireReview !== undefined) {
      changes.requireReview = patch.requireReview;
    }
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.fields !== undefined)
      changes.fields = JSON.stringify(patch.fields);

    const [row] = await this.scoped(companyId)
      .where(`${TABLE}.id`, id)
      .update(changes)
      .returning("*");
    return row ? this.mapToInterface(row as INodeFilesWorkflowRow) : null;
  }

  async delete(id: number, companyId: number): Promise<boolean> {
    const deleted = await this.scoped(companyId)
      .where(`${TABLE}.id`, id)
      .delete();
    return deleted > 0;
  }

  /** UUID-only: the numeric id and companyId never leave the API. */
  private mapToInterface(row: INodeFilesWorkflowRow): INodeFilesWorkflow {
    return {
      uuid: row.uuid,
      name: row.name,
      description: row.description,
      requireReview: row.requireReview,
      status: row.status,
      // jsonb comes back parsed; the `?? []` covers a row written before the
      // column had a default.
      fields: (row.fields as INodeFilesField[]) ?? [],
      createdByName: row.createdByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
