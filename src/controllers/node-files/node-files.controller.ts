import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CompanyDAO } from "../../dao/company/company.dao";
import { UserDAO } from "../../dao/user/user.dao";
import {
  NodeFilesCredentialCreateInputDTO,
  NodeFilesRunReviewInputDTO,
  NodeFilesWorkflowCreateInputDTO,
  NodeFilesWorkflowStatusInputDTO,
  NodeFilesWorkflowUpdateInputDTO,
} from "../../dto/input/node-files";
import { AuditService } from "../../services/audit.service";
import {
  INodeFilesContext,
  INodeFilesUploadFile,
  NodeFilesService,
  NodeFilesServiceError,
} from "../../services/node-files/node-files.service";
import { getCompanyScope } from "../../utils/companyScope";
import { assertUuidParam } from "../../utils/query-params";

type ContextResult =
  | { success: true; ctx: INodeFilesContext }
  | { success: false; message: string };

/**
 * Parameters each list endpoint honours, `search`/`sortBy` included.
 *
 * L-007 is enforced from this list: anything not in it is REJECTED with a 400.
 * A param that is accepted and ignored — a 200 carrying an unfiltered list —
 * is the failure this exists to prevent, and `search` on /runs is exactly that
 * trap: it is a reserved param the shared parser always accepts, so leaving it
 * out of the runs list means it has to be refused explicitly.
 *
 * `companyId` is present because a superAdmin pins the tenant with it (the
 * module gate and companyScope both read it).
 */
const WORKFLOW_QUERY_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "status",
  "companyId",
] as const;
const WORKFLOW_SORT_KEYS = ["name", "status", "createdAt", "updatedAt"];

const RUN_QUERY_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "status",
  "workflowUuid",
  "companyId",
] as const;
const RUN_SORT_KEYS = ["status", "createdAt", "finishedAt"];

const CREDENTIAL_QUERY_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "type",
  "companyId",
] as const;
const CREDENTIAL_SORT_KEYS = ["name", "type", "createdAt", "lastUsedAt"];

/**
 * node-files — workflows, uploads and runs.
 *
 * Hand-rolled rather than BaseCrudController, for the countdown reasons: the
 * module owns non-CRUD verbs (upload, review, retry) and needs a company scope
 * resolved once per request and handed to the service. The controller resolves
 * scope and validates input; the service owns every DAO call and throws a typed
 * `NodeFilesServiceError`, which is mapped to the response here.
 */
export class NodeFilesController {
  private _service = new NodeFilesService();
  private _companyDAO = new CompanyDAO();
  private _userDAO = new UserDAO();
  private _audit = new AuditService();

  // ---- helpers ----------------------------------------------------------

  /**
   * Everything the service needs about the caller, resolved once.
   *
   * The numeric company id is resolved HERE, exactly once, and handed down —
   * no DAO in this module ever joins `companies` or `users`, which live behind
   * another database key (L-009 + split-cleanliness).
   */
  private async buildContext(req: Request): Promise<ContextResult> {
    const user = req.user;
    if (!user) return { success: false, message: "Sesión inválida" };

    const scope = getCompanyScope(req);
    if (!scope.companyUuid) {
      return { success: false, message: "Indicá la empresa" };
    }
    const companyId = await this._companyDAO.getIdByUuid(scope.companyUuid);
    if (!companyId) {
      return { success: false, message: "Empresa no encontrada" };
    }

    // One lookup for both the numeric id and the printable name: the module's
    // tables denormalize the name because they may not join `users`.
    const caller = await this._userDAO.getByUuid(user.userId);
    const name = caller
      ? `${caller.firstName ?? ""} ${caller.lastName ?? ""}`.trim()
      : "";

    return {
      success: true,
      ctx: {
        companyId,
        userId: caller?.id ?? null,
        userName: name === "" ? (caller?.email ?? null) : name,
      },
    };
  }

  /** DTO `build()` throws in Spanish; every throw is a 400, not a 500. */
  private validated<T>(factory: () => T): T {
    try {
      return factory();
    } catch (err) {
      throw new NodeFilesServiceError(
        400,
        err instanceof Error ? err.message : "Datos inválidos",
      );
    }
  }

  /**
   * Refuse any query parameter this endpoint does not actually honour (L-007),
   * and any sort key that is not in the DAO's allowlist — a `sortBy` the query
   * builder silently falls back on is the same accepted-and-ignored bug in
   * another costume.
   */
  private assertKnownQuery(
    req: Request,
    allowed: readonly string[],
    sortKeys: string[],
  ): void {
    for (const key of Object.keys(req.query)) {
      if (!allowed.includes(key)) {
        throw new NodeFilesServiceError(
          400,
          `Parámetro de consulta no admitido: ${key}`,
        );
      }
    }
    const sortBy = req.query.sortBy;
    if (
      typeof sortBy === "string" &&
      sortBy !== "" &&
      !sortKeys.includes(sortBy)
    ) {
      throw new NodeFilesServiceError(
        400,
        `No se puede ordenar por "${sortBy}": usá ${sortKeys.join(", ")}`,
      );
    }
  }

