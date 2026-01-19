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
   * Get all users with pagination, filtering, sorting, and search
   * SuperAdmins see all users, Admins see only users from their company
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (email, firstName, lastName, role, isActive, createdAt, updatedAt)
   * - email: Filter by email (ILIKE)
   * - firstName: Filter by first name (ILIKE)
   * - lastName: Filter by last name (ILIKE)
   * - role: Filter by role (exact match)
   * - companyId: Filter by company ID
   * - isActive: Filter by active status (boolean)
   * - emailVerified: Filter by email verified status (boolean)
   * - search: Full-text search on email, firstName, lastName
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
        // SuperAdmin sees all users
        result = await this._userDAO.getAllWithFilters(req);
      } else {
        // Admin sees only users from their company
        const adminUser = await this._userDAO.getByUuid(currentUser.userId);
        if (!adminUser || !adminUser.companyId) {
          res.status(403).json({
            success: false,
            message: "Admin user must be assigned to a company",
          });
          return;
        }
        // For non-superAdmin, still use getAllWithFilters but the company filter
        // will be applied by the DAO based on companyId in the query
        // For now, fall back to getAllByCompany for company-scoped users
        const { page = 1, limit = 20 } = req.query;
        result = await this._userDAO.getAllByCompany(
          adminUser.companyId,
          Number(page),
          Number(limit),
        );
      }

      // Remove passwords from all users
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
   * Get user by UUID
   */
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

      // Remove password from response
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
   * Create a new user
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new UserCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Check if user already exists
      const existingUser = await this._userDAO.getUserByEmail(inputDTO.email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
        return;
      }

      // Hash password
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

      // Remove password from response
      const { password, ...userWithoutPassword } = result;

      res.status(201).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update user by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get user by UUID to find its ID
      const existing = await this._userDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Handle empty string companyId (e.g., superadmin with no company selected)
      // Convert empty string to undefined so it doesn't get processed
      if (data.companyId === '' || data.companyId === null) {
        data.companyId = undefined;
      }

      // Convert companyId from UUID to numeric ID if provided
      if (data.companyId !== undefined) {
        const isNumeric = /^\d+$/.test(String(data.companyId));
        if (!isNumeric) {
          // It's a UUID - convert to numeric ID
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

      // Validate input using DTO
      const inputDTO = new UserUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Hash password if being updated
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

      // Remove password from response
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
   * Delete user by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get user by UUID to find its ID
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

  /**
   * Get user with company details
   */
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

  /**
   * Get user by email
   */
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

      // Remove password from response
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
   * Invite a user (creates an invitation)
   */
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

      // Validate required fields
      if (!data.email || !data.role) {
        res.status(400).json({
          success: false,
          message: "Email and role are required",
        });
        return;
      }

      // Get the current user's ID (numeric) from UUID
      const inviter = await this._userDAO.getByUuid(currentUser.userId);
      if (!inviter || !inviter.id) {
        res.status(400).json({
          success: false,
          message: "Invalid user session",
        });
        return;
      }

      // Determine companyId - handle UUID to numeric ID conversion
      let targetCompanyId: number | undefined;

      if (data.companyId) {
        // Check if it's already a numeric ID or a UUID
        const isNumeric = /^\d+$/.test(data.companyId);

        if (isNumeric) {
          // Already a numeric ID, use it directly
          targetCompanyId = parseInt(data.companyId, 10);
        } else {
          // It's a UUID - convert to numeric ID
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
        // Use inviter's company (for non-SuperAdmin users)
        targetCompanyId = inviter.companyId;
      }

      // Validate company ID is present for non-SuperAdmin roles
      if (!targetCompanyId && data.role !== "superAdmin") {
        res.status(400).json({
          success: false,
          message: "Company ID is required for non-SuperAdmin users",
        });
        return;
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString("hex");

      // Set expiration (default 7 days from now)
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

      // Send invitation email
      try {
        // Get company name for the email
        let companyName = "Mobius";
        if (targetCompanyId) {
          const company = await this._companyDAO.getById(targetCompanyId);
          if (company) {
            companyName = company.name;
          }
        }

        // Send the invitation email
        await this._emailService.sendInvitationEmail(
          data.email,
          companyName,
          data.role as "member" | "admin",
          token,
          data.firstName,
        );
        console.log(`✓ Invitation email sent to ${data.email}`);
      } catch (emailError: any) {
        // Log error but don't fail the invitation creation
        console.error("Failed to send invitation email:", emailError.message);
        // Invitation was created successfully, so we still return success
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
