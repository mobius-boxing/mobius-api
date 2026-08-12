import { Request, Response, NextFunction } from "express";
import { UserDAO } from "../../dao/user/user.dao";
import { InvitationDAO } from "../../dao/invitation/invitation.dao";
import { EmailTokenDAO } from "../../dao/email-token/email-token.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { IUser } from "../../interfaces/user/user.interfaces";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { getAllowedOrigins } from "../../common/config/origins/origins.config";
import {
  LoginInputDTO,
  RegisterInputDTO,
  ChangePasswordDTO,
  PasswordResetRequestDTO,
  PasswordResetDTO,
} from "../../dto/input/auth";
import { EmailService } from "../../services/email.service";
import { generateToken } from "../../middlewares/auth.middleware";
import { validatePassword, BCRYPT_COST } from "../../utils/passwordPolicy";

export class AuthController {
  private _userDAO: UserDAO = new UserDAO();
  private _invitationDAO: InvitationDAO = new InvitationDAO();
  private _emailTokenDAO: EmailTokenDAO = new EmailTokenDAO();
  private _companyModuleDAO: CompanyModuleDAO = new CompanyModuleDAO();
  private _emailService: EmailService = new EmailService();

  public async register(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      const inputDTO = new RegisterInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const invitation = await this._invitationDAO.getByToken(
        inputDTO.invitationToken,
      );
      if (!invitation) {
        res.status(400).json({
          success: false,
          message: "Invalid invitation token",
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

      const userToCreate: IUser = {
        email: inputDTO.email,
        password: hashedPassword,
        firstName: inputDTO.firstName,
        lastName: inputDTO.lastName,
        role: invitation.role,
        companyId: invitation.companyId,
        isActive: true,
        emailVerified: false,
      };

      const user = await this._userDAO.create(userToCreate);

      if (invitation.id) {
        await this._invitationDAO.update(invitation.id, {
          isUsed: true,
          acceptedAt: new Date(),
        });
      }

      // SECURITY: strip password hash before sending to client.
      const { password: _, ...userWithoutPassword } = user;

      res.status(201).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async login(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      const inputDTO = new LoginInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const userWithCompany = await this._userDAO.getUserByEmailWithCompany(
        inputDTO.email,
      );
      if (!userWithCompany) {
        res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
        return;
      }

      if (!userWithCompany.isActive) {
        res.status(403).json({
          success: false,
          message: "Account is inactive",
        });
        return;
      }

      // getUserByEmailWithCompany omits the password column; refetch the raw row for bcrypt compare.
      const userFull = await this._userDAO.getUserByEmail(inputDTO.email);
      if (!userFull) {
        res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        inputDTO.password,
        userFull.password,
      );
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
        return;
      }

      // Enrich JWT + response with enabled module slugs for the user's company.
      // SuperAdmin has no companyId → modules: [].
      const enabledModules = userWithCompany.companyId
        ? await this._companyModuleDAO.getEnabledSlugsByCompany(
            userWithCompany.companyId,
          )
        : [];

      // SECURITY (H1): generateToken fails closed if JWT_SECRET is unset (no `|| ""` fallback).
      const token = generateToken({
        id: userWithCompany.uuid,
        email: userWithCompany.email,
        role: userWithCompany.role,
        companyId: userWithCompany.company?.uuid,
        modules: enabledModules,
      });

      // RBAC permission codes — same enrichment as /me so usePermissions works
      // immediately after login without a full-page reload. Fail-soft.
      let permissions: string[] = [];
      try {
        const { RbacService } = await import("../../services/rbac.service");
        permissions = await RbacService.permissionCodesForUserUuid(
          userWithCompany.uuid!,
        );
      } catch (err) {
        console.error("Failed to load permissions for login:", err);
        permissions = [];
      }

      // SECURITY: expose only the company UUID; never leak the internal numeric id to the client.
      const { company, ...userWithoutCompany } = userWithCompany;
      const userResponse = {
        ...userWithoutCompany,
        companyId: company?.uuid || undefined,
        companyName: company?.name || undefined,
        modules: enabledModules,
        permissions,
      };

      res.status(200).json({
        success: true,
        data: {
          user: userResponse,
          token,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async getProfile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
        return;
      }

      const user = await this._userDAO.getByUuid(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Enrich /me with enabled module slugs. Fail-soft: existing clients that
      // ignore `modules` keep working even if the DAO ever throws.
      let modules: string[] = [];
      try {
        if (user.companyId) {
          modules = await this._companyModuleDAO.getEnabledSlugsByCompany(
            user.companyId,
          );
        }
      } catch (err) {
        console.error("Failed to load enabled modules for /me:", err);
        modules = [];
      }

      // Enrich /me with RBAC permission codes (module 02). Fail-soft like modules.
      let permissions: string[] = [];
      try {
        const { RbacService } = await import("../../services/rbac.service");
        permissions = await RbacService.permissionCodesForUserUuid(userId);
      } catch (err) {
        console.error("Failed to load permissions for /me:", err);
        permissions = [];
      }

      // SECURITY: strip password hash before sending to client.
      const { password: _, ...userWithoutPassword } = user;

      // Expose the company as a UUID (consistent with the login response); the raw numeric
      // companyId is internal and is stripped from responses, so resolve the UUID here.
      const withCompany = await this._userDAO.getUserByEmailWithCompany(
        user.email,
      );

      res.status(200).json({
        success: true,
        data: {
          ...userWithoutPassword,
          companyId: withCompany?.company?.uuid,
          companyName: withCompany?.company?.name,
          modules,
          permissions,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async changePassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const data = req.body;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
        return;
      }

      const inputDTO = new ChangePasswordDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const user = await this._userDAO.getByUuid(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        inputDTO.currentPassword,
        user.password,
      );
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          message: "Current password is incorrect",
        });
        return;
      }

      // SECURITY (M4): enforce password policy + raised bcrypt cost.
      const policy = validatePassword(inputDTO.newPassword);
      if (!policy.valid) {
        res.status(400).json({
          success: false,
          message: policy.message,
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(
        inputDTO.newPassword,
        BCRYPT_COST,
      );

      // BUGFIX: UserDAO.update expects the numeric id; passing the JWT UUID updated 0 rows
      // (change-password silently no-op'd). Use the resolved numeric id.
      await this._userDAO.update(user.id!, { password: hashedPassword });

      res.status(200).json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Accept invitation; returns the new user plus a JWT for auto-login.
   */
  public async acceptInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      const { firstName, lastName, password } = req.body;

      if (!firstName || !lastName || !password) {
        res.status(400).json({
          success: false,
          message: "First name, last name, and password are required",
        });
        return;
      }

      const invitation = await this._invitationDAO.getByToken(token);
      if (!invitation) {
        res.status(400).json({
          success: false,
          message: "Invalid invitation token",
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

      const existingUser = await this._userDAO.getUserByEmail(invitation.email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
        return;
      }

      // SECURITY (M4): enforce password policy + raised bcrypt cost.
      const policy = validatePassword(password);
      if (!policy.valid) {
        res.status(400).json({
          success: false,
          message: policy.message,
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

      const userToCreate: IUser = {
        uuid: uuidv4(),
        email: invitation.email,
        password: hashedPassword,
        firstName,
        lastName,
        role: invitation.role,
        companyId: invitation.companyId,
        isActive: true,
        emailVerified: false,
      };

      const user = await this._userDAO.create(userToCreate);

      if (invitation.id) {
        await this._invitationDAO.update(invitation.id, {
          isUsed: true,
          acceptedAt: new Date(),
        });
      }

      const userWithCompany = await this._userDAO.getUserByEmailWithCompany(
        invitation.email,
      );

      // Enrich JWT + response with enabled module slugs for the invited user's
      // company. Invitation.companyId is the numeric column on the invitation row.
      const enabledModules = invitation.companyId
        ? await this._companyModuleDAO.getEnabledSlugsByCompany(
            invitation.companyId,
          )
        : [];

      // SECURITY (H1): generateToken fails closed if JWT_SECRET is unset (no `|| ""` fallback).
      const authToken = generateToken({
        id: userWithCompany?.uuid || user.uuid,
        email: user.email,
        role: user.role,
        companyId: userWithCompany?.company?.uuid,
        modules: enabledModules,
      });

      // SECURITY: expose only the company UUID; never leak the internal numeric id to the client.
      const { password: _, ...userWithoutPassword } = user;
      const userResponse = {
        ...userWithoutPassword,
        companyId: userWithCompany?.company?.uuid,
        companyName: userWithCompany?.company?.name,
        modules: enabledModules,
      };

      res.status(200).json({
        success: true,
        data: {
          user: userResponse,
          token: authToken,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async requestPasswordReset(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      const inputDTO = new PasswordResetRequestDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const user = await this._userDAO.getUserByEmail(inputDTO.email);
      if (!user || !user.id) {
        // SECURITY: always return the same 200 so attackers can't enumerate registered emails.
        res.status(200).json({
          success: true,
          message: "If the email exists, a reset link will be sent",
        });
        return;
      }

      const token = crypto.randomBytes(32).toString("hex");

      // Password-reset tokens expire after 1 hour.
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      await this._emailTokenDAO.create({
        uuid: uuidv4(),
        userId: user.id,
        token: token,
        type: "password_reset",
        expiresAt: expiresAt,
        isUsed: false,
      });

      // Return the reset link to the app that initiated the request (web app vs backoffice),
      // but only when its Origin is in our allowlist — never trust an arbitrary Origin (open-redirect).
      const origin = req.headers.origin;
      const baseUrl =
        origin && getAllowedOrigins().includes(origin) ? origin : undefined;

      // Tradeoff: token row is already committed; swallow email failures so we still return the
      // same generic 200 response regardless of email success (preserves email-enumeration safety).
      try {
        await this._emailService.sendPasswordResetEmail(
          user.email,
          token,
          user.firstName,
          baseUrl,
        );
      } catch (emailError) {
        console.error("Error sending password reset email:", emailError);
      }

      res.status(200).json({
        success: true,
        message: "If the email exists, a reset link will be sent",
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async resetPassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      const inputDTO = new PasswordResetDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const emailToken = await this._emailTokenDAO.getByToken(inputDTO.token);
      if (!emailToken) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
        return;
      }

      if (new Date(emailToken.expiresAt) < new Date()) {
        res.status(400).json({
          success: false,
          message: "Reset token has expired",
        });
        return;
      }

      if (emailToken.isUsed) {
        res.status(400).json({
          success: false,
          message: "Reset token has already been used",
        });
        return;
      }

      // SECURITY: same table is used for several token types; reject anything but password_reset.
      if (emailToken.type !== "password_reset") {
        res.status(400).json({
          success: false,
          message: "Invalid token type",
        });
        return;
      }

      // SECURITY (M4): enforce password policy + raised bcrypt cost.
      const policy = validatePassword(inputDTO.newPassword);
      if (!policy.valid) {
        res.status(400).json({
          success: false,
          message: policy.message,
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(
        inputDTO.newPassword,
        BCRYPT_COST,
      );

      await this._userDAO.update(emailToken.userId, {
        password: hashedPassword,
      });

      if (emailToken.id) {
        await this._emailTokenDAO.update(emailToken.id, {
          isUsed: true,
        });
      }

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (err: any) {
      next(err);
    }
  }
}
