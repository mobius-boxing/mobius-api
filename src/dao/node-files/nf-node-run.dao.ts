import { db } from "../../database/registry";
import {
  INodeFilesNodeRun,
  INodeFilesNodeRunRow,
  NodeFilesNodeRunStatus,
} from "../../interfaces/node-files/node-files.interfaces";

const TABLE = "nf_node_runs";

export interface INodeFilesNodeRunWriteInput {
  uuid: string;
  runId: number;
  companyId: number;
  nodeId: string;
  nodeType: string;
  status: NodeFilesNodeRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string | null;
  error: string | null;
  durationMs: number | null;
  attempt: number;
}

/**
 * One row per node of a run — written ONCE, when the node is over.
 *
 * Every method here is a single short statement, because that is the whole
 * point of this DAO: the executor calls `create` *after* the node has finished
 * its HTTP call or its email, holding no connection while the node runs. A
 * "mark started / mark finished" pair would double the statements and hold
 * nothing useful, since a row that says `running` after a crash is a lie
 * nobody sweeps.
 *
 * Company-scoped like every DAO here (L-009): `companyId` is denormalized onto
 * the row so a node run can be read without joining `nf_runs`.
 */
export class NfNodeRunDAO {
  private scoped(companyId: number) {
    return db("nodefiles")(TABLE).where(`${TABLE}.companyId`, companyId);
  }

  async create(input: INodeFilesNodeRunWriteInput): Promise<void> {
    await db("nodefiles")(TABLE).insert({
      uuid: input.uuid,
      runId: input.runId,
      companyId: input.companyId,
      nodeId: input.nodeId,
      nodeType: input.nodeType,
      status: input.status,
      input: input.input === null ? null : JSON.stringify(input.input),
      output: input.output === null ? null : JSON.stringify(input.output),
      logs: input.logs,
      error: input.error,
      durationMs: input.durationMs,
      attempt: input.attempt,
    });
  }

  /** The run detail's timeline, in execution order (the index carries it). */
  async listByRunId(
    runId: number,
    companyId: number,
  ): Promise<INodeFilesNodeRun[]> {
    const rows = await this.scoped(companyId)
      .where(`${TABLE}.runId`, runId)
      .orderBy(`${TABLE}.id`, "asc");
    return (rows as INodeFilesNodeRunRow[]).map((row) =>
      NfNodeRunDAO.mapToInterface(row),
    );
  }

  /**
   * Clear a run's node history. Called by "retry run", which re-runs the graph
   * from the start: keeping the previous attempt's rows next to the new ones
   * would make the timeline read as one run that executed every node twice.
   * The retried rows carry `attempt`, so the count is not lost.
   */
  async deleteByRunId(runId: number, companyId: number): Promise<number> {
    return this.scoped(companyId).where(`${TABLE}.runId`, runId).delete();
  }

  /** How many attempts a node has already had in this run. */
  async maxAttempt(runId: number, companyId: number): Promise<number> {
    const row = await this.scoped(companyId)
      .where(`${TABLE}.runId`, runId)
      .max("attempt as attempt")
      .first();
    const value = (row as { attempt: number | string | null } | undefined)
      ?.attempt;
    return value === null || value === undefined ? 0 : Number(value);
  }

  /** UUID-only: numeric ids never leave the API. */
  static mapToInterface(row: INodeFilesNodeRunRow): INodeFilesNodeRun {
    return {
      uuid: row.uuid,
      nodeId: row.nodeId,
      nodeType: row.nodeType,
      status: row.status,
      input: row.input,
      output: row.output,
      logs: row.logs,
      error: row.error,
      durationMs: row.durationMs,
      attempt: row.attempt,
      createdAt: row.createdAt,
    };
  }
}
