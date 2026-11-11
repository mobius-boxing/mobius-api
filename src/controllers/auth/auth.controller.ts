import { Request, Response, NextFunction } from "express";
import { UserDAO } from "../../dao/user/user.dao";
import { InvitationDAO } from "../../dao/invitation/invitation.dao";
import { EmailTokenDAO } from "../../dao/email-token/email-token.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { UserDeviceDAO } from "../../dao/user-device/user-device.dao";
import {
  parseRefreshToken,
  RefreshSessionDAO,
  SessionLifetimes,
} from "../../dao/refresh-session/refresh-session.dao";
import {
  IRefreshSession,
  RefreshOutcome,
} from "../../interfaces/refresh-session/refresh-session.interfaces";
import {
  IUser,
  IUserWithCompany,
} from "../../interfaces/user/user.interfaces";
import { IDeviceSession } from "../../interfaces/user-device/user-device.interfaces";
import { getAuthConfig } from "../../common/config/auth/auth.config";
import {
  clearRefreshCookie,
  readRefreshCookie,
  secondsUntil,
  setRefreshCookie,
} from "../../utils/cookies";
import * as jwt from "jsonwebtoken";
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
import {
  generateToken,
  sessionIdOf,
} from "../../middlewares/auth.middleware";
import {
  issueOrReuseDevice,
  toDeviceSession,
} from "../../services/device.service";
import { validatePassword, BCRYPT_COST } from "../../utils/passwordPolicy";
import {
  AvatarValidationError,
  UserAvatarService,
} from "../../services/user-avatar.service";

type AuthSessionData = {
  user: Record<string, unknown>;
  token: string;
  expiresIn: number;
  device: IDeviceSession | null;
};

type OpenedSession =
  | { ok: true; session: IRefreshSession; rawToken: string }
  | { ok: false; reason: "inactive" | "password_changed" };

