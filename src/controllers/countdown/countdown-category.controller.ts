import { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { CompanyDAO } from "../../dao/company/company.dao";
import { CountdownNameInputDTO } from "../../dto/input/countdown/CountdownNameInputDTO";
import { AuditService } from "../../services/audit.service";
import {
  CountdownCategoriesService,
  CountdownServiceError,
} from "../../services/countdown/countdown-categories.service";
import { getCompanyScope } from "../../utils/companyScope";

/**
 * Rubros and sub-rubros (`/api/countdown/categories`, `/api/countdown/subcategories`).
 *
 * Hand-rolled rather than BaseCrudController: the payload of every write is the
 * whole rubro aggregate (its sub-rubros and their usage counts), and sub-rubros
 * live on their own nested routes.
 */
export class CountdownCategoryController {
  private _service = new CountdownCategoriesService();
  private _companyDAO = new CompanyDAO();
  private _audit = new AuditService();

  /**
   * The tenant every query is scoped to. Non-superAdmins get their JWT company;
   * a superAdmin must name one with ?companyId=<uuid> (requireCountdownModule
   * already insists on it). Null ⇒ there is no company to work in.
   */
  private async resolveCompanyId(req: Request): Promise<number | null> {
    const { companyUuid } = getCompanyScope(req);
    if (!companyUuid) return null;
    return this._companyDAO.getIdByUuid(companyUuid);
  }

  /** DTO build() throws on invalid input; that is always a 400. */
  private parseName(req: Request): CountdownNameInputDTO {
    try {
      return new CountdownNameInputDTO(req.body).build();
    } catch (err) {
      throw new CountdownServiceError(
        400,
        err instanceof Error ? err.message : "Datos inválidos",
      );
    }
  }

  /**
   * Service failures already carry the status they deserve (404 for a rubro of
   * another company, 409 for a name clash or a rubro still in use); anything
   * else is a real error and stays a 500.
   */
  private forward(req: Request, next: NextFunction, err: unknown): void {
    if (err instanceof CountdownServiceError) {
      req.statusCode = err.status;
      next(new Error(err.message));
      return;
    }
    next(err);
  }

  private noCompany(req: Request, next: NextFunction): void {
    req.statusCode = 400;
    next(new Error("Empresa no encontrada"));
  }

  public async list(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      // Not paginated: this is the picker the document form reads on every open.
      const data = await this._service.list(companyId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const input = this.parseName(req);
      const category = await this._service.create(
        companyId,
        uuidv4(),
        input.name,
      );

      void this._audit.record(req, "CountdownCategory", "Alta", {
        uuid: category.uuid,
        name: category.name,
        companyId,
      });
      res.status(201).json({ success: true, data: category });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  public async rename(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const input = this.parseName(req);
      const category = await this._service.rename(
        companyId,
        req.params.uuid,
        input.name,
      );

      void this._audit.record(req, "CountdownCategory", "Modificacion", {
        uuid: category.uuid,
        name: category.name,
        companyId,
      });
      res.status(200).json({ success: true, data: category });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const removed = await this._service.remove(companyId, req.params.uuid);

      void this._audit.record(req, "CountdownCategory", "Baja", {
        uuid: removed.uuid,
        name: removed.name,
        companyId,
      });
      res.status(200).json({ success: true, message: "Rubro eliminado" });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  public async createSubcategory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const input = this.parseName(req);
      const subcategoryUuid = uuidv4();
      // The whole rubro comes back: the screen edits sub-rubros inside it.
      const category = await this._service.createSubcategory(
        companyId,
        req.params.uuid,
        subcategoryUuid,
        input.name,
      );

      void this._audit.record(req, "CountdownCategory", "Alta", {
        uuid: subcategoryUuid,
        name: input.name,
        companyId,
      });
      res.status(201).json({ success: true, data: category });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  public async renameSubcategory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const input = this.parseName(req);
      const category = await this._service.renameSubcategory(
        companyId,
        req.params.uuid,
        input.name,
      );

      void this._audit.record(req, "CountdownCategory", "Modificacion", {
        uuid: req.params.uuid,
        name: input.name,
        companyId,
      });
      res.status(200).json({ success: true, data: category });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  public async deleteSubcategory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const removed = await this._service.removeSubcategory(
        companyId,
        req.params.uuid,
      );

      void this._audit.record(req, "CountdownCategory", "Baja", {
        uuid: removed.uuid,
        name: removed.name,
        companyId,
      });
      res.status(200).json({ success: true, message: "Sub-rubro eliminado" });
    } catch (err) {
      this.forward(req, next, err);
    }
  }
}
