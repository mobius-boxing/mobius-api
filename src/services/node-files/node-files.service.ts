import { Request } from "express";
import * as path from "path";
import { IDataPaginator } from "../../database/d.types";
import { NfDocumentDAO } from "../../dao/node-files/nf-document.dao";
import { NfRunDAO } from "../../dao/node-files/nf-run.dao";
import { NfWorkflowDAO } from "../../dao/node-files/nf-workflow.dao";
import {
  NodeFilesRunReviewInputDTO,
  NodeFilesWorkflowCreateInputDTO,
  NodeFilesWorkflowUpdateInputDTO,
} from "../../dto/input/node-files";
import {
  INodeFilesDocument,
  INodeFilesField,
  INodeFilesRun,
  INodeFilesWorkflow,
} from "../../interfaces/node-files/node-files.interfaces";
import { FileStorageService } from "../file-storage.service";
import { isAcceptedMimeType } from "./extraction/claude-extraction.provider";
import {
  coerceReviewValues,
  missingRequiredLabels,
} from "./extraction/field-schema";

/**
 * 20 MB, comfortably under the API's 32 MB per-request cap once base64 adds its
 * third. A document over the limit is REFUSED, never truncated: a silently
 * shortened document produces confidently wrong extractions.
 */
export const NF_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Carries the HTTP status the controller should answer with. */
export class NodeFilesServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NodeFilesServiceError";
  }
}

const notFound = (message: string): NodeFilesServiceError =>
  new NodeFilesServiceError(404, message);
const badRequest = (message: string): NodeFilesServiceError =>
  new NodeFilesServiceError(400, message);
const conflict = (message: string): NodeFilesServiceError =>
  new NodeFilesServiceError(409, message);

/** Everything the service needs about the caller, resolved ONCE per request. */
export interface INodeFilesContext {
  companyId: number;
  /** users.id of the caller — stamped on uploads and reviews. */
  userId: number | null;
  /** Denormalized: no DAO here may join `users` (another database key). */
  userName: string | null;
}

export interface INodeFilesUploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export class NodeFilesService {
  private _workflowDAO = new NfWorkflowDAO();
  private _documentDAO = new NfDocumentDAO();
  private _runDAO = new NfRunDAO();
  private _storage = new FileStorageService();

  // ---- workflows --------------------------------------------------------

  async listWorkflows(
    req: Request,
    ctx: INodeFilesContext,
  ): Promise<IDataPaginator<INodeFilesWorkflow>> {
    return this._workflowDAO.getAllWithFilters(req, ctx.companyId);
  }

