import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { UserDAO } from "../../dao/user/user.dao";
import { IUser } from "../../interfaces/user/user.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserCreateInputDTO, UserUpdateInputDTO } from "../../dto/input/user";
import { InvitationDAO } from "../../dao/invitation/invitation.dao";
import { IInvitation } from "../../interfaces/invitation/invitation.interfaces";
import { CompanyDAO } from "../../dao/company/company.dao";
import crypto from "crypto";
import { EmailService } from "../../services/email.service";

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

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._userDAO.getByUuid(uuid);

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

      const hashedPassword = await bcrypt.hash(inputDTO.password, 10);

      const dataToCreate: IUser = {
        uuid: uuidv4(),
        email: inputDTO.email,
        password: hashedPassword,
        firstName: inputDTO.firstName,
        lastName: inputDTO.lastName,
        role: inputDTO.role as "member" | "admin" | "superAdmin",
        companyId: inputDTO.companyId,
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

      const existing = await this._userDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Empty string from a superadmin "no company selected" UI must clear, not 400 on UUID parse.
      if (data.companyId === '' || data.companyId === null) {
        data.companyId = undefined;
      }

      if (data.companyId !== undefined) {
        const isNumeric = /^\d+$/.test(String(data.companyId));
        if (!isNumeric) {
          const company = await this._companyDAO.getByUuid(data.companyId);
          if (!company || !company.id) {
            res.status(400).json({
              success: false,
              message: "Invalid company ID",
            });
            return;
          }
          data.companyId = company.id;
        }
      }

      const inputDTO = new UserUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const updateData: any = { ...inputDTO };
      if (inputDTO.password !== undefined) {
        updateData.password = await bcrypt.hash(inputDTO.password, 10);
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

      if (!result) {
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
      const { companyId } = req.query;

      const knex = require("../../database/KnexConnection").default.getConnection();

      let query = knex("users");

      if (companyId) {
        const company = await this._companyDAO.getByUuid(companyId as string);
        if (company && company.id) {
          query = query.where("companyId", company.id);
        }
      }

      const [totalResult, activeResult] = await Promise.all([
        query.clone().count("* as count").first(),
        query.clone().where("isActive", true).count("* as count").first(),
      ]);

      const roleResults = await query.clone()
        .select("role")
        .count("* as count")
        .groupBy("role");

      // "Recent" = last 30 days.
      let invitationQuery = knex("invitations")
        .where("createdAt", ">=", knex.raw("NOW() - INTERVAL '30 days'"));

      if (companyId) {
        const company = await this._companyDAO.getByUuid(companyId as string);
        if (company && company.id) {
          invitationQuery = invitationQuery.where("companyId", company.id);
        }
      }

      const recentInvitationsResult = await invitationQuery.count("* as count").first();

      const stats = {
        totalUsers: parseInt(totalResult?.count as string) || 0,
        activeUsers: parseInt(activeResult?.count as string) || 0,
        usersByRole: roleResults.map((r: any) => ({
          role: r.role,
          count: parseInt(r.count as string) || 0,
        })),
        recentInvitations: parseInt(recentInvitationsResult?.count as string) || 0,
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

      // Tradeoff: invitation row is already committed; we swallow email failures so the inviter
      // sees success and we don't have to roll back. They can resend via UI if the email never arrived.
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
