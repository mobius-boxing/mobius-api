import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { StoreUserDAO } from "../../dao/store-user/store-user.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { StoreLoginInputDTO } from "../../dto/input/storeAuth";

const STORE_TOKEN_AUDIENCE = "store";

export class StoreAuthController {
  private _storeUserDAO = new StoreUserDAO();
  private _companyModuleDAO = new CompanyModuleDAO();

  /**
   * POST /api/store/auth/login — PUBLIC.
   * Authenticate a store user and issue a store-audience JWT.
   *
   * SECURITY: every failure mode (unknown email, wrong password, inactive user,
   * store module disabled) returns the SAME generic 401 — no enumeration.
   * The response is built explicitly; the internal row (carrying passwordHash) is
   * never spread into it.
   */
  public async login(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const inputDTO = new StoreLoginInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const invalid = () =>
        res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });

      // Candidates across companies (single store deployment serves many companies);
      // each row carries passwordHash + companyId (numeric) + companyUuid + companyName.
      const candidates = await this._storeUserDAO.getInternalByEmail(
        inputDTO.email,
      );
      if (!candidates || candidates.length === 0) {
        invalid();
        return;
      }

      let matched:
        | (typeof candidates)[number]
        | null = null;
      for (const c of candidates) {
        if (!c.isActive || !c.passwordHash) continue;
        if (await bcrypt.compare(inputDTO.password, c.passwordHash)) {
          matched = c;
          break;
        }
      }
      if (!matched || !matched.id || matched.companyId == null) {
        invalid();
        return;
      }

      // Confirm the store module is enabled for the matched user's company.
      // Generic 401 on disabled-module too (do NOT leak "module disabled").
      const enabled = await this._companyModuleDAO.isEnabled(
        matched.companyId as number,
        "store",
      );
      if (!enabled) {
        invalid();
        return;
      }

      // Best-effort last-login stamp; never block auth on it.
      try {
        await this._storeUserDAO.updateLastLogin(matched.id as number);
      } catch (e) {
        console.error("updateLastLogin failed (non-fatal):", e);
      }

      const secret = process.env.STORE_JWT_SECRET || process.env.JWT_SECRET;
      if (!secret) {
        throw new Error("STORE_JWT_SECRET / JWT_SECRET is not configured");
      }
      const expiresIn =
        process.env.STORE_JWT_EXPIRE || process.env.JWT_EXPIRE || "5h";

      const token = jwt.sign(
        {
          audience: STORE_TOKEN_AUDIENCE,
          storeUserId: matched.uuid,
          companyId: matched.companyUuid, // company UUID, mirrors internal JWT
          email: matched.email,
        },
        secret,
        { expiresIn } as jwt.SignOptions,
      );

      // SECURITY: build the response explicitly — NEVER spread the internal row
      // (it carries passwordHash / invitationToken).
      res.status(200).json({
        success: true,
        data: {
          token,
          storeUser: {
            uuid: matched.uuid,
            email: matched.email,
            firstName: matched.firstName ?? null,
            lastName: matched.lastName ?? null,
            isActive: matched.isActive ?? true,
            companyUuid: matched.companyUuid,
            companyName: matched.companyName,
          },
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /api/store/me — AUTHENTICATED (authenticateStore).
   * Returns the current store user + companyName. Built explicitly from the
   * secret-stripped DAO row; no passwordHash/invitationToken can appear.
   */
  public async me(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const storeUserId = req.storeUser?.storeUserId;
      if (!storeUserId) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }

      const user = await this._storeUserDAO.getByUuidWithCompany(storeUserId);
      if (!user) {
        res
          .status(404)
          .json({ success: false, message: "Store user not found" });
        return;
      }

      const storeUser = {
        uuid: user.uuid,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        isActive: user.isActive ?? true,
        companyUuid: user.companyUuid,
        companyName: user.companyName,
      };

      res.status(200).json({
        success: true,
        data: {
          storeUser,
          companyName: user.companyName, // duplicated at top level for convenience
        },
      });
    } catch (err: any) {
      next(err);
    }
  }
}