  async getWorkflow(
    uuid: string,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesWorkflow> {
    const workflow = await this._workflowDAO.getByUuid(uuid, ctx.companyId);
    if (!workflow) throw notFound("Flujo no encontrado");
    return workflow;
  }

  async createWorkflow(
    uuid: string,
    input: NodeFilesWorkflowCreateInputDTO,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesWorkflow> {
    return this._workflowDAO.create({
      uuid,
      companyId: ctx.companyId,
      name: input.name,
      description: input.description,
      requireReview: input.requireReview,
      status: input.status,
      fields: input.fields,
      createdByUserId: ctx.userId,
      createdByName: ctx.userName,
    });
  }

  async updateWorkflow(
    uuid: string,
    input: NodeFilesWorkflowUpdateInputDTO,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesWorkflow> {
    // Resolved explicitly: the mapper strips numeric ids, so a guard on the
    // mapped entity's `id` would 404 every real workflow (L-005).
    const id = await this._workflowDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Flujo no encontrado");

    const updated = await this._workflowDAO.update(id, ctx.companyId, input);
    if (!updated) throw notFound("Flujo no encontrado");
    return updated;
  }

  /**
   * Deleting a workflow, with both halves of L-006 handled explicitly:
   *
   *  - `nf_runs.workflowId` RESTRICTs, so run history survives. Rather than let
   *    Postgres answer with a foreign-key 500, the count is read first and the
   *    caller gets a 409 that says how many runs are in the way.
   *  - `nf_documents.workflowId` CASCADEs, and a cascade deletes rows, not
   *    bytes. The storage keys are collected BEFORE the delete and the objects
   *    removed after it, or every deleted workflow would leak its uploads.
   */
  async deleteWorkflow(
    uuid: string,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesWorkflow> {
    const workflow = await this._workflowDAO.getByUuid(uuid, ctx.companyId);
    if (!workflow) throw notFound("Flujo no encontrado");
    const id = await this._workflowDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Flujo no encontrado");

    const runs = await this._runDAO.countByWorkflow(id, ctx.companyId);
    if (runs > 0) {
      throw conflict(
        `No se puede eliminar: el flujo tiene ${runs} ${
          runs === 1 ? "ejecución" : "ejecuciones"
        } en su historial`,
      );
    }

    const storageKeys = await this._documentDAO.storageKeysByWorkflow(
      id,
      ctx.companyId,
    );
    const deleted = await this._workflowDAO.delete(id, ctx.companyId);
    if (!deleted) throw notFound("Flujo no encontrado");

    // Best effort, and after the row is gone: a storage hiccup must not leave
    // the caller with a 500 on an operation that already succeeded.
    for (const key of storageKeys) {
      await this._storage.deleteObject(key).catch((err: unknown) => {
        console.error(
          `[node-files] failed to delete stored object ${key}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }
    return workflow;
  }

  // ---- documents --------------------------------------------------------

  /**
   * Upload → one document + one queued run, atomically.
   *
   * The bytes go to storage BEFORE the transaction opens: object storage is
   * external I/O, and external I/O never happens inside a transaction (house
   * rule). An orphaned object after a failed insert costs storage; a connection
   * held across a network call costs the whole module — there are 5 of them.
   */
  async uploadDocument(
    workflowUuid: string,
    file: INodeFilesUploadFile | undefined,
    documentUuid: string,
    runUuid: string,
    ctx: INodeFilesContext,
  ): Promise<{ document: INodeFilesDocument; runUuid: string }> {
    if (!file) throw badRequest("Adjuntá un archivo en el campo 'file'");
    if (file.size > NF_MAX_UPLOAD_BYTES) {
      throw badRequest(
        `El archivo supera el máximo de ${NF_MAX_UPLOAD_BYTES / (1024 * 1024)} MB`,
      );
    }
    if (!isAcceptedMimeType(file.mimetype)) {
      throw badRequest(
        `Tipo de archivo no admitido (${file.mimetype}): usá PDF, PNG, JPEG, WEBP, TXT o CSV`,
      );
    }

    const workflow = await this._workflowDAO.getByUuid(
      workflowUuid,
      ctx.companyId,
    );
    if (!workflow) throw notFound("Flujo no encontrado");
    if (workflow.status === "disabled") {
      throw badRequest("El flujo está deshabilitado");
    }
    if (workflow.fields.length === 0) {
      throw badRequest("El flujo no declara campos a extraer");
    }
    const workflowId = await this._workflowDAO.getIdByUuid(
      workflowUuid,
      ctx.companyId,
    );
    if (!workflowId) throw notFound("Flujo no encontrado");

    // Its own prefix, not `FileStorageService.buildStorageKey`'s `files/` tree:
    // these bytes belong to the module, and keeping them separate is what lets
    // them be migrated or purged without touching core's company assets.
    const extension = path.extname(file.originalname || "").toLowerCase();
    const storageKey = `companies/${ctx.companyId}/node-files/${documentUuid}${extension}`;
    await this._storage.putObject(storageKey, file.buffer, file.mimetype);

    const { document } = await this._documentDAO.createWithQueuedRun(
      {
        uuid: documentUuid,
        workflowId,
        companyId: ctx.companyId,
        storageKey,
        originalName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        checksum: this._storage.checksum(file.buffer),
        uploadedByUserId: ctx.userId,
        uploadedByName: ctx.userName,
      },
      runUuid,
    );

    return { document: NfDocumentDAO.mapToInterface(document), runUuid };
  }

  // ---- runs -------------------------------------------------------------

  async listRuns(
    req: Request,
    workflowUuid: string | undefined,
    ctx: INodeFilesContext,
  ): Promise<IDataPaginator<INodeFilesRun>> {
    let workflowId: number | undefined;
    if (workflowUuid) {
      // A workflow from another tenant resolves to nothing — and an empty page
      // is the right answer, never another company's runs (L-009).
      const resolved = await this._workflowDAO.getIdByUuid(
        workflowUuid,
        ctx.companyId,
      );
      if (!resolved) throw notFound("Flujo no encontrado");
      workflowId = resolved;
    }
    return this._runDAO.getAllWithFilters(req, ctx.companyId, workflowId);
  }

  /** The run plus the field schema the UI needs to label its values. */
  async getRun(
    uuid: string,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesRun & { fields: INodeFilesField[] }> {
    const run = await this._runDAO.getByUuid(uuid, ctx.companyId);
    if (!run) throw notFound("Ejecución no encontrada");
    const workflow = await this._workflowDAO.getByUuid(
      run.workflowUuid,
      ctx.companyId,
    );
    return { ...run, fields: workflow?.fields ?? [] };
  }

  /**
   * A human confirms the extracted values. They go through the SAME coercion
   * the model's answer does — typed input from a person is still input.
   */
  async reviewRun(
    uuid: string,
    input: NodeFilesRunReviewInputDTO,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesRun> {
    const id = await this._runDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Ejecución no encontrada");
    const row = await this._runDAO.getStatusById(id, ctx.companyId);
    if (!row) throw notFound("Ejecución no encontrada");
    if (row.status !== "pending_review") {
      throw conflict(
        `Solo se pueden confirmar ejecuciones pendientes de revisión (estado actual: ${row.status})`,
      );
    }

    const workflow = await this._workflowDAO.getById(
      row.workflowId,
      ctx.companyId,
    );
    if (!workflow) throw notFound("Flujo no encontrado");

    let values;
    try {
      values = coerceReviewValues(workflow.fields, input.values);
    } catch (err) {
      throw badRequest(
        err instanceof Error ? err.message : "Valores inválidos",
      );
    }

    const missing = missingRequiredLabels(workflow.fields, values);
    if (missing.length > 0) {
      throw badRequest(`Faltan campos obligatorios: ${missing.join(", ")}`);
    }

    await this._runDAO.review(
      id,
      ctx.companyId,
      values,
      ctx.userId,
      ctx.userName,
    );
    const updated = await this._runDAO.getByUuid(uuid, ctx.companyId);
    if (!updated) throw notFound("Ejecución no encontrada");
    return updated;
  }

  /** failed → queued. The worker picks it up on its next tick. */
  async retryRun(uuid: string, ctx: INodeFilesContext): Promise<INodeFilesRun> {
    const id = await this._runDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Ejecución no encontrada");
    const row = await this._runDAO.getStatusById(id, ctx.companyId);
    if (!row) throw notFound("Ejecución no encontrada");
    if (row.status !== "failed") {
      throw conflict(
        `Solo se pueden reintentar ejecuciones fallidas (estado actual: ${row.status})`,
      );
    }

    await this._runDAO.requeueOne(id, ctx.companyId);
    const updated = await this._runDAO.getByUuid(uuid, ctx.companyId);
    if (!updated) throw notFound("Ejecución no encontrada");
    return updated;
  }
}
