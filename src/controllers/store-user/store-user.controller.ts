import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { IBaseController } from "../../types.d";
import { StoreUserDAO } from "../../dao/store-user/store-user.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { UserDAO } from "../../dao/user/user.dao";
import {
  IStoreUser,
  IStoreUserInternal,
} from "../../interfaces/store-user/store-user.interfaces";
import {
  StoreUserCreateInputDTO,
  StoreUserUpdateInputDTO,
  StoreUserAdminPasswordDTO,
  StoreUserStatusDTO,
} from "../../dto/input/storeUser";
import {
  getCompanyForCreate,
  getCompanyScope,
  enforceCompanyFilter,
} from "../../utils/companyScope";
import { EmailService } from "../../services/email.service";

// Invitation tokens live for 72 hours.
const INVITE_TTL_HOURS = 72;
// Minimum admin-set password length.
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class StoreUserController implements IBaseController {
  private _dao = new StoreUserDAO();
  private _companyDAO = new CompanyDAO();
  private _userDAO = new UserDAO();
  private _email = new EmailService();

  // ---- helpers ----------------------------------------------------------

  /**
   * Resolve the numeric companyId of the caller's target company.
   * superAdmin → query/body companyId UUID; admin → JWT company UUID.
   * Uses getCompanyScope (NOT getCompanyForCreate) so the read precedence matches
   * requireModule exactly — sub-resource mutations (password/status/resend) pass
   * companyId via the query string, which getCompanyForCreate would miss.
   * Returns null if no company context or the UUID does not resolve.
   */
  private async resolveCompanyId(req: Request): Promise<number | null> {
    const scope = getCompanyScope(req);
    if (!scope.companyUuid) return null;
    return this._companyDAO.getIdByUuid(scope.companyUuid);
  }

  /**
   * SECURITY: cross-tenant guard. The custom store-user routes bypass
   * BaseCrudController's implicit scoping, so we must verify the fetched record
   * belongs to the caller's target company. Mismatch → caller gets a 404 (never
   * leak existence across tenants).
   */
  private async assertSameCompany(
    req: Request,
    record: IStoreUser,
  ): Promise<boolean> {
    const targetCompanyId = await this.resolveCompanyId(req);
    if (targetCompanyId === null) return false;
    return record.companyId === targetCompanyId;
  }

  // Belt-and-suspenders: the DAO mapper already omits passwordHash /
  // invitationToken, but never trust a single layer for secrets.
  private strip(u: any): IStoreUser {
    if (!u) return u;
    const { passwordHash, invitationToken, ...rest } = u;
    return rest as IStoreUser;
  }

  // ---- CRUD -------------------------------------------------------------

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result = await this._dao.getAllWithFilters(req);
      // DAO mapper omits secrets; strip again defensively on each row.
      const sanitized = {
        ...result,
        data: result.data.map((u) => this.strip(u)),
      };
      res.status(200).json(sanitized);
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
      const record = await this._dao.getByUuid(uuid);
      if (!record) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      if (!(await this.assertSameCompany(req, record))) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      res.status(200).json({ success: true, data: this.strip(record) });
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
      const inputDTO = new StoreUserCreateInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      if (
        typeof inputDTO.email !== "string" ||
        !EMAIL_REGEX.test(inputDTO.email)
      ) {
        res.status(400).json({
          success: false,
          message: "A valid email is required.",
        });
        return;
      }

      if (
        inputDTO.password !== undefined &&
        (typeof inputDTO.password !== "string" ||
          inputDTO.password.length < MIN_PASSWORD_LENGTH)
      ) {
        res.status(400).json({
          success: false,
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }

      // Resolve target company.
      const companyResult = getCompanyForCreate(req);
      if (!companyResult.success) {
        res.status(400).json({ success: false, message: companyResult.message });
        return;
      }
      const companyId = await this._companyDAO.getIdByUuid(
        companyResult.companyUuid,
      );
      if (!companyId) {
        res.status(400).json({ success: false, message: "Company not found" });
        return;
      }

      // Uniqueness (companyId, email).
      const existing = await this._dao.getByEmail(companyId, inputDTO.email);
      if (existing) {
        res.status(400).json({
          success: false,
          message: "A store user with this email already exists for this company.",
        });
        return;
      }

      // Resolve inviter numeric id from JWT (userId is the staff user's UUID).
      const invitedBy = await this._userDAO.getIdByUuid(
        (req as any).user?.userId,
      );

      const hasPassword =
        typeof inputDTO.password === "string" && inputDTO.password.length > 0;

      const basePayload: IStoreUserInternal = {
        uuid: uuidv4(),
        companyId,
        email: inputDTO.email,
        firstName: inputDTO.firstName ?? null,
        lastName: inputDTO.lastName ?? null,
        isActive: true,
        emailVerified: hasPassword,
        invitedBy: invitedBy ?? null,
      };

      let created: IStoreUser;
      if (hasPassword) {
        // Admin-set-password path → active, verified user.
        const passwordHash = await bcrypt.hash(inputDTO.password as string, 10);
        created = await this._dao.create({ ...basePayload, passwordHash });
      } else {
        // Invite path → generate token + expiry, persist, send email (fail-soft).
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + INVITE_TTL_HOURS);

        created = await this._dao.create({
          ...basePayload,
          invitationToken: token,
          invitationExpiresAt: expiresAt,
        });

        // Fail-soft: token is already persisted; swallow email failures so the
        // user is created regardless (admin can resend or set a password).
        try {
          await this._email.sendStoreInvitationEmail(
            inputDTO.email,
            token,
            inputDTO.firstName,
          );
        } catch (emailError) {
          console.error("Error sending store invitation email:", emailError);
        }
      }

      res.status(201).json({ success: true, data: this.strip(created) });
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
      const record = await this._dao.getByUuid(uuid);
      if (!record || !record.id) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      if (!(await this.assertSameCompany(req, record))) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }

      const inputDTO = new StoreUserUpdateInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Email-change uniqueness (excluding self).
      if (
        inputDTO.email !== undefined &&
        inputDTO.email.toLowerCase() !== record.email.toLowerCase()
      ) {
        if (!EMAIL_REGEX.test(inputDTO.email)) {
          res.status(400).json({
            success: false,
            message: "A valid email is required.",
          });
          return;
        }
        const clash = await this._dao.getByEmail(
          record.companyId as number,
          inputDTO.email,
        );
        if (clash && clash.id !== record.id) {
          res.status(400).json({
            success: false,
            message:
              "A store user with this email already exists for this company.",
          });
          return;
        }
      }

      const updated = await this._dao.update(record.id, inputDTO);
      res.status(200).json({ success: true, data: this.strip(updated) });
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
      const record = await this._dao.getByUuid(uuid);
      if (!record || !record.id) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      if (!(await this.assertSameCompany(req, record))) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }

      const deleted = await this._dao.delete(record.id);
      if (deleted) {
        res
          .status(200)
          .json({ success: true, message: "Store user deleted successfully" });
      } else {
        res
          .status(404)
          .json({ success: false, message: "Failed to delete store user" });
      }
    } catch (err: any) {
      next(err);
    }
  }

  // ---- custom verbs -----------------------------------------------------

  public async setPassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const inputDTO = new StoreUserAdminPasswordDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }
      if (
        typeof inputDTO.password !== "string" ||
        inputDTO.password.length < MIN_PASSWORD_LENGTH
      ) {
        res.status(400).json({
          success: false,
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }

      const record = await this._dao.getByUuid(uuid);
      if (!record || !record.id) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      if (!(await this.assertSameCompany(req, record))) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }

      const passwordHash = await bcrypt.hash(inputDTO.password, 10);
      // setPassword also clears any pending invitation token/expiry.
      await this._dao.setPassword(record.id, passwordHash);
      // Mark verified now that a password exists.
      await this._dao.update(record.id, { emailVerified: true });

      res.status(200).json({ success: true, message: "Password updated." });
    } catch (err: any) {
      next(err);
    }
  }

  public async resendInvite(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const record = await this._dao.getByUuid(uuid);
      if (!record || !record.id) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      if (!(await this.assertSameCompany(req, record))) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }

      // If the user already verified (i.e. set a password), resending an invite is
      // pointless. Flag for review — kept as a 400 to avoid dead invites.
      if (record.emailVerified) {
        res.status(400).json({
          success: false,
          message: "User has already set a password.",
        });
        return;
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + INVITE_TTL_HOURS);
      await this._dao.setInvitation(record.id, token, expiresAt);

      // Fail-soft: token persisted regardless of email outcome.
      try {
        await this._email.sendStoreInvitationEmail(
          record.email,
          token,
          record.firstName ?? undefined,
        );
      } catch (emailError) {
        console.error("Error sending store invitation email:", emailError);
      }

      res.status(200).json({ success: true, message: "Invitation resent." });
    } catch (err: any) {
      next(err);
    }
  }

  public async setStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const inputDTO = new StoreUserStatusDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }
      if (typeof inputDTO.isActive !== "boolean") {
        res.status(400).json({
          success: false,
          message: "isActive must be a boolean.",
        });
        return;
      }

      const record = await this._dao.getByUuid(uuid);
      if (!record || !record.id) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }
      if (!(await this.assertSameCompany(req, record))) {
        res.status(404).json({ success: false, message: "Store user not found" });
        return;
      }

      const updated = await this._dao.update(record.id, {
        isActive: inputDTO.isActive,
      });
      res.status(200).json({ success: true, data: this.strip(updated) });
    } catch (err: any) {
      next(err);
    }
  }
}
