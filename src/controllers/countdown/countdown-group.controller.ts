import { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { CompanyDAO } from "../../dao/company/company.dao";
import { CountdownGroupMembersInputDTO } from "../../dto/input/countdown/CountdownGroupMembersInputDTO";
import { CountdownNameInputDTO } from "../../dto/input/countdown/CountdownNameInputDTO";
import { AuditService } from "../../services/audit.service";
import { CountdownServiceError } from "../../services/countdown/countdown-categories.service";
import { CountdownGroupsService } from "../../services/countdown/countdown-groups.service";
import { getCompanyScope } from "../../utils/companyScope";

/**
 * Grupos (`/api/countdown/groups`) — named sets of users a document can be
 * assigned to. Hand-rolled: membership is replaced wholesale on its own nested
 * route and every response carries the expanded member list.
 */
export class CountdownGroupController {
  private _service = new CountdownGroupsService();
  private _companyDAO = new CompanyDAO();
  private _audit = new AuditService();

  /**
   * The tenant every query is scoped to. Non-superAdmins get their JWT company;
   * a superAdmin must name one with ?companyId=<uuid>.
   */
  private async resolveCompanyId(req: Request): Promise<number | null> {
    const { companyUuid } = getCompanyScope(req);
    if (!companyUuid) return null;
    return this._companyDAO.getIdByUuid(companyUuid);
  }

  /** DTO build() throws on invalid input; that is always a 400. */
  private parse<T>(build: () => T): T {
    try {
      return build();
    } catch (err) {
      throw new CountdownServiceError(
        400,
        err instanceof Error ? err.message : "Datos inválidos",
      );
    }
  }

  /**
   * Service failures already carry their status (404 for a grupo of another
   * company, 409 for a name clash, 400 for a member who is not an active user
   * here); anything else is a real error and stays a 500.
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

      // Not paginated: the assignment picker reads the whole list.
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

      const input = this.parse(() =>
        new CountdownNameInputDTO(req.body).build(),
      );
      const group = await this._service.create(companyId, uuidv4(), input.name);

      await this._audit.record(req, "CountdownGroup", "Alta", {
        uuid: group.uuid,
        name: group.name,
        companyId,
      });
      res.status(201).json({ success: true, data: group });
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

      const input = this.parse(() =>
        new CountdownNameInputDTO(req.body).build(),
      );
      const group = await this._service.rename(
        companyId,
        req.params.uuid,
        input.name,
      );

      await this._audit.record(req, "CountdownGroup", "Modificacion", {
        uuid: group.uuid,
        name: group.name,
        companyId,
      });
      res.status(200).json({ success: true, data: group });
    } catch (err) {
      this.forward(req, next, err);
    }
  }

  /** PUT: the body is the complete membership, not an addition to it. */
  public async setMembers(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) return this.noCompany(req, next);

      const input = this.parse(() =>
        new CountdownGroupMembersInputDTO(req.body).build(),
      );
      const group = await this._service.setMembers(
        companyId,
        req.params.uuid,
        input.members,
      );

      await this._audit.record(req, "CountdownGroup", "Modificacion", {
        uuid: group.uuid,
        name: group.name,
        companyId,
        members: group.members,
      });
      res.status(200).json({ success: true, data: group });
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

      await this._audit.record(req, "CountdownGroup", "Baja", {
        uuid: removed.uuid,
        name: removed.name,
        companyId,
      });
      res.status(200).json({ success: true, message: "Grupo eliminado" });
    } catch (err) {
      this.forward(req, next, err);
    }
  }
}
