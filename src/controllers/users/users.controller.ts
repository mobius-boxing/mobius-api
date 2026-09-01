import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { UserDAO } from "../../dao/user/user.dao";
import { IUser } from "../../interfaces/user/user.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import {
  UserCreateInputDTO,
  UserSelfUpdateInputDTO,
} from "../../dto/input/user";
import { validatePassword, BCRYPT_COST } from "../../utils/passwordPolicy";
import { InvitationDAO } from "../../dao/invitation/invitation.dao";
import { IInvitation } from "../../interfaces/invitation/invitation.interfaces";
import { CompanyDAO } from "../../dao/company/company.dao";
import crypto from "crypto";
import { EmailService } from "../../services/email.service";
import { db } from "../../database/registry";

export class UsersController implements IBaseController {
  private _userDAO: UserDAO = new UserDAO();
  private _invitationDAO: InvitationDAO = new InvitationDAO();
  private _companyDAO: CompanyDAO = new CompanyDAO();
  private _emailService: EmailService = new EmailService();

  /**
   * SuperAdmins see all users; Admins see only users from their company.
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const currentUser = (req as any).user;

      let result: IDataPaginator<IUser>;

      if (currentUser.role === "superAdmin") {
        result = await this._userDAO.getAllWithFilters(req);
      } else {
        const adminUser = await this._userDAO.getByUuid(currentUser.userId);
        if (!adminUser || !adminUser.companyId) {
          res.status(403).json({
            success: false,
            message: "Admin user must be assigned to a company",
          });
          return;
        }
        const { page = 1, limit = 20 } = req.query;
        result = await this._userDAO.getAllByCompany(
          adminUser.companyId,
          Number(page),
          Number(limit),
        );
      }

      // SECURITY: strip password hash before sending to client.
      result.data = result.data.map((user) => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword as IUser;
      });

      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * SECURITY (C2): cross-tenant read guard. superAdmin sees everyone; anyone
   * may read themselves; otherwise the target must belong to the caller's
   * company. Returns false when access must be denied (caller responds 404 so
   * foreign users' existence is not leaked).
   */
  private async callerCanAccessUser(
    req: Request,
    target: { uuid?: string; companyId?: number | null },
  ): Promise<boolean> {
    const caller = (req as any).user;
    if (!caller) return false;
    if (caller.role === "superAdmin") return true;
    if (target.uuid && target.uuid === caller.userId) return true;
    if (!caller.companyId || !target.companyId) return false;
    const { getIdByUuid } = await import("../../utils/foreignKeyResolver");
    const callerCompanyId = await getIdByUuid(caller.companyId, "companies");
    return callerCompanyId !== null && callerCompanyId === target.companyId;
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._userDAO.getByUuid(uuid);

      if (!result || !(await this.callerCanAccessUser(req, result))) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // SECURITY: strip password hash before sending to client.
      const { password, ...userWithoutPassword } = result;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
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

      const inputDTO = new UserCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const existingUser = await this._userDAO.getUserByEmail(inputDTO.email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
        return;
      }

      // SECURITY (M4): enforce password policy + raised bcrypt cost.
      const policy = validatePassword(inputDTO.password);
      if (!policy.valid) {
        res.status(400).json({
          success: false,
          message: policy.message,
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(inputDTO.password, BCRYPT_COST);

      // SECURITY (C3), same rule the update path already applies: `companyId`
      // arrives as a UUID from the clients and as a numeric id from internal
      // callers. `UserCreateInputDTO` checks the SHAPE (uuid or int) and leaves
      // it alone; resolving it here replaces the old `parseInt(uuid, 10)`,
      // which quietly produced the leading digits — or NaN — and wrote it to
      // the FK column.
      let companyId: number | undefined;
      if (typeof inputDTO.companyId === "number") {
        companyId = inputDTO.companyId;
      } else if (typeof inputDTO.companyId === "string") {
        const company = await this._companyDAO.getByUuid(inputDTO.companyId);
        if (!company || !company.id) {
          res.status(400).json({
            success: false,
            message: "Invalid company ID",
          });
          return;
        }
        companyId = company.id;
      }

      const dataToCreate: IUser = {
        uuid: uuidv4(),
        email: inputDTO.email,
        password: hashedPassword,
        firstName: inputDTO.firstName,
        lastName: inputDTO.lastName,
        role: inputDTO.role as "member" | "admin" | "superAdmin",
        companyId,
        isActive: true,
        emailVerified: false,
      };

      const result = await this._userDAO.create(dataToCreate);

      // SECURITY: strip password hash before sending to client.
      const { password, ...userWithoutPassword } = result;

      res.status(201).json({
        success: true,
        data: userWithoutPassword,
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
      const isSuperAdmin = actor?.role === "superAdmin";

      const existing = await this._userDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // SECURITY (C3): ownership/company check. A non-superAdmin actor may only edit users that
      // belong to their own company. The actor's JWT carries the company UUID, so resolve the
      // target user's company UUID and compare. SuperAdmins are exempt.
      if (!isSuperAdmin) {
        let targetCompanyUuid: string | undefined;
        if (existing.companyId) {
          const targetCompany = await this._companyDAO.getById(
            existing.companyId,
          );
          targetCompanyUuid = targetCompany?.uuid;
        }
        const actorCompanyUuid = actor?.companyId as string | undefined;
        if (!actorCompanyUuid || actorCompanyUuid !== targetCompanyUuid) {
          // 404 (not 403) so cross-company existence isn't leaked.
          res.status(404).json({
            success: false,
            message: "User not found",
          });
          return;
        }
      }

      // SECURITY (C3): build the update payload from role-gated fields only.
      // - Privileged fields (role, isActive, emailVerified, companyId): superAdmin only.
      // - Profile fields (firstName, lastName, email): superAdmin and admin.
      // A regular user can never reach here (route requires admin), and can never set role.
      const updateData: any = {};

      if (isSuperAdmin) {
        // Empty string from a superadmin "no company selected" UI clears the company.
        if (data.companyId === "" || data.companyId === null) {
          data.companyId = undefined;
          updateData.companyId = null;
        } else if (data.companyId !== undefined) {
          // SECURITY (C3): companyId arrives as a UUID — resolve it to the numeric id rather than
          // parseInt'ing a UUID. (Numeric ids are accepted defensively for internal callers.)
          const isNumeric = /^\d+$/.test(String(data.companyId));
          if (isNumeric) {
            updateData.companyId = parseInt(String(data.companyId), 10);
          } else {
            const company = await this._companyDAO.getByUuid(data.companyId);
            if (!company || !company.id) {
              res.status(400).json({
                success: false,
                message: "Invalid company ID",
              });
              return;
            }
            updateData.companyId = company.id;
          }
        }

        if (data.role !== undefined) updateData.role = data.role;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        if (data.emailVerified !== undefined)
          updateData.emailVerified = data.emailVerified;
      } else {
        // Edit forms echo the whole user object back; treat only ACTUAL
        // changes as modification attempts, not unchanged echoes.
        if (data.companyId === "" || data.companyId === null) {
          data.companyId = undefined;
        }
        if (data.companyId !== undefined) {
          // The client sends a company UUID; equal to the actor's own company
          // (== target's, per the ownership check above) means "unchanged".
          if (data.companyId === (actor?.companyId as string | undefined)) {
            data.companyId = undefined;
          }
        }
        if (data.role !== undefined && data.role === existing.role) {
          data.role = undefined;
        }
        if (
          data.isActive !== undefined &&
          data.isActive === existing.isActive
        ) {
          data.isActive = undefined;
        }
        if (
          data.emailVerified !== undefined &&
          data.emailVerified === existing.emailVerified
        ) {
          data.emailVerified = undefined;
        }

        // SECURITY (C3): admins may not elevate anyone to superAdmin, nor change role at all,
        // nor reassign company / toggle active / verified. Reject explicit attempts.
        if (
          data.role !== undefined ||
          data.isActive !== undefined ||
          data.emailVerified !== undefined ||
          data.companyId !== undefined
        ) {
          res.status(403).json({
            success: false,
            message:
              "You are not allowed to modify role, status, verification or company.",
          });
          return;
        }
      }

      // Profile fields are allowed for both admins and superAdmins.
      const profileDTO = new UserSelfUpdateInputDTO(data).build();
      // Validation regression guard: the old path ran inputValidator on the
      // update DTO — keep validating (e.g. email format) on this path too.
      const profileValidation: IInputValidator =
        await inputValidator(profileDTO);
      if (!profileValidation.success) {
        req.statusCode = 400;
        return next(new Error(profileValidation.message));
      }
      Object.assign(updateData, profileDTO);

      // Password change is allowed for both admins (within company) and superAdmins.
      if (data.password !== undefined) {
        const policy = validatePassword(data.password);
        if (!policy.valid) {
          res.status(400).json({
            success: false,
            message: policy.message,
          });
          return;
        }
        updateData.password = await bcrypt.hash(data.password, BCRYPT_COST);
      }

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          success: false,
          message: "No updatable fields provided.",
        });
        return;
      }

      const result = await this._userDAO.update(existing.id, updateData);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Failed to update user",
        });
        return;
      }

