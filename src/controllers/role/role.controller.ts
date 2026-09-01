import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { RoleDAO } from "../../dao/role/role.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { AuditService } from "../../services/audit.service";
import { getCompanyFilterUuid } from "../../utils/companyScope";
import {
  RoleCreateInputDTO,
  RoleUpdateInputDTO,
} from "../../dto/input/role";

const PROFILE_TYPES = [
  "director",
  "general",
  "productionManager",
  "qualityManager",
  "salesperson",
];

/**
 * Role (Perfil) management — module 02.
 *
 * GET    /roles                 list
 * GET    /roles/:uuid           role + granted permission codes
 * POST   /roles                 { name, profileType?, hasAccessToAllMachines? }
 * PUT    /roles/:uuid           same fields
 * PUT    /roles/:uuid/permissions { codes: string[] }   (grant matrix save)
 * PUT    /roles/assign          { userUuid, roleUuid|null }
 * DELETE /roles/:uuid           blocked for protected roles / roles in use
 */
export class RoleController {
  private dao = new RoleDAO();
  private userDAO = new UserDAO();
  private audit = new AuditService();

  private async callerCompanyId(req: Request, res: Response): Promise<number | null> {
    // superAdmin operating-as: company comes from the body (getCompanyForCreate
    // semantics); regular users' company always comes from their JWT.
    const user = (req as any).user;
    const companyUuid =
      user?.role === "superAdmin"
        ? (req.body?.companyId as string | undefined) ?? user?.companyId
        : user?.companyId;
    if (!companyUuid) {
      res.status(400).json({
        success: false,
        message:
          user?.role === "superAdmin"
            ? "SuperAdmin must specify a company"
            : "No company associated with the current user.",
      });
      return null;
    }
    const id = await this.dao.resolveCompanyId(companyUuid);
    if (!id) {
      res.status(404).json({ success: false, message: "Company not found" });
      return null;
    }
    return id;
  }

  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const role = await this.dao.getByUuid(req.params.uuid, getCompanyFilterUuid(req));
      if (!role) {
        res.status(404).json({ success: false, message: "Role not found" });
        return;
      }
      res.status(200).json({ success: true, data: role });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const companyId = await this.callerCompanyId(req, res);
      if (companyId === null) return;
      // Hand-rolled controller, so `build()` runs here inside the try/catch
      // (CLAUDE.md): it replaces the inline `!name || typeof name !== "string"`
      // check with a field-level error, and adds the varchar(200)/varchar(50)
      // bounds the column has and this endpoint never enforced.
      const inputDTO = new RoleCreateInputDTO(req.body).build();
      const { name, profileType, hasAccessToAllMachines } = inputDTO;
      // KEPT VERBATIM: this endpoint has always rejected an off-list
      // profileType and continues to. The DTO deliberately does NOT enumerate
      // the column (see its header — legacy rows outside the list), so removing
      // this check would LOOSEN the API, which a validation batch may not do.
      if (profileType && !PROFILE_TYPES.includes(profileType)) {
        res.status(400).json({
          success: false,
          message: `profileType must be one of: ${PROFILE_TYPES.join(", ")}`,
        });
        return;
      }
      const role = await this.dao.create({
        uuid: uuidv4(),
        companyId,
        name,
        profileType: profileType || "general",
        hasAccessToAllMachines: hasAccessToAllMachines ?? true,
        isProtected: false,
      });
      await this.audit.record(req, "Role", "Alta", role as any);
      res.status(201).json({ success: true, data: role });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(400).json({
          success: false,
          message: "A role with this name already exists.",
        });
        return;
      }
      next(err);
    }
  }

  public async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const existing = await this.dao.getByUuid(req.params.uuid, getCompanyFilterUuid(req));
      if (!existing || !existing.id) {
        res.status(404).json({ success: false, message: "Role not found" });
        return;
      }
      const inputDTO = new RoleUpdateInputDTO(req.body).build();
      const { name, profileType, hasAccessToAllMachines } = inputDTO;
      if (existing.isProtected && name && name !== existing.name) {
        res.status(400).json({
          success: false,
          message: "The protected Admin role cannot be renamed.",
        });
        return;
      }
      if (profileType && !PROFILE_TYPES.includes(profileType)) {
        res.status(400).json({
          success: false,
          message: `profileType must be one of: ${PROFILE_TYPES.join(", ")}`,
        });
        return;
      }
      const payload: any = {};
      if (name !== undefined) payload.name = name;
      if (profileType !== undefined) payload.profileType = profileType;
      if (hasAccessToAllMachines !== undefined)
        payload.hasAccessToAllMachines = hasAccessToAllMachines;
      const updated = await this.dao.update(existing.id, payload);
      await this.audit.record(req, "Role", "Modificacion", updated as any);
      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      next(err);
    }
  }

  public async setPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const existing = await this.dao.getByUuid(req.params.uuid, getCompanyFilterUuid(req));
      if (!existing || !existing.id) {
        res.status(404).json({ success: false, message: "Role not found" });
        return;
      }
      if (existing.isProtected) {
        res.status(400).json({
          success: false,
          message: "The protected Admin role's permissions cannot be edited.",
        });
        return;
      }
      const { codes } = req.body;
      if (!Array.isArray(codes) || codes.some((c) => typeof c !== "string")) {
        res.status(400).json({
          success: false,
          message: "codes must be an array of permission code strings",
        });
        return;
      }
      const applied = await this.dao.setPermissions(
        existing.id,
        existing.companyId,
        codes,
      );
      await this.audit.record(req, "Role", "Modificacion", {
        ...existing,
        permissionCodes: applied,
      } as any);
      res.status(200).json({ success: true, data: { codes: applied } });
    } catch (err: any) {
      next(err);
    }
  }

  public async assign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userUuid, roleUuid } = req.body;
      if (!userUuid) {
        res.status(400).json({ success: false, message: "userUuid is required" });
        return;
      }
      const companyUuid = getCompanyFilterUuid(req);
      const user = await this.userDAO.getByUuid(userUuid);
      if (!user || !(user as any).id) {
        res.status(404).json({ success: false, message: "User not found" });
        return;
      }

      // Cross-tenant guard on BOTH paths (assign and unassign): a non-superAdmin
      // caller may only touch users of their own company. 404, not 403, so
      // foreign users' existence isn't leaked.
      if (companyUuid) {
        const callerCompanyId = await this.dao.resolveCompanyId(companyUuid);
        if ((user as any).companyId !== callerCompanyId) {
          res.status(404).json({ success: false, message: "User not found" });
          return;
        }
      }

      let roleId: number | null = null;
      if (roleUuid) {
        const role = await this.dao.getByUuid(roleUuid, companyUuid);
        if (!role || !role.id) {
          res.status(404).json({ success: false, message: "Role not found" });
          return;
        }
        // The role must belong to the user's company (guards the superAdmin
        // path too, where companyUuid is undefined and no scope applied above).
        if ((user as any).companyId !== role.companyId) {
          res.status(400).json({
            success: false,
            message: "User and role belong to different companies.",
          });
          return;
        }
        roleId = role.id;
      }

      await this.dao.assignToUser((user as any).id, roleId);
      await this.audit.record(req, "User", "Modificacion", {
        uuid: userUuid,
        roleId,
      } as any);
      res.status(200).json({ success: true, message: "Role assignment updated" });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const existing = await this.dao.getByUuid(req.params.uuid, getCompanyFilterUuid(req));
      if (!existing || !existing.id) {
        res.status(404).json({ success: false, message: "Role not found" });
        return;
      }
      if (existing.isProtected) {
        res.status(400).json({
          success: false,
          message: "The protected Admin role cannot be deleted.",
        });
        return;
      }
      // No FK can block this: users.roleId is ON DELETE SET NULL (assigned users
      // fall back to the legacy enum) and role_permissions cascades.
      await this.dao.delete(existing.id);
      await this.audit.record(req, "Role", "Baja", existing as any);
      res.status(200).json({ success: true, message: "Role deleted successfully" });
    } catch (err: any) {
      next(err);
    }
  }
}
