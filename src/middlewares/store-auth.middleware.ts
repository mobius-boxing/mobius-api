import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { StoreUserDAO } from "../dao/store-user/store-user.dao";

// Store JWT payload. `audience` is a custom payload claim (not the registered `aud`
// option) so verification is a simple field check — symmetric with how the internal
// auth code reads custom claims directly.
interface IStoreJWTPayload {
  audience?: string;
  storeUserId: string; // store_users.uuid
  companyId: string; // companies.uuid
  email: string;
  iat?: number;
  exp?: number;
}

const STORE_TOKEN_AUDIENCE = "store";

/**
 * authenticateStore — store-customer auth guard. Mirrors the internal `authenticate`
 * but is fully isolated from it:
 *  1. Primary isolation: store tokens are verified with STORE_JWT_SECRET (falls back to
 *     JWT_SECRET only if the store secret is unset — dev convenience). A token signed with
 *     a different secret fails verification here.
 *  2. Defense-in-depth: the token MUST carry `audience: 'store'`, else 401.
 *  3. Revocation safety: re-fetch the store user every request (active check), mirroring
 *     `authenticate`. getByUuidWithCompany returns the public (secret-stripped) row plus
 *     the company uuid + name in a single query.
 */
export const authenticateStore = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Authentication required. No token provided.",
      });
      return;
    }
    const token = authHeader.substring(7);

    // Separate secret = primary isolation boundary. Fall back to JWT_SECRET only if the
    // dedicated store secret is unset (dev). In that shared-secret case the audience check
    // below becomes the sole boundary — internal `authenticate` also rejects audience:'store'.
    const secret = process.env.STORE_JWT_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("STORE_JWT_SECRET / JWT_SECRET is not configured");
    }

    let decoded: IStoreJWTPayload;
    try {
      decoded = jwt.verify(token, secret) as IStoreJWTPayload;
    } catch {
      // Guarantee 401 (do not depend on the central error middleware for jwt errors).
      res
        .status(401)
        .json({ success: false, message: "Invalid or expired token." });
      return;
    }

    // Defense-in-depth: reject anything not minted for the store audience.
    if (decoded.audience !== STORE_TOKEN_AUDIENCE) {
      res.status(401).json({ success: false, message: "Invalid token." });
      return;
    }

    // SECURITY: re-check existence + active flag every request (revocation safety).
    const storeUserDAO = new StoreUserDAO();
    const user = await storeUserDAO.getByUuidWithCompany(decoded.storeUserId);
    if (!user) {
      res
        .status(401)
        .json({ success: false, message: "User no longer exists." });
      return;
    }
    if (user.isActive === false) {
      res
        .status(401)
        .json({ success: false, message: "User account is inactive." });
      return;
    }

    // TODO(store-module-recheck): optionally call CompanyModuleDAO.isEnabled(companyId,'store')
    // here for instant revocation when the store module is disabled mid-session. Deferred for
    // v1 (login gates module-enabled; we accept the token-TTL staleness window).

    req.storeUser = {
      storeUserId: decoded.storeUserId,
      companyId: user.companyUuid, // trust the DB row over the token for scope
      companyUuid: user.companyUuid,
      companyName: user.companyName,
      email: user.email,
    };
    next();
  } catch (err) {
    next(err);
  }
};
