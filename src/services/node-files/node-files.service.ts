import { Request } from "express";
import * as path from "path";
import { IDataPaginator } from "../../database/d.types";
import { NfCredentialDAO } from "../../dao/node-files/nf-credential.dao";
import { NfDocumentDAO } from "../../dao/node-files/nf-document.dao";
import { NfNodeRunDAO } from "../../dao/node-files/nf-node-run.dao";
import { NfRunDAO } from "../../dao/node-files/nf-run.dao";
import { NfWorkflowCredentialDAO } from "../../dao/node-files/nf-workflow-credential.dao";
import { NfWorkflowDAO } from "../../dao/node-files/nf-workflow.dao";
import {
  NodeFilesCredentialCreateInputDTO,
  NodeFilesRunReviewInputDTO,
  NodeFilesWorkflowCreateInputDTO,
  NodeFilesWorkflowUpdateInputDTO,
} from "../../dto/input/node-files";
import {
  INodeFilesCredential,
  INodeFilesDefinition,
  INodeFilesDocument,
  INodeFilesField,
  INodeFilesNodeRun,
  INodeFilesNodeTypeDescriptor,
  INodeFilesRun,
  INodeFilesWorkflow,
  NodeFilesWorkflowStatus,
} from "../../interfaces/node-files/node-files.interfaces";
import { FileStorageService } from "../file-storage.service";
import { encryptSecret, NodeFilesSecretError } from "./credential-crypto";
import { DefinitionError, validateDefinition } from "./definition";
import { isAcceptedMimeType } from "./extraction/claude-extraction.provider";
import {
  pngDeclaresTransparency,
  TRANSPARENCY_REJECTION,
} from "./extraction/image-alpha";
import {
  coerceReviewValues,
  missingRequiredLabels,
} from "./extraction/field-schema";
import { nodeTypeDescriptors } from "./nodes/registry";

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
  private _nodeRunDAO = new NfNodeRunDAO();
  private _credentialDAO = new NfCredentialDAO();
  private _workflowCredentialDAO = new NfWorkflowCredentialDAO();
  private _storage = new FileStorageService();

  // ---- the node registry ------------------------------------------------

  /**
   * `GET /node-types` — the config schemas the editor renders its panel from.
   * Pure code, no database, no company: the registry is the same for everyone.
   */
  listNodeTypes(): INodeFilesNodeTypeDescriptor[] {
    return nodeTypeDescriptors();
  }

  // ---- definition validation -------------------------------------------

  /**
   * Validate a graph and resolve the credentials it references, returning the
   * numeric ids for the join table.
   *
   * The credential check is what makes cross-tenant references impossible: the
   * uuids are resolved through a company-scoped query, so another tenant's
   * credential simply does not resolve and reads as "no existe" — the same
   * answer a typo gets, which is what keeps existence from leaking (L-009).
   */
  private async resolveDefinition(
    definition: INodeFilesDefinition | null,
    fields: INodeFilesField[],
    ctx: INodeFilesContext,
  ): Promise<number[]> {
    if (definition === null) return [];
    let plan;
    try {
      plan = validateDefinition(definition, fields);
    } catch (err) {
      if (err instanceof DefinitionError) throw badRequest(err.message);
      throw err;
    }

    if (plan.credentialUuids.length === 0) return [];
    const resolved = await this._credentialDAO.idsByUuids(
      plan.credentialUuids,
      ctx.companyId,
    );
    const missing = plan.credentialUuids.filter((uuid) => !resolved.has(uuid));
    if (missing.length > 0) {
      throw badRequest(
        `El flujo referencia credenciales que no existen: ${missing.join(", ")}`,
      );
    }
    return [...resolved.values()];
  }

  /**
   * The workflow lock: a definition may not change under a run that is about to
   * read it, or is reading it right now.
   */
  private async assertNoActiveRuns(
    workflowId: number,
    ctx: INodeFilesContext,
  ): Promise<void> {
    const active = await this._runDAO.countActiveByWorkflow(
      workflowId,
      ctx.companyId,
    );
    if (active > 0) {
      throw conflict(
        `No se puede modificar: el flujo tiene ${active} ${
          active === 1 ? "ejecución en curso" : "ejecuciones en curso"
        }`,
      );
    }
  }

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
    const credentialIds = await this.resolveDefinition(
      input.definition,
      input.fields,
      ctx,
    );

    const workflow = await this._workflowDAO.create({
      uuid,
      companyId: ctx.companyId,
      name: input.name,
      description: input.description,
      requireReview: input.requireReview,
      status: input.status,
      fields: input.fields,
      definition: input.definition,
      createdByUserId: ctx.userId,
      createdByName: ctx.userName,
    });

    if (credentialIds.length > 0) {
      const id = await this._workflowDAO.getIdByUuid(uuid, ctx.companyId);
      if (id) {
        await this._workflowCredentialDAO.replaceForWorkflow(
          id,
          ctx.companyId,
          credentialIds,
        );
      }
    }
    return workflow;
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
    const existing = await this._workflowDAO.getById(id, ctx.companyId);
    if (!existing) throw notFound("Flujo no encontrado");

    await this.assertNoActiveRuns(id, ctx);

    // The graph is validated against the fields the workflow will HAVE after
    // this patch, not the ones it had: renaming a field out from under a
    // condition is caught here rather than at the next run.
    const fields = input.fields ?? existing.fields;
    const definition =
      input.definition !== undefined
        ? input.definition
        : ((existing.definition as INodeFilesDefinition | null) ?? null);
    const credentialIds = await this.resolveDefinition(definition, fields, ctx);

    const updated = await this._workflowDAO.update(id, ctx.companyId, input);
    if (!updated) throw notFound("Flujo no encontrado");
    await this._workflowCredentialDAO.replaceForWorkflow(
      id,
      ctx.companyId,
      credentialIds,
    );
    return updated;
  }

  /** `POST /workflows/:uuid/status` — activar / deshabilitar / volver a borrador. */
  async setWorkflowStatus(
    uuid: string,
    status: NodeFilesWorkflowStatus,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesWorkflow> {
    const id = await this._workflowDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Flujo no encontrado");
    const existing = await this._workflowDAO.getById(id, ctx.companyId);
    if (!existing) throw notFound("Flujo no encontrado");

    // Activating a flow with a broken graph would accept uploads that can only
    // fail, so the same validation that guards a save guards the publish.
    if (status === "active") {
      await this.resolveDefinition(
        (existing.definition as INodeFilesDefinition | null) ?? null,
        existing.fields,
        ctx,
      );
    }

    const updated = await this._workflowDAO.update(id, ctx.companyId, {
      status,
    });
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
    // Refused here rather than at extraction: the file would be stored, billed
    // for and turned into a confidently wrong row before anyone saw it.
    if (pngDeclaresTransparency(file.buffer)) {
      throw badRequest(TRANSPARENCY_REJECTION);
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

  /**
   * The run, the field schema the UI needs to label its values, and the node
   * timeline. Three short scoped reads, all in the caller's own company.
   */
  async getRun(
    uuid: string,
    ctx: INodeFilesContext,
  ): Promise<
    INodeFilesRun & {
      fields: INodeFilesField[];
      definition: INodeFilesDefinition | null;
      nodeRuns: INodeFilesNodeRun[];
    }
  > {
    const run = await this._runDAO.getByUuid(uuid, ctx.companyId);
    if (!run) throw notFound("Ejecución no encontrada");
    const id = await this._runDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Ejecución no encontrada");

    const [workflow, nodeRuns] = await Promise.all([
      this._workflowDAO.getByUuid(run.workflowUuid, ctx.companyId),
      this._nodeRunDAO.listByRunId(id, ctx.companyId),
    ]);
    return {
      ...run,
      fields: workflow?.fields ?? [],
      // The canvas needs the graph to draw the timeline on top of it.
      definition: workflow?.definition ?? null,
      nodeRuns,
    };
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

  /**
   * Retry a failed run.
   *
   * Where it restarts from depends on what it already has, and the reason is
   * money: a run that failed IN THE GRAPH already paid for its extraction, and
   * re-extracting the same document would bill the tenant a second time for an
   * answer that is sitting in the row. So:
   *
   *  - no `extracted` yet → back to `queued`, the extraction runs again;
   *  - `extracted` present → back to `running` and unlocked, which is what
   *    `claimNextRunnable` looks for; the graph re-runs with the same values,
   *    reviewed ones included.
   *
   * The previous attempt's node rows are cleared either way: keeping them next
   * to the new ones would read as one run that executed every node twice. The
   * new rows carry `attempt = previous + 1`, so the count survives the delete.
   */
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

    const attempt = await this._nodeRunDAO.maxAttempt(id, ctx.companyId);
    await this._nodeRunDAO.deleteByRunId(id, ctx.companyId);
    if (row.extracted === null) {
      await this._runDAO.requeueOne(id, ctx.companyId);
    } else {
      await this._runDAO.requeueExecution(id, ctx.companyId);
    }
    console.info(
      `[node-files] run ${uuid} retried (previous attempts: ${attempt})`,
    );

    const updated = await this._runDAO.getByUuid(uuid, ctx.companyId);
    if (!updated) throw notFound("Ejecución no encontrada");
    return updated;
  }

  /**
   * Cancel a run that has not started doing anything irreversible.
   *
   * `queued` and `pending_review` can be cancelled; `extracting` and `running`
   * cannot, and the 409 says so. Cancelling mid-node is an explicit non-goal of
   * this phase, and pretending otherwise would be worse than refusing: a node
   * that has already sent an email cannot be un-sent by a status change, so a
   * "cancelada" run whose email arrived anyway is a lie told by the UI.
   */
  async cancelRun(uuid: string, ctx: INodeFilesContext): Promise<INodeFilesRun> {
    const id = await this._runDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Ejecución no encontrada");
    const row = await this._runDAO.getStatusById(id, ctx.companyId);
    if (!row) throw notFound("Ejecución no encontrada");
    if (row.status !== "queued" && row.status !== "pending_review") {
      throw conflict(
        `Solo se pueden cancelar ejecuciones en cola o pendientes de revisión (estado actual: ${row.status})`,
      );
    }

    await this._runDAO.markFailed(
      id,
      ctx.companyId,
      "Cancelada por el usuario",
    );
    const updated = await this._runDAO.getByUuid(uuid, ctx.companyId);
    if (!updated) throw notFound("Ejecución no encontrada");
    return updated;
  }

  // ---- credentials ------------------------------------------------------

  async listCredentials(
    req: Request,
    ctx: INodeFilesContext,
  ): Promise<IDataPaginator<INodeFilesCredential>> {
    return this._credentialDAO.getAllWithFilters(req, ctx.companyId);
  }

  /**
   * Create a credential. The secret is encrypted here and is never readable
   * again through any endpoint — not in the create response either, which
   * returns the same secret-free shape every other endpoint does.
   */
  async createCredential(
    uuid: string,
    input: NodeFilesCredentialCreateInputDTO,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesCredential> {
    let encrypted;
    try {
      encrypted = encryptSecret(input.secret);
    } catch (err) {
      // A missing NF_SECRET_KEY is a 400 with a sentence an operator can act
      // on, never a 500 and never a boot failure (brief D-5).
      if (err instanceof NodeFilesSecretError) throw badRequest(err.message);
      throw err;
    }

    return this._credentialDAO.create({
      uuid,
      companyId: ctx.companyId,
      name: input.name,
      type: input.type,
      headerName: input.headerName,
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
      createdByUserId: ctx.userId,
      createdByName: ctx.userName,
    });
  }

  /**
   * Delete a credential, refusing while a workflow still references it — the
   * same shape workflow deletion uses for runs, and for the same reason: the
   * silent alternative is an HTTP node that starts failing tomorrow with a
   * message nobody can trace back to this click.
   */
  async deleteCredential(
    uuid: string,
    ctx: INodeFilesContext,
  ): Promise<INodeFilesCredential> {
    const credential = await this._credentialDAO.getByUuid(
      uuid,
      ctx.companyId,
    );
    if (!credential) throw notFound("Credencial no encontrada");
    const id = await this._credentialDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Credencial no encontrada");

    const inUse = await this._credentialDAO.countWorkflowsUsing(
      id,
      ctx.companyId,
    );
    if (inUse > 0) {
      throw conflict(
        `No se puede eliminar: ${inUse} ${
          inUse === 1 ? "flujo la usa" : "flujos la usan"
        }`,
      );
    }

    const deleted = await this._credentialDAO.delete(id, ctx.companyId);
    if (!deleted) throw notFound("Credencial no encontrada");
    return credential;
  }
}
