import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { InvitationDAO } from "../../dao/invitation/invitation.dao";
import { IInvitation } from "../../interfaces/invitation/invitation.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { InvitationCreateInputDTO } from "../../dto/input/invitation";
import { CompanyDAO } from "../../dao/company/company.dao";
import { getCompanyFilterUuid } from "../../utils/companyScope";
import { db } from "../../database/registry";

// SECURITY (C4): role hierarchy used to forbid escalation via invitations.
const ROLE_RANK: Record<string, number> = {
  member: 1,
  admin: 2,
  superAdmin: 3,
};

export class InvitationsController implements IBaseController {
  private _invitationDAO: InvitationDAO = new InvitationDAO();
  private _companyDAO: CompanyDAO = new CompanyDAO();

  public async getStats(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { companyId } = req.query;

      const knex = db("core");

      let query = knex("invitations");

      if (companyId) {
        const company = await this._companyDAO.getByUuid(companyId as string);
        if (company && company.id) {
          query = query.where("companyId", company.id);
        }
      }

      const [totalResult, pendingResult, acceptedResult, expiredResult] =
        await Promise.all([
          query.clone().count("* as count").first(),
          query
            .clone()
            .where("isUsed", false)
            .where("expiresAt", ">", knex.fn.now())
            .count("* as count")
            .first(),
          query.clone().where("isUsed", true).count("* as count").first(),
          query
            .clone()
            .where("isUsed", false)
            .where("expiresAt", "<=", knex.fn.now())
            .count("* as count")
            .first(),
        ]);

      const stats = {
        totalInvitations: parseInt(totalResult?.count as string) || 0,
        pendingInvitations: parseInt(pendingResult?.count as string) || 0,
        acceptedInvitations: parseInt(acceptedResult?.count as string) || 0,
        expiredInvitations: parseInt(expiredResult?.count as string) || 0,
      };

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);
      // SECURITY (C4): admins only see their own company; superAdmin may target via ?companyId.
      const companyUuid = getCompanyFilterUuid(req);
      const result: IDataPaginator<IInvitation> =
        await this._invitationDAO.getAll(page, limit, companyUuid);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      // SECURITY (C4): scope to the caller's company; cross-company → 404.
      const companyUuid = getCompanyFilterUuid(req);
      const result = await this._invitationDAO.getByUuid(uuid, companyUuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Invitation not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const actor = (req as any).user;

      const inputDTO = new InvitationCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // SECURITY (C4): an actor may never invite a role higher than their own (no admin → superAdmin).
      const actorRank = ROLE_RANK[actor?.role] ?? 0;
      const targetRank = ROLE_RANK[inputDTO.role] ?? 0;
      if (targetRank > actorRank) {
        res.status(403).json({
          success: false,
          message: "You cannot invite a user with a higher role than your own.",
        });
        return;
      }

      // SECURITY (C4): resolve the target company. Non-superAdmins are locked to their own company;
      // superAdmins must specify a company (unless inviting another superAdmin, who has none).
      let companyId: number | undefined;
      if (actor?.role === "superAdmin") {
        const bodyCompanyUuid = data.companyId as string | undefined;
        if (bodyCompanyUuid) {
          const company = await this._companyDAO.getByUuid(bodyCompanyUuid);
          if (!company || !company.id) {
            res.status(400).json({
              success: false,
              message: "Invalid company ID",
            });
            return;
          }
          companyId = company.id;
        } else if (inputDTO.role !== "superAdmin") {
          res.status(400).json({
            success: false,
            message: "Company ID is required for non-superAdmin invitations.",
          });
          return;
        }
      } else {
        const actorCompanyUuid = getCompanyFilterUuid(req);
        if (!actorCompanyUuid) {
          res.status(400).json({
            success: false,
            message: "You must belong to a company to create invitations.",
          });
          return;
        }
        const company = await this._companyDAO.getByUuid(actorCompanyUuid);
        if (!company || !company.id) {
          res.status(400).json({
            success: false,
            message: "Invalid company.",
          });
          return;
        }
        companyId = company.id;
      }

      const token = crypto.randomBytes(32).toString("hex");

      // Invitations expire 7 days after creation.
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const dataToCreate: IInvitation = {
        uuid: uuidv4(),
        email: inputDTO.email,
        // Raw token here; the DAO hashes it at rest (M5).
        token: token,
        role: inputDTO.role as "member" | "admin",
        companyId: companyId,
        invitedBy: inputDTO.invitedBy,
        expiresAt: expiresAt,
        isUsed: false,
      };

      const result = await this._invitationDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;
      const actor = (req as any).user;

      // SECURITY (C4): scope to the caller's company; cross-company → 404.
      const companyUuid = getCompanyFilterUuid(req);
      const existing = await this._invitationDAO.getByUuid(uuid, companyUuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Invitation not found",
        });
        return;
      }

      // SECURITY (C4): an actor may not raise an invitation's role above their own.
      if (data.role !== undefined) {
        const actorRank = ROLE_RANK[actor?.role] ?? 0;
        const targetRank = ROLE_RANK[data.role] ?? 0;
        if (targetRank > actorRank) {
          res.status(403).json({
            success: false,
            message: "You cannot set an invitation role higher than your own.",
          });
          return;
        }
      }

      const updateData: Partial<IInvitation> = {};
      if (data.email !== undefined) updateData.email = data.email;
      if (data.role !== undefined) updateData.role = data.role;
      if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;
      if (data.acceptedAt !== undefined)
        updateData.acceptedAt = data.acceptedAt;
      if (data.isUsed !== undefined) updateData.isUsed = data.isUsed;

      const result = await this._invitationDAO.update(existing.id, updateData);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // SECURITY (C4): scope to the caller's company; cross-company → 404.
      const companyUuid = getCompanyFilterUuid(req);
      const existing = await this._invitationDAO.getByUuid(uuid, companyUuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Invitation not found",
        });
        return;
      }

      const result = await this._invitationDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Invitation deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete invitation",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }

  public async getByToken(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      const result = await this._invitationDAO.getByToken(token);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Invitation not found",
        });
        return;
      }

      if (new Date(result.expiresAt) < new Date()) {
        res.status(400).json({
          success: false,
          message: "Invitation has expired",
        });
        return;
      }

      if (result.isUsed) {
        res.status(400).json({
          success: false,
          message: "Invitation has already been used",
        });
        return;
      }

      // SECURITY (C4/M5): never echo the (hashed) token back to the client.
      const { token: _token, ...safeResult } = result;

      res.status(200).json({
        success: true,
        data: safeResult,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async getActiveInvitations(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // SECURITY (C4): ignore the arbitrary :companyId path param entirely. Scope to the caller's
      // company (admins → JWT company; superAdmin → optional ?companyId), preserving the UUID-only
      // contract and preventing enumeration of other companies' invitations.
      const actor = (req as any).user;
      const companyUuid = getCompanyFilterUuid(req);

      // Non-superAdmins MUST be company-scoped; without a company there is nothing to return.
      if (actor?.role !== "superAdmin" && !companyUuid) {
        res.status(200).json({
          success: true,
          data: [],
        });
        return;
      }

      const result =
        await this._invitationDAO.getActiveInvitations(companyUuid);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async acceptInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;

      const invitation = await this._invitationDAO.getByToken(token);

      if (!invitation || !invitation.id) {
        res.status(404).json({
          success: false,
          message: "Invitation not found",
        });
        return;
      }

      if (new Date(invitation.expiresAt) < new Date()) {
        res.status(400).json({
          success: false,
          message: "Invitation has expired",
        });
        return;
      }

      if (invitation.isUsed) {
        res.status(400).json({
          success: false,
          message: "Invitation has already been used",
        });
        return;
      }

      const result = await this._invitationDAO.update(invitation.id, {
        isUsed: true,
        acceptedAt: new Date(),
      });

      res.status(200).json({
        success: true,
        data: result,
        message: "Invitation accepted successfully",
      });
    } catch (err: any) {
      next(err);
    }
  }
}