      // SECURITY: strip password hash before sending to client.
      const { password, ...userWithoutPassword } = result;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
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

      const existing = await this._userDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      const result = await this._userDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "User deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete user",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }

  public async getWithCompany(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._userDAO.getUserWithCompany(uuid);

      // SECURITY (C2): same cross-tenant guard as getByUuid — a foreign
      // company's user (and their company details) must not be readable.
      if (!result || !(await this.callerCanAccessUser(req, result))) {
        res.status(404).json({
          success: false,
          message: "User not found",
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

  public async getByEmail(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { email } = req.params;
      const result = await this._userDAO.getUserByEmail(email);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // SECURITY: strip password hash before sending to client.
      const { password, ...userWithoutPassword } = result;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * SuperAdmins see platform-wide stats; Admins see company-specific stats.
   */
  public async getStats(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const currentUser = (req as any).user;
      // SECURITY (C2): non-superAdmin admins are ALWAYS scoped to their own
      // company — the query param is only honored for superAdmins. Otherwise
      // GET /users/stats leaks platform-wide (or foreign-company) counts.
      const companyId =
        currentUser?.role === "superAdmin"
          ? req.query.companyId
          : currentUser?.companyId;

      const knex = db("core");

      let query = knex("users");

      if (companyId) {
        const company = await this._companyDAO.getByUuid(companyId as string);
        if (company && company.id) {
          query = query.where("companyId", company.id);
        } else if (currentUser?.role !== "superAdmin") {
          // Unresolvable own-company: fail closed rather than platform-wide.
          res
            .status(400)
            .json({ success: false, message: "Company not found" });
          return;
        }
      } else if (currentUser?.role !== "superAdmin") {
        res.status(400).json({ success: false, message: "Company not found" });
        return;
      }

      const [totalResult, activeResult] = await Promise.all([
        query.clone().count("* as count").first(),
        query.clone().where("isActive", true).count("* as count").first(),
      ]);

      const roleResults = await query
        .clone()
        .select("role")
        .count("* as count")
        .groupBy("role");

      // "Recent" = last 30 days.
      // The invitations table uses snake_case timestamps (created_at), unlike most tables.
      let invitationQuery = knex("invitations").where(
        "created_at",
        ">=",
        knex.raw("NOW() - INTERVAL '30 days'"),
      );

      if (companyId) {
        const company = await this._companyDAO.getByUuid(companyId as string);
        if (company && company.id) {
          invitationQuery = invitationQuery.where("companyId", company.id);
        }
      }

      const recentInvitationsResult = await invitationQuery
        .count("* as count")
        .first();

      const stats = {
        totalUsers: parseInt(totalResult?.count as string) || 0,
        activeUsers: parseInt(activeResult?.count as string) || 0,
        usersByRole: roleResults.map((r: any) => ({
          role: r.role,
          count: parseInt(r.count as string) || 0,
        })),
        recentInvitations:
          parseInt(recentInvitationsResult?.count as string) || 0,
      };

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async invite(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const currentUser = (req as any).user;

      if (!currentUser) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      if (!data.email || !data.role) {
        res.status(400).json({
          success: false,
          message: "Email and role are required",
        });
        return;
      }

      const inviter = await this._userDAO.getByUuid(currentUser.userId);
      if (!inviter || !inviter.id) {
        res.status(400).json({
          success: false,
          message: "Invalid user session",
        });
        return;
      }

      let targetCompanyId: number | undefined;

      if (data.companyId) {
        const isNumeric = /^\d+$/.test(data.companyId);

        if (isNumeric) {
          targetCompanyId = parseInt(data.companyId, 10);
        } else {
          const company = await this._companyDAO.getByUuid(data.companyId);
          if (!company || !company.id) {
            res.status(400).json({
              success: false,
              message: "Invalid company ID",
            });
            return;
          }
          targetCompanyId = company.id;
        }
      } else if (inviter.companyId) {
        targetCompanyId = inviter.companyId;
      }

      if (!targetCompanyId && data.role !== "superAdmin") {
        res.status(400).json({
          success: false,
          message: "Company ID is required for non-SuperAdmin users",
        });
        return;
      }

      const token = crypto.randomBytes(32).toString("hex");

      // Invitations expire 7 days after creation.
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitationData: IInvitation = {
        uuid: uuidv4(),
        email: data.email,
        token: token,
        role: data.role as "member" | "admin" | "superAdmin",
        companyId: targetCompanyId,
        invitedBy: inviter.id,
        expiresAt: expiresAt,
        isUsed: false,
      };

      const result = await this._invitationDAO.create(invitationData);

      // Tradeoff: we swallow email failures so the inviter sees success — they can resend via UI
      // if the mail never arrived. Under P1 the invitation row is NOT committed yet (the request's
      // ambient transaction commits at response end), but swallowing is still correct: an SES
      // failure is not a database error, so it never aborts the transaction, and the row lands on
      // the 201. Decision D2 kept this route armed rather than detached, so the invitation is
      // covered by the request's audit context.
      try {
        let companyName = "Mobius";
        if (targetCompanyId) {
          const company = await this._companyDAO.getById(targetCompanyId);
          if (company) {
            companyName = company.name;
          }
        }

        await this._emailService.sendInvitationEmail(
          data.email,
          companyName,
          data.role as "member" | "admin",
          token,
          data.firstName,
        );
        console.log(`✓ Invitation email sent to ${data.email}`);
      } catch (emailError: any) {
        console.error("Failed to send invitation email:", emailError.message);
      }

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }
}
