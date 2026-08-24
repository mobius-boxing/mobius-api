import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  INodeFilesClaimedRun,
  INodeFilesRun,
  INodeFilesRunRow,
  NodeFilesExtractedValues,
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

const TABLE = "nf_runs";
const WORKFLOWS_TABLE = "nf_workflows";
const DOCUMENTS_TABLE = "nf_documents";

const RUN_FILTERS: FilterConfigs = {
  status: { column: "status", operator: "=" },
};

const RUN_SORTING: SortConfigs = {
  status: { column: "status" },
  createdAt: { column: "createdAt" },
  finishedAt: { column: "finishedAt" },
};

const RUN_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(TABLE, {
  filters: RUN_FILTERS,
  sorting: RUN_SORTING,
  defaultSort: { column: "createdAt", order: "desc" },
});

/** How many rows the stale-lock sweep inspects per tick. */
const STALE_SWEEP_LIMIT = 50;

interface IJoinedRunRow extends INodeFilesRunRow {
  workflowUuid: string;
  workflowName: string;
  documentUuid: string;
  documentName: string;
}

/** The minimum the stale-lock sweep needs to decide, one row at a time. */
export interface INodeFilesLockCandidate {
  id: number;
  lockedAt: Date | null;
}

/**
 * Runs, company-scoped like every DAO here (L-009) — with exactly TWO
 * deliberate exceptions, both used only by the background worker, both marked:
 * `listExtracting` and `claimNext`. The worker serves every tenant, so it
 * cannot be handed one company's id; instead the claimed row carries its own
 * `companyId`, and every follow-up call the worker makes is scoped with THAT.
 *
 * The joins reach `nf_workflows` and `nf_documents` only — the same database
 * key. Nothing here joins `companies` or `users`.
 */
export class NfRunDAO {
  private base() {
    return db("nodefiles")(TABLE)
      .join(WORKFLOWS_TABLE, `${WORKFLOWS_TABLE}.id`, `${TABLE}.workflowId`)
      .join(DOCUMENTS_TABLE, `${DOCUMENTS_TABLE}.id`, `${TABLE}.documentId`)
      .select(
        `${TABLE}.*`,
        `${WORKFLOWS_TABLE}.uuid as workflowUuid`,
        `${WORKFLOWS_TABLE}.name as workflowName`,
        `${DOCUMENTS_TABLE}.uuid as documentUuid`,
        `${DOCUMENTS_TABLE}.originalName as documentName`,
      );
  }