type RefreshResult =
  | { kind: "ok"; outcome: RefreshOutcome & { kind: "rotated" | "grace" } }
  | { kind: "invalid" }
  | { kind: "revoked" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CSRF_HEADER = "x-requested-with";
const CSRF_VALUE = "mobius";

const hasCsrfHeader = (req: Request): boolean =>
  req.headers[CSRF_HEADER] === CSRF_VALUE;

const sendCsrfRequired = (res: Response): void => {
  res.status(403).json({
    success: false,
    code: "CSRF_HEADER_REQUIRED",
    message: "The X-Requested-With header is required.",
  });
};

// INV-20: a cross-site HTML form cannot send application/json without a CORS
// preflight, so requiring it stops login CSRF through the global urlencoded parser.
const isJsonRequest = (req: Request): boolean =>
  (req.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase() === "application/json";

const sendJsonRequired = (res: Response): void => {
  res.status(415).json({
    success: false,
    code: "JSON_REQUIRED",
    message: "Content-Type must be application/json.",
  });
};

const lifetimes = (): SessionLifetimes => {
  const config = getAuthConfig();
  return {
    idleSeconds: config.refreshIdleTtlSeconds,
    absoluteSeconds: config.refreshAbsoluteTtlSeconds,
    graceSeconds: config.refreshGraceSeconds,
  };
};

export class AuthController {
  private _userDAO: UserDAO = new UserDAO();
  private _invitationDAO: InvitationDAO = new InvitationDAO();
  private _emailTokenDAO: EmailTokenDAO = new EmailTokenDAO();
  private _companyModuleDAO: CompanyModuleDAO = new CompanyModuleDAO();
  private _emailService: EmailService = new EmailService();
  private _avatarService: UserAvatarService = new UserAvatarService();
  private _sessionDAO: RefreshSessionDAO = new RefreshSessionDAO();
  private _deviceDAO: UserDeviceDAO = new UserDeviceDAO();

  /**
   * The login/accept-invitation/refresh body, built in one place so all three
   * issue identical claims and the same user projection. `device` is the
   * caller's: login resolves it from the request, refresh from the session row.
   */
  private async buildSessionData(
    userWithCompany: IUserWithCompany,
    sid: string,
    device: IDeviceSession | null,
  ): Promise<AuthSessionData> {
    // SuperAdmin has no companyId -> modules: [].
    const enabledModules = userWithCompany.companyId
      ? await this._companyModuleDAO.getEnabledSlugsByCompany(
          userWithCompany.companyId,
        )
      : [];

    // SECURITY (H1): generateToken fails closed if JWT_SECRET is unset (no `|| ""` fallback).
    const token = generateToken({
      id: userWithCompany.uuid,
      sid,
      email: userWithCompany.email,
      role: userWithCompany.role,
      companyId: userWithCompany.company?.uuid,
      modules: enabledModules,
    });

    // RBAC permission codes — same enrichment as /me so usePermissions works
    // immediately after login without a full-page reload. Fail-soft.
    let permissions: string[] = [];
    let roleUuid: string | null = null;
    let roleName: string | null = null;
    try {
      const { RbacService } = await import("../../services/rbac.service");
      permissions = await RbacService.permissionCodesForUserUuid(
        userWithCompany.uuid!,
      );
      const roleInfo = await RbacService.roleForUserUuid(userWithCompany.uuid!);
      roleUuid = roleInfo?.roleUuid ?? null;
      roleName = roleInfo?.roleName ?? null;
    } catch (err) {
      console.error("Failed to load permissions for login:", err);
      permissions = [];
    }

    // SECURITY: expose only the company UUID; never leak the internal numeric id to the client.
    const { company, ...userWithoutCompany } = userWithCompany;
    return {
      user: {
        ...userWithoutCompany,
        companyId: company?.uuid || undefined,
        companyName: company?.name || undefined,
        modules: enabledModules,
        permissions,
        roleUuid,
        roleName,
      },
      token,
      expiresIn: getAuthConfig().accessTtlSeconds,
      device,
    };
  }

  /** `refresh_sessions.deviceId` is the numeric row id; the device service only hands out the uuid. */
  private async deviceRowId(
    device: IDeviceSession | null,
  ): Promise<number | null> {
    if (!device) return null;
    const row = await this._deviceDAO.getByUuid(device.uuid);
    return row?.id ?? null;
  }

  /**
   * Issues the session under the A-4 lock: the user row is locked and
   * rechecked against what the caller verified (still active, same password
   * hash), so a deactivation or password change that committed in between wins.
   * The device row is resolved by the caller BEFORE this runs: inserting a
   * `user_devices` row from another connection while this transaction holds the
   * user row `FOR UPDATE` would block on that row's FK lock and deadlock.
   */
  private async openSession(
    req: Request,
    user: { id: number; password: string },
    deviceId: number | null,
  ): Promise<OpenedSession> {
    const presented = parseRefreshToken(readRefreshCookie(req));
    return this._sessionDAO.transaction(async (trx): Promise<OpenedSession> => {
      const locked = await this._userDAO.lockForSessionChange(user.id, trx);
      if (!locked || !locked.isActive) return { ok: false, reason: "inactive" };
      if (locked.password !== user.password) {
        return { ok: false, reason: "password_changed" };
      }
      if (presented) {
        await this._sessionDAO.revokeByUuid(presented, "logout", trx);
      }
      await this._sessionDAO.deleteExpiredForUser(user.id, trx);
      const created = await this._sessionDAO.create(
        { userId: user.id, deviceId },
        lifetimes(),
        trx,
      );
      return { ok: true, ...created };
    });
  }

  private sendOpenedSession(
    res: Response,
    opened: Extract<OpenedSession, { ok: true }>,
    data: AuthSessionData,
  ): void {
    setRefreshCookie(
      res,
      opened.rawToken,
      secondsUntil(opened.session.expiresAt),
    );
    res.status(200).json({ success: true, data });
  }

  /**
   * Resolve the roleId + `users.role` mirror for a user created from an
   * invitation. Prefers `invitation.roleId` (set on every invitation created
   * after role management shipped); a historical invitation without one
   * falls back to the company's Admin/Member system role by legacy `role`
   * value. No companyId (a superAdmin invitation) leaves roleId unset —
   * superAdmin is never written by this path.
   */
  private async resolveInvitationRole(invitation: {
    roleId?: number | null;
    role: "member" | "admin" | "superAdmin";
    companyId?: number;
  }): Promise<{
    roleId: number | null;
    role: "member" | "admin" | "superAdmin";
  }> {
    if (!invitation.companyId) {
      return { roleId: null, role: invitation.role };
    }
    const { RbacService } = await import("../../services/rbac.service");
    let roleId = invitation.roleId ?? null;
    if (!roleId) {
      roleId = await RbacService.systemRoleId(
        invitation.companyId,
        invitation.role === "admin" ? "admin" : "member",
      );
    }
    if (!roleId) return { roleId: null, role: invitation.role };
    const systemKey = await RbacService.roleSystemKey(roleId);
    return { roleId, role: RbacService.mirrorRoleFor(systemKey) };
  }

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

      // roleId + mirror, from the invitation's own role (roleUuid at create
      // time) or a legacy-role fallback to the company's system roles.
      if (user.id) {
        const resolved = await this.resolveInvitationRole(invitation);
        if (resolved.roleId) {
          await this._userDAO.update(user.id, {
            roleId: resolved.roleId,
            role: resolved.role,
          });
        }
      }

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
      if (!isJsonRequest(req)) {
        sendJsonRequired(res);
        return;
      }
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

      const device = await issueOrReuseDevice(
        {
          id: userWithCompany.id,
          uuid: userWithCompany.uuid,
          role: userWithCompany.role,
        },
        req,
      );

      const opened = await this.openSession(
        req,
        { id: userWithCompany.id!, password: userFull.password },
        await this.deviceRowId(device),
      );
      if (!opened.ok) {
        res.status(opened.reason === "inactive" ? 403 : 401).json({
          success: false,
          message:
            opened.reason === "inactive"
              ? "Account is inactive"
              : "Invalid credentials",
        });
        return;
      }

      this.sendOpenedSession(
        res,
        opened,
        await this.buildSessionData(userWithCompany, opened.session.uuid, device),
      );
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Rotates the cookie's session and answers with a fresh access token. Never
   * clears the cookie on failure (A-3): a late 401 must not wipe a cookie that a
   * newer login just set. `Set-Cookie` is sent only when the token rotated.
   */
  public async refresh(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!hasCsrfHeader(req)) {
        sendCsrfRequired(res);
        return;
      }

      const rawToken = readRefreshCookie(req);
      const sessionUuid = parseRefreshToken(rawToken);
      if (!rawToken || !sessionUuid) {
        res.status(401).json({
          success: false,
          code: "REFRESH_INVALID",
          message: "Refresh token is missing or invalid.",
        });
        return;
      }

      let deviceRow: Awaited<ReturnType<UserDeviceDAO["getById"]>> = null;
      const result = await this._sessionDAO.transaction(
        async (trx): Promise<RefreshResult> => {
          // A-4: user row first, then the session row (inside dao.refresh).
          const alive = await this._sessionDAO.findAliveByUuid(
            sessionUuid,
            trx,
          );
          if (alive) {
            const locked = await this._userDAO.lockForSessionChange(alive.userId, trx);
            if (!locked || !locked.isActive) {
              await this._sessionDAO.revoke(alive.id, "user_deactivated", trx);
              return { kind: "revoked" };
            }
            if (alive.deviceId !== null) {
              deviceRow = await this._deviceDAO.getById(alive.deviceId);
              if (!deviceRow || deviceRow.status === "revoked") {
                await this._sessionDAO.revoke(alive.id, "device_revoked", trx);
                return { kind: "revoked" };
              }
            }
          }

          const outcome = await this._sessionDAO.refresh(
            rawToken,
            lifetimes(),
            trx,
          );
          if (outcome.kind === "invalid") return { kind: "invalid" };
          if (outcome.kind === "revoked") return { kind: "revoked" };
          return { kind: "ok", outcome };
        },
      );

      if (result.kind === "invalid") {
        res.status(401).json({
          success: false,
          code: "REFRESH_INVALID",
          message: "Refresh token is missing or invalid.",
        });
        return;
      }
      if (result.kind === "revoked") {
        res.status(401).json({
          success: false,
          code: "SESSION_REVOKED",
          message: "This session is no longer active.",
        });
        return;
      }

      const { outcome } = result;
      const user = await this._userDAO.getById(outcome.session.userId);
      const userWithCompany = user?.uuid
        ? await this._userDAO.getUserWithCompany(user.uuid)
        : null;
      if (!userWithCompany) {
        res.status(401).json({
          success: false,
          code: "SESSION_REVOKED",
          message: "This session is no longer active.",
        });
        return;
      }

      const body = await this.buildSessionData(
        userWithCompany,
        outcome.session.uuid,
        deviceRow ? toDeviceSession(deviceRow) : null,
      );
      if (outcome.kind === "rotated") {
        setRefreshCookie(
          res,
          outcome.rawToken,
          secondsUntil(outcome.session.expiresAt),
        );
      }
      res.status(200).json({ success: true, data: body });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Unauthenticated on purpose: it must work with an expired access token and
   * with no token at all. Always 200 and idempotent (INV-7).
   */
  public async logout(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!hasCsrfHeader(req)) {
        sendCsrfRequired(res);
        return;
      }

      let sid = parseRefreshToken(readRefreshCookie(req));
      const bearer = req.headers.authorization;
      if (!sid && bearer?.startsWith("Bearer ") && process.env.JWT_SECRET) {
        try {
          // An expired access token still names the session being signed out.
          const decoded = jwt.verify(bearer.substring(7), process.env.JWT_SECRET, {
            ignoreExpiration: true,
          }) as { sid?: unknown };
          sid =
            typeof decoded.sid === "string" && UUID_PATTERN.test(decoded.sid)
              ? decoded.sid
              : null;
        } catch {
          sid = null;
        }
      }
      if (sid) await this._sessionDAO.revokeByUuid(sid, "logout");

      clearRefreshCookie(res);
      res.status(200).json({ success: true, message: "Logged out" });
    } catch (err: any) {
      next(err);
    }
  }

  public async uploadAvatar(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const id = userId ? await this._userDAO.getIdByUuid(userId) : null;
      if (!id) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }
      const avatarUuid = await this._avatarService.set(id, req.file?.buffer);
      res.status(200).json({ success: true, data: { avatarUuid } });
    } catch (err: any) {
      if (err instanceof AvatarValidationError) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
      next(err);
    }
  }

  public async removeAvatar(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const id = userId ? await this._userDAO.getIdByUuid(userId) : null;
      if (!id) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }
      await this._avatarService.clear(id);
      res.status(200).json({ success: true, data: { avatarUuid: null } });
    } catch (err: any) {
      next(err);
    }
  }

  /** Names only (I-3): every other body field is ignored. */
  public async updateProfile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userUuid = (req as any).user?.userId;
      const id = userUuid ? await this._userDAO.getIdByUuid(userUuid) : null;
      if (!id) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }
      const firstName =
        typeof req.body?.firstName === "string"
          ? req.body.firstName.trim()
          : "";
      const lastName =
        typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
      if (
        !firstName ||
        !lastName ||
        firstName.length > 100 ||
        lastName.length > 100
      ) {
        res.status(400).json({
          success: false,
          message: "First and last name are required (1-100 characters).",
        });
        return;
      }
      await this._userDAO.update(id, { firstName, lastName });
      await this.getProfile(req, res, next);
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
      let roleUuid: string | null = null;
      let roleName: string | null = null;
      try {
        const { RbacService } = await import("../../services/rbac.service");
        permissions = await RbacService.permissionCodesForUserUuid(userId);
        const roleInfo = await RbacService.roleForUserUuid(userId);
        roleUuid = roleInfo?.roleUuid ?? null;
        roleName = roleInfo?.roleName ?? null;
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
          roleUuid,
          roleName,
          device: req.device ?? null,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * The waiting screen's poll (exempt from the gate, D-22). `req.device` is the
   * row as it stands now, so an admin's approval reaches the member on their
   * next poll. It can never carry `token`: the middleware resolves the row from
   * the hash and the secret is unrecoverable from it (I-2).
   */
  public getDevice(req: Request, res: Response): void {
    res.status(200).json({
      success: true,
      data: req.device ?? null,
    });
  }

  /**
   * "Register this browser" for an already-authenticated session (gate
   * amendment 3, D-230): the login procedure applied to `req.user` instead of
   * to fresh credentials. Exists because a member whose `mobius_session`
   * outlived a deploy never logs in again, so nothing would otherwise create
   * their pending row — the waiting screen calls this once on mount instead of
   * forcing a re-login. Exempt from the device gate; never 403, never 400 (no
   * input).
   *
   * The numeric id and the DB role are re-read here rather than trusted off
   * `req.user` (a JWT claim) for the same reason `authenticate` does not trust
   * `decoded.role` for the gate (I-5): `issueOrReuseDevice` must key the row
   * off `users.id` and must not gate/ungate a role the JWT merely asserts.
   */
  public async registerDevice(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userUuid = req.user?.userId;
      if (!userUuid) {
        res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
        return;
      }

      const user = await this._userDAO.getByUuid(userUuid);
      if (!user) {
        res.status(401).json({
          success: false,
          message: "User no longer exists.",
        });
        return;
      }

      const device = await issueOrReuseDevice(
        { id: user.id, uuid: user.uuid, role: user.role },
        req,
      );

      res.status(200).json({
        success: true,
        data: device,
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
      // A-4: lock, password update and revocation share one transaction. The
      // caller's own session keeps going.
      const outcome = await this._sessionDAO.transaction(async (trx) => {
        const locked = await this._userDAO.lockForSessionChange(user.id!, trx);
        if (!locked || locked.password !== user.password) return "stale";
        await this._userDAO.update(user.id!, { password: hashedPassword }, trx);
        await this._sessionDAO.revokeAllForUser(
          user.id!,
          "password_change",
          trx,
          sessionIdOf(req),
        );
        return "ok";
      });
      if (outcome === "stale") {
        res.status(409).json({
          success: false,
          message: "Password was changed concurrently. Please try again.",
        });
        return;
      }

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
      if (!isJsonRequest(req)) {
        sendJsonRequired(res);
        return;
      }
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

      // roleId + mirror, from the invitation's own role (roleUuid at create
      // time) or a legacy-role fallback to the company's system roles.
      if (user.id) {
        const resolved = await this.resolveInvitationRole(invitation);
        if (resolved.roleId) {
          await this._userDAO.update(user.id, {
            roleId: resolved.roleId,
            role: resolved.role,
          });
          user.role = resolved.role;
        }
      }

      if (invitation.id) {
        await this._invitationDAO.update(invitation.id, {
          isUsed: true,
          acceptedAt: new Date(),
        });
      }

      const userWithCompany = await this._userDAO.getUserByEmailWithCompany(
        invitation.email,
      );
      if (!userWithCompany) {
        throw new Error("invited user vanished after creation");
      }

      const device = await issueOrReuseDevice(
        { id: user.id, uuid: user.uuid, role: user.role },
        req,
      );

      const opened = await this.openSession(
        req,
        { id: user.id!, password: user.password },
        await this.deviceRowId(device),
      );
      if (!opened.ok) {
        res.status(403).json({
          success: false,
          message: "Account is inactive",
        });
        return;
      }

      this.sendOpenedSession(
        res,
        opened,
        await this.buildSessionData(userWithCompany, opened.session.uuid, device),
      );
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

      // Unauthenticated, so not in the request transaction: open one for the
      // lock, the new hash and the revocation (A-4).
      await this._sessionDAO.transaction(async (trx) => {
        await this._userDAO.lockForSessionChange(emailToken.userId, trx);
        await trx("users")
          .where({ id: emailToken.userId })
          .update({ password: hashedPassword, updatedAt: trx.fn.now() });
        await this._sessionDAO.revokeAllForUser(
          emailToken.userId,
          "password_reset",
          trx,
        );
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
