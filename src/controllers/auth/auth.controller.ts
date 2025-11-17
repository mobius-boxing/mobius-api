import { Request, Response, NextFunction } from "express";
import { UserDAO } from "../../dao/user/user.dao";
import { InvitationDAO } from "../../dao/invitation/invitation.dao";
import { EmailTokenDAO } from "../../dao/email-token/email-token.dao";
import { IUser } from "../../interfaces/user/user.interfaces";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import {
  LoginInputDTO,
  RegisterInputDTO,
  ChangePasswordDTO,
  PasswordResetRequestDTO,
  PasswordResetDTO,
} from "../../dto/input/auth";
import { EmailService } from "../../services/email.service";

export class AuthController {
  private _userDAO: UserDAO = new UserDAO();
  private _invitationDAO: InvitationDAO = new InvitationDAO();
  private _emailTokenDAO: EmailTokenDAO = new EmailTokenDAO();
  private _emailService: EmailService = new EmailService();

  /**
   * Register a new user
   */
  public async register(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new RegisterInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Validate invitation token
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

      // Check if invitation is expired
      if (new Date(invitation.expiresAt) < new Date()) {
        res.status(400).json({
          success: false,
          message: "Invitation has expired",
        });
        return;
      }

      // Check if invitation is already used
      if (invitation.isUsed) {
        res.status(400).json({
          success: false,
          message: "Invitation has already been used",
        });
        return;
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

      // Create user
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

      // Mark invitation as used
      if (invitation.id) {
        await this._invitationDAO.update(invitation.id, {
          isUsed: true,
          acceptedAt: new Date(),
        });
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.status(201).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Login user
   */
  public async login(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new LoginInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Find user by email with company information
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

      // Check if user is active
      if (!userWithCompany.isActive) {
        res.status(403).json({
          success: false,
          message: "Account is inactive",
        });
        return;
      }

      // Verify password (need to get full user with password for validation)
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

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET || "";
      const jwtExpire = process.env.JWT_EXPIRE || "24h";
      const token = jwt.sign(
        {
          userId: userWithCompany.uuid,
          email: userWithCompany.email,
          role: userWithCompany.role,
          companyId: userWithCompany.company?.uuid,
        },
        jwtSecret,
        { expiresIn: jwtExpire as string } as jwt.SignOptions,
      );

      // Prepare user response with companyName
      const { company, ...userWithoutCompany } = userWithCompany;
      const userResponse = {
        ...userWithoutCompany,
        companyName: company?.name || undefined,
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

  /**
   * Get current user profile
   */
  public async getProfile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // Assuming user is attached to request by auth middleware
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

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Change password
   */
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

      // Validate input using DTO
      const inputDTO = new ChangePasswordDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Get current user
      const user = await this._userDAO.getByUuid(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Verify current password
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

      // Hash new password
      const hashedPassword = await bcrypt.hash(inputDTO.newPassword, 10);

      // Update password
      await this._userDAO.update(userId, { password: hashedPassword });

      res.status(200).json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Accept invitation and create user with auto-login
   */
  public async acceptInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      const { firstName, lastName, password } = req.body;

      // Validate required fields
      if (!firstName || !lastName || !password) {
        res.status(400).json({
          success: false,
          message: "First name, last name, and password are required",
        });
        return;
      }

      // Validate invitation token
      const invitation = await this._invitationDAO.getByToken(token);
      if (!invitation) {
        res.status(400).json({
          success: false,
          message: "Invalid invitation token",
        });
        return;
      }

      // Check if invitation is expired
      if (new Date(invitation.expiresAt) < new Date()) {
        res.status(400).json({
          success: false,
          message: "Invitation has expired",
        });
        return;
      }

      // Check if invitation is already used
      if (invitation.isUsed) {
        res.status(400).json({
          success: false,
          message: "Invitation has already been used",
        });
        return;
      }

      // Check if user already exists
      const existingUser = await this._userDAO.getUserByEmail(invitation.email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
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

      // Mark invitation as used
      if (invitation.id) {
        await this._invitationDAO.update(invitation.id, {
          isUsed: true,
          acceptedAt: new Date(),
        });
      }

      // Get user with company information for token
      const userWithCompany = await this._userDAO.getUserByEmailWithCompany(
        invitation.email,
      );

      // Generate JWT token for auto-login
      const jwtSecret = process.env.JWT_SECRET || "";
      const jwtExpire = process.env.JWT_EXPIRE || "24h";
      const authToken = jwt.sign(
        {
          userId: userWithCompany?.uuid || user.uuid,
          email: user.email,
          role: user.role,
          companyId: userWithCompany?.company?.uuid,
        },
        jwtSecret,
        { expiresIn: jwtExpire as string } as jwt.SignOptions,
      );

      // Prepare user response with company info
      const { password: _, ...userWithoutPassword } = user;
      const userResponse = {
        ...userWithoutPassword,
        companyName: userWithCompany?.company?.name,
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

  /**
   * Request password reset
   */
  public async requestPasswordReset(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new PasswordResetRequestDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const user = await this._userDAO.getUserByEmail(inputDTO.email);
      if (!user || !user.id) {
        // Don't reveal if user exists
        res.status(200).json({
          success: true,
          message: "If the email exists, a reset link will be sent",
        });
        return;
      }

      // Generate reset token
      const token = crypto.randomBytes(32).toString("hex");

      // Set expiration (1 hour from now)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      // Create email token
      await this._emailTokenDAO.create({
        uuid: uuidv4(),
        userId: user.id,
        token: token,
        type: "password_reset",
        expiresAt: expiresAt,
        isUsed: false,
      });

      // Send password reset email
      try {
        await this._emailService.sendPasswordResetEmail(
          user.email,
          token,
          user.firstName,
        );
      } catch (emailError) {
        console.error("Error sending password reset email:", emailError);
        // Don't fail the request if email fails - token is still created
      }

      res.status(200).json({
        success: true,
        message: "If the email exists, a reset link will be sent",
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Reset password with token
   */
  public async resetPassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new PasswordResetDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Find the email token
      const emailToken = await this._emailTokenDAO.getByToken(inputDTO.token);
      if (!emailToken) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
        return;
      }

      // Check if token is expired
      if (new Date(emailToken.expiresAt) < new Date()) {
        res.status(400).json({
          success: false,
          message: "Reset token has expired",
        });
        return;
      }

      // Check if token is already used
      if (emailToken.isUsed) {
        res.status(400).json({
          success: false,
          message: "Reset token has already been used",
        });
        return;
      }

      // Check if token is for password reset
      if (emailToken.type !== "password_reset") {
        res.status(400).json({
          success: false,
          message: "Invalid token type",
        });
        return;
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(inputDTO.newPassword, 10);

      // Update user password
      await this._userDAO.update(emailToken.userId, {
        password: hashedPassword,
      });

      // Mark token as used
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