  /** Service errors carry their own status; anything else is a real 500. */
  private fail(req: Request, next: NextFunction, err: unknown): void {
    if (err instanceof NodeFilesServiceError) {
      req.statusCode = err.status;
      next(new Error(err.message));
      return;
    }
    next(err);
  }

  /** Best-effort audit hook (audit_logs) — fire-and-forget, never blocks. */
  private recordAudit(
    req: Request,
    entityName: "NodeFilesWorkflow" | "NodeFilesRun" | "NodeFilesCredential",
    operation: "Alta" | "Modificacion" | "Baja",
    entity: Record<string, unknown> | null,
  ): void {
    void this._audit.record(req, entityName, operation, entity);
  }

  // ---- workflows --------------------------------------------------------

  public async listWorkflows(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.assertKnownQuery(req, WORKFLOW_QUERY_PARAMS, WORKFLOW_SORT_KEYS);
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const result = await this._service.listWorkflows(req, context.ctx);
      res.status(200).json(result);
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async getWorkflow(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const data = await this._service.getWorkflow(
        req.params.uuid as string,
        context.ctx,
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async createWorkflow(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new NodeFilesWorkflowCreateInputDTO(req.body).build(),
      );
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }

      // Host rule: the uuid is minted here, never by the client (the column's
      // DB default is only a backstop).
      const data = await this._service.createWorkflow(
        uuidv4(),
        inputDTO,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesWorkflow", "Alta", { ...data });
      res.status(201).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async updateWorkflow(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new NodeFilesWorkflowUpdateInputDTO(req.body).build(),
      );
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }

      const data = await this._service.updateWorkflow(
        req.params.uuid as string,
        inputDTO,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesWorkflow", "Modificacion", { ...data });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async deleteWorkflow(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const removed = await this._service.deleteWorkflow(
        req.params.uuid as string,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesWorkflow", "Baja", { ...removed });
      res
        .status(200)
        .json({ success: true, message: "Flujo eliminado correctamente" });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  /**
   * `GET /node-types` — the registry's config schemas.
   *
   * Authenticated and module-gated like everything else, but company-agnostic:
   * the registry is code, identical for every tenant, and asking for a company
   * scope here would only add a way to fail.
   */
  public listNodeTypes(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    try {
      res.status(200).json({ success: true, data: this._service.listNodeTypes() });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async setWorkflowStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new NodeFilesWorkflowStatusInputDTO(req.body).build(),
      );
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const data = await this._service.setWorkflowStatus(
        req.params.uuid as string,
        inputDTO.status,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesWorkflow", "Modificacion", { ...data });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  // ---- documents --------------------------------------------------------

  /** multipart, field `file` → one document plus the run it queues. */
  public async uploadDocument(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }

      const file = (req as Request & { file?: INodeFilesUploadFile }).file;
      const result = await this._service.uploadDocument(
        req.params.uuid as string,
        file,
        uuidv4(),
        uuidv4(),
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesRun", "Alta", { ...result.document });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  // ---- runs -------------------------------------------------------------

  public async listRuns(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.assertKnownQuery(req, RUN_QUERY_PARAMS, RUN_SORT_KEYS);
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      // A malformed uuid is a 400 naming the param, never a DB round trip that
      // comes back as a generic 22P02.
      const workflowUuid = this.validated(() =>
        assertUuidParam("workflowUuid", req.query.workflowUuid),
      );
      const result = await this._service.listRuns(
        req,
        workflowUuid,
        context.ctx,
      );
      res.status(200).json(result);
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async getRun(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const data = await this._service.getRun(
        req.params.uuid as string,
        context.ctx,
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async reviewRun(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new NodeFilesRunReviewInputDTO(req.body).build(),
      );

      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }

      const data = await this._service.reviewRun(
        req.params.uuid as string,
        inputDTO,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesRun", "Modificacion", { ...data });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async cancelRun(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const data = await this._service.cancelRun(
        req.params.uuid as string,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesRun", "Modificacion", { ...data });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  // ---- credentials ------------------------------------------------------

  public async listCredentials(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.assertKnownQuery(req, CREDENTIAL_QUERY_PARAMS, CREDENTIAL_SORT_KEYS);
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const result = await this._service.listCredentials(req, context.ctx);
      res.status(200).json(result);
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  /**
   * The secret arrives here once and leaves in no response — not even this
   * one. The audit entry is written from the SAME secret-free shape the
   * response carries, so `audit_logs` cannot become the place the secret is
   * readable after all.
   */
  public async createCredential(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new NodeFilesCredentialCreateInputDTO(req.body).build(),
      );
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const data = await this._service.createCredential(
        uuidv4(),
        inputDTO,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesCredential", "Alta", { ...data });
      res.status(201).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async deleteCredential(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const removed = await this._service.deleteCredential(
        req.params.uuid as string,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesCredential", "Baja", { ...removed });
      res
        .status(200)
        .json({ success: true, message: "Credencial eliminada correctamente" });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async retryRun(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const context = await this.buildContext(req);
      if (!context.success) {
        req.statusCode = 400;
        return next(new Error(context.message));
      }
      const data = await this._service.retryRun(
        req.params.uuid as string,
        context.ctx,
      );
      this.recordAudit(req, "NodeFilesRun", "Modificacion", { ...data });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }
}
