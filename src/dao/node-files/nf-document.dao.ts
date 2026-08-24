import { db } from "../../database/registry";
import {
  INodeFilesDocument,
  INodeFilesDocumentRow,
  INodeFilesRunRow,
} from "../../interfaces/node-files/node-files.interfaces";
import { toNumberOut } from "../../utils/numbers";

const TABLE = "nf_documents";
const RUNS_TABLE = "nf_runs";

export interface INodeFilesDocumentWriteInput {
  uuid: string;
  workflowId: number;
  companyId: number;
  storageKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  uploadedByUserId: number | null;
  uploadedByName: string | null;
}

/**
 * Uploaded documents. node-files owns this metadata instead of borrowing the
 * `files` table: `files` belongs to the `core` key and is fanned out per
 * database, and `FileDAO` hard-codes `db("erp")` — depending on either would
 * drag that debt across a key boundary (brief D-2). Only the stateless storage
 * *driver* is shared.
 *
 * Company-scoped like every DAO here (L-009), and never joins across a key.
 */
export class NfDocumentDAO {
  private scoped(companyId: number) {
    return db("nodefiles")(TABLE).where(`${TABLE}.companyId`, companyId);
  }

  /**
   * The document and the run it queues are written in ONE transaction: a
   * document with no run would sit there forever, and a run pointing at a
   * document that was never committed would fail on its first claim.
   *
   * The transaction lives in the DAO because the service may not hold a
   * connection (architecture rule: only `src/dao` and `src/database` import the
   * registry). It touches two tables of the SAME key, so it is DB-only and
   * short — no HTTP, no S3, no LLM call inside it. The bytes are already in
   * storage before this is called.
   */
  async createWithQueuedRun(
    input: INodeFilesDocumentWriteInput,
    runUuid: string,
  ): Promise<{ document: INodeFilesDocumentRow; run: INodeFilesRunRow }> {
    return db("nodefiles").transaction(async (trx) => {
      const [document] = await trx(TABLE)
        .insert({
          uuid: input.uuid,
          workflowId: input.workflowId,
          companyId: input.companyId,
          storageKey: input.storageKey,
          originalName: input.originalName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          uploadedByUserId: input.uploadedByUserId,
          uploadedByName: input.uploadedByName,
        })
        .returning("*");

      const [run] = await trx(RUNS_TABLE)
        .insert({
          uuid: runUuid,
          workflowId: input.workflowId,
          documentId: (document as INodeFilesDocumentRow).id,
          companyId: input.companyId,
          status: "queued",
        })
        .returning("*");

      return {
        document: document as INodeFilesDocumentRow,
        run: run as INodeFilesRunRow,
      };
    });
  }

  /**
   * Every stored object belonging to a workflow.
   *
   * L-006: `nf_documents.workflowId` CASCADEs, and a DB cascade cannot delete
   * bytes out of S3 or off the disk. The service reads these keys BEFORE it
   * deletes the workflow and removes the objects afterwards — otherwise every
   * deleted workflow would leave its uploads behind forever.
   */
  async storageKeysByWorkflow(
    workflowId: number,
    companyId: number,
  ): Promise<string[]> {
    const rows = await this.scoped(companyId)
      .where(`${TABLE}.workflowId`, workflowId)
      .select("storageKey");
    return (rows as Array<{ storageKey: string }>).map((row) => row.storageKey);
  }

  /** The row the worker needs to fetch bytes back out of storage. */
  async getById(
    id: number,
    companyId: number,
  ): Promise<INodeFilesDocumentRow | null> {
    const row = await this.scoped(companyId).where(`${TABLE}.id`, id).first();
    return (row as INodeFilesDocumentRow) ?? null;
  }

  /** UUID-only: numeric ids and the storage key never leave the API. */
  static mapToInterface(row: INodeFilesDocumentRow): INodeFilesDocument {
    return {
      uuid: row.uuid,
      originalName: row.originalName,
      contentType: row.contentType,
      // bigint comes back from pg as a string.
      sizeBytes: toNumberOut(row.sizeBytes),
      checksum: row.checksum,
      uploadedByName: row.uploadedByName,
      createdAt: row.createdAt,
    };
  }
}
