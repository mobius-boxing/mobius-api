import { Request, Response, NextFunction } from "express";
import { IDeviceSession } from "./interfaces/user-device/user-device.interfaces";

export interface IBaseController {
  getAll(req: Request, res: Response, next: NextFunction): Promise<void>;
  getByUuid(req: Request, res: Response, next: NextFunction): Promise<void>;
  create(req: Request, res: Response, next: NextFunction): Promise<void>;
  update(req: Request, res: Response, next: NextFunction): Promise<void>;
  delete(req: Request, res: Response, next: NextFunction): Promise<void>;
}

// Extend Express Request with user property for JWT authentication.
// Shapes match what auth.middleware ACTUALLY assigns: userId and companyId are
// UUID strings from the JWT (the old number typing was wrong and drove the
// `(req as any).user` cast epidemic — do not reintroduce it).
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: "member" | "admin" | "superAdmin";
        companyId?: string;
      };
      /**
       * The effective company's numeric id, resolved once by `authenticate`
       * (via `resolveTenantContext`). Undefined for unauthenticated routes and
       * for a superAdmin with no company selected.
       */
      companyId?: number;
      /**
       * The caller's own device, resolved by the auth middleware: `null` for an
       * admin/superAdmin and for a member whose header matches no row. `token`
       * is never set here — only the login response that minted the secret
       * carries it (I-2).
       */
      device?: IDeviceSession | null;
      /** Per-request cache filled by requirePermission. */
      permissionCodes?: string[];
      permissionHasRole?: boolean;
    }
  }
}
