import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CompanyDAO } from "../../dao/company/company.dao";
import {
  CountdownAssignmentsInputDTO,
  CountdownDocumentCreateInputDTO,
  CountdownDocumentStatusInputDTO,
  CountdownDocumentUpdateInputDTO,
} from "../../dto/input/countdown";
import { ICountdownDocument } from "../../interfaces/countdown/countdown.interfaces";
import { AuditService } from "../../services/audit.service";
import {
  CountdownDocumentsService,
  CountdownServiceError,
  ICountdownDocumentQuery,
  ICountdownRequestContext,
} from "../../services/countdown/countdown-documents.service";
import { CountdownExportService } from "../../services/countdown/countdown-export.service";
import { RbacService } from "../../services/rbac.service";
import { assertCalendarDate } from "../../dto/input/countdown/CountdownDocumentCreateInputDTO";
import { getCompanyScope } from "../../utils/companyScope";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { parseQueryParams } from "../../utils/queryBuilder";

const LIST_STATUSES = ["pending", "resolved", "overdue", "all"] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

type ContextResult =
  | { success: true; ctx: ICountdownRequestContext }
  | { success: false; message: string };

/**
 * Documents — the whole countdown workspace hangs off this controller.
 *
 * Hand-rolled rather than BaseCrudController: it owns non-CRUD verbs (status,
 * assignments, export, summary), an atomic resolve+renew, and a company scope it
 * must resolve once per request and hand to the service.
 */
export class CountdownDocumentController {
  private _service = new CountdownDocumentsService();
  private _companyDAO = new CompanyDAO();
  private _export = new CountdownExportService();
  private _audit = new AuditService();

  // ---- helpers ----------------------------------------------------------

  /** Best-effort audit hook (audit_logs) — awaited; AuditService swallows its own errors. */
  private async recordAudit(
    req: Request,
    operation: "Alta" | "Modificacion" | "Baja",
    entity: ICountdownDocument | null,
  ): Promise<void> {
    await this._audit.record(
      req,
      "CountdownDocument",
      operation,
      entity as unknown as Record<string, unknown> | null,
    );
  }

  /**
   * Everything the service needs about the caller, resolved once.
   *
   * `canManage` is one RBAC round trip per request — never per row (a page of
   * documents would otherwise become a page of permission queries).
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

    // Assignments are stored as serial ids, so the caller's numeric id is needed
    // to decide canResolve and to stamp uploadedBy/resolvedBy.
    const userId = await getIdByUuid(user.userId, "users");
    if (!userId) return { success: false, message: "Usuario no encontrado" };

    const canManage =
      user.role === "admin" ||
      user.role === "superAdmin" ||
      (await RbacService.userHasPermission(
        user.userId,
        user.role,
        "countdown.manage",
      ));

    return { success: true, ctx: { companyId, userId, canManage } };
  }

  /** DTO `build()` throws in Spanish; every throw is a 400, not a 500. */
  private validated<T>(factory: () => T): T {
    try {
      return factory();
    } catch (err) {
      throw new CountdownServiceError(
        400,
        err instanceof Error ? err.message : "Datos inválidos",
      );
    }
  }

  /**
   * The list, the summary and the export read the same parameters through the
   * same parser, so the three can never disagree about what was asked for
   * (L-007: nothing here is accepted and ignored).
   */
  private parseListQuery(req: Request): ICountdownDocumentQuery {
    const parsed = parseQueryParams(req);
    const filters = parsed.filters as Record<string, unknown>;

    const rawStatus = filters.status;
    const status: ListStatus =
      rawStatus === undefined || rawStatus === ""
        ? "pending"
        : LIST_STATUSES.includes(rawStatus as ListStatus)
          ? (rawStatus as ListStatus)
          : (() => {
              throw new CountdownServiceError(
                400,
                "Estado inválido: usá pending, resolved, overdue o all",
              );
            })();

    const dueFrom =
      typeof filters.dueFrom === "string" && filters.dueFrom !== ""
        ? this.validated(() => assertCalendarDate(filters.dueFrom))
        : undefined;
    const dueTo =
      typeof filters.dueTo === "string" && filters.dueTo !== ""
        ? this.validated(() => assertCalendarDate(filters.dueTo))
        : undefined;
    const category =
      typeof filters.category === "string" && filters.category !== ""
        ? filters.category
        : undefined;

    return {
      status,
      search: parsed.search,
      dueFrom,
      dueTo,
      category,
      sortBy: parsed.sortBy,
      sortOrder: parsed.sortOrder,
      page: parsed.page,
      limit: parsed.limit,
    };
  }