  async getAllWithFilters(
    req: Request,
    companyId: number,
    workflowId: number | undefined,
  ): Promise<IDataPaginator<INodeFilesRun>> {
    const knex = db("nodefiles");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    // Resolved to a numeric id by the caller; never a column of this table.
    delete parsedQuery.filters.workflowUuid;
    delete parsedQuery.filters.companyId;

    const dataQuery = this.base().where(`${TABLE}.companyId`, companyId);
    const countQuery = knex(TABLE).where(`${TABLE}.companyId`, companyId);
    if (workflowId !== undefined) {
      dataQuery.where(`${TABLE}.workflowId`, workflowId);
      countQuery.where(`${TABLE}.workflowId`, workflowId);
    }

    buildQuery(dataQuery, parsedQuery, RUN_QUERY_CONFIG);
    buildCountQuery(countQuery, parsedQuery, RUN_QUERY_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = toCountOut(totalResult?.count);

    return {
      success: true,
      data: (rows as IJoinedRunRow[]).map((row) => this.mapToInterface(row)),
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
  ): Promise<INodeFilesRun | null> {
    const row = await this.base()
      .where(`${TABLE}.companyId`, companyId)
      .where(`${TABLE}.uuid`, uuid)
      .first();
    return row ? this.mapToInterface(row as IJoinedRunRow) : null;
  }

  /** Resolved explicitly — the mapper strips numeric ids (L-005). */
  async getIdByUuid(uuid: string, companyId: number): Promise<number | null> {
    const row = await db("nodefiles")(TABLE)
      .where({ uuid, companyId })
      .select("id")
      .first();
    return row ? (row.id as number) : null;
  }

  async getStatusById(
    id: number,
    companyId: number,
  ): Promise<INodeFilesRunRow | null> {
    const row = await db("nodefiles")(TABLE).where({ id, companyId }).first();
    return (row as INodeFilesRunRow) ?? null;
  }

  /** How many runs block deleting a workflow (the 409 says the number). */
  async countByWorkflow(
    workflowId: number,
    companyId: number,
  ): Promise<number> {
    const result = await db("nodefiles")(TABLE)
      .where({ workflowId, companyId })
      .count("* as count")
      .first();
    return toCountOut(result?.count);
  }

  // ---- worker-only, process-wide (see the class comment) -----------------

  /**
   * The repo's first `FOR UPDATE SKIP LOCKED`.
   *
   * The inner SELECT locks exactly one queued row and skips any row another
   * worker already holds, so two processes never claim the same run and neither
   * waits on the other. The partial index `nf_runs_queued_idx` is what keeps
   * that inner scan to the queued rows only.
   *
   * Raw SQL with bindings, never interpolation. It is one statement, so it is
   * its own transaction: nothing external happens inside it.
   */
  async claimNext(lockedBy: string): Promise<INodeFilesClaimedRun | null> {
    const result = await db("nodefiles").raw(
      `UPDATE nf_runs
          SET status = 'extracting',
              "lockedAt" = now(),
              "lockedBy" = ?,
              "startedAt" = now(),
              "updatedAt" = now()
        WHERE id = (
          SELECT id FROM nf_runs
           WHERE status = 'queued'
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, uuid, "companyId", "workflowId", "documentId"`,
      [lockedBy],
    );
    const rows = (result as { rows: INodeFilesClaimedRun[] }).rows;
    return rows[0] ?? null;
  }

  /**
   * Every run currently held by a worker. Small by construction — a row is only
   * `extracting` while a process is actually working on it — and capped anyway.
   * The staleness decision itself is NOT made here: it lives in `isStaleLock`
   * so it can be tested without a database, and so there is exactly one
   * definition of "stale".
   */
  async listExtracting(): Promise<INodeFilesLockCandidate[]> {
    const rows = await db("nodefiles")(TABLE)
      .where("status", "extracting")
      .select("id", "lockedAt")
      .orderBy("id")
      .limit(STALE_SWEEP_LIMIT);
    return rows as INodeFilesLockCandidate[];
  }

  /** Put abandoned runs back in the queue. Returns how many moved. */
  async requeue(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return db("nodefiles")(TABLE)
      .whereIn("id", ids)
      .where("status", "extracting")
      .update({
        status: "queued",
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        updatedAt: db("nodefiles").fn.now(),
      });
  }

  // ---- result persistence (short, DB-only, after the LLM call) -----------

  async markFinished(
    id: number,
    companyId: number,
    result: {
      status: "pending_review" | "succeeded";
      extracted: NodeFilesExtractedValues;
      tokensIn: number;
      tokensOut: number;
    },
  ): Promise<void> {
    const knex = db("nodefiles");
    await knex(TABLE)
      .where({ id, companyId })
      .update({
        status: result.status,
        extracted: JSON.stringify(result.extracted),
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        error: null,
        lockedAt: null,
        lockedBy: null,
        finishedAt: knex.fn.now(),
        updatedAt: knex.fn.now(),
      });
  }

  async markFailed(
    id: number,
    companyId: number,
    message: string,
  ): Promise<void> {
    const knex = db("nodefiles");
    await knex(TABLE).where({ id, companyId }).update({
      status: "failed",
      error: message,
      lockedAt: null,
      lockedBy: null,
      finishedAt: knex.fn.now(),
      updatedAt: knex.fn.now(),
    });
  }

  async review(
    id: number,
    companyId: number,
    values: NodeFilesExtractedValues,
    reviewedByUserId: number | null,
    reviewedByName: string | null,
  ): Promise<void> {
    const knex = db("nodefiles");
    await knex(TABLE)
      .where({ id, companyId })
      .update({
        status: "succeeded",
        reviewedValues: JSON.stringify(values),
        reviewedByUserId,
        reviewedByName,
        finishedAt: knex.fn.now(),
        updatedAt: knex.fn.now(),
      });
  }

  /** failed → queued. The retry clears the previous error and the lock. */
  async requeueOne(id: number, companyId: number): Promise<void> {
    const knex = db("nodefiles");
    await knex(TABLE).where({ id, companyId }).update({
      status: "queued",
      error: null,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: knex.fn.now(),
    });
  }

  /** UUID-only: numeric ids and the lock bookkeeping never leave the API. */
  private mapToInterface(row: IJoinedRunRow): INodeFilesRun {
    return {
      uuid: row.uuid,
      status: row.status,
      workflowUuid: row.workflowUuid,
      workflowName: row.workflowName,
      documentUuid: row.documentUuid,
      documentName: row.documentName,
      extracted: row.extracted,
      reviewedValues: row.reviewedValues,
      reviewedByName: row.reviewedByName,
      error: row.error,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