  /** Service errors carry their own status; anything else is a real 500. */
  private fail(req: Request, next: NextFunction, err: unknown): void {
    if (err instanceof CountdownServiceError) {
      req.statusCode = err.status;
      next(new Error(err.message));
      return;
    }
    next(err);
  }

  // ---- reads ------------------------------------------------------------

  public async list(
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
      const result = await this._service.list(
        this.parseListQuery(req),
        context.ctx,
      );
      res.status(200).json(result);
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async summary(
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
      const data = await this._service.summary(context.ctx);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  /**
   * The whole filtered set as a spreadsheet, not just the page on screen.
   * Designed to finish well inside CloudFront's 30 s ceiling: one query, one
   * in-memory workbook, capped rows.
   */
  public async exportXlsx(
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
      const { documents, truncated } = await this._service.listForExport(
        this.parseListQuery(req),
        context.ctx,
      );
      const workbook = await this._export.build(documents);
      const fileName = this._export.fileName();

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      // Tells the browser the file is complete without opening it.
      res.setHeader("X-Export-Rows", String(documents.length));
      if (truncated) res.setHeader("X-Export-Truncated", "1");
      res.send(workbook);
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async getByUuid(
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
      const data = await this._service.get(req.params.uuid, context.ctx);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  // ---- writes -----------------------------------------------------------

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new CountdownDocumentCreateInputDTO(req.body).build(),
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

      // Host rule: the uuid is minted here, never by the client (the column's DB
      // default is only a backstop).
      const data = await this._service.create(uuidv4(), inputDTO, context.ctx);
      await this.recordAudit(req, "Alta", data);
      res.status(201).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new CountdownDocumentUpdateInputDTO(req.body).build(),
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

      const data = await this._service.update(
        req.params.uuid,
        inputDTO,
        context.ctx,
      );
      await this.recordAudit(req, "Modificacion", data);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  /** Replaces who may resolve and who is reminded. Permission-gated at the route. */
  public async setAssignments(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new CountdownAssignmentsInputDTO(req.body).build(),
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

      const data = await this._service.setAssignments(
        req.params.uuid,
        inputDTO,
        context.ctx,
      );
      await this.recordAudit(req, "Modificacion", data);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  /** Returns `{ document, renewed }` — renewed is null unless the caller asked. */
  public async setStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = this.validated(() =>
        new CountdownDocumentStatusInputDTO(req.body).build(),
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

      // Minted up front so the successor's uuid still comes from the controller;
      // it is only spent if a renewal actually happens.
      const result = await this._service.setStatus(
        req.params.uuid,
        inputDTO,
        uuidv4(),
        context.ctx,
      );
      await this.recordAudit(req, "Modificacion", result.document);
      if (result.renewed) await this.recordAudit(req, "Alta", result.renewed);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      this.fail(req, next, err);
    }
  }

  public async delete(
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
      const removed = await this._service.remove(req.params.uuid, context.ctx);
      await this.recordAudit(req, "Baja", removed);
      res
        .status(200)
        .json({ success: true, message: "Documento eliminado correctamente" });
    } catch (err) {
      this.fail(req, next, err);
    }
  }
}
