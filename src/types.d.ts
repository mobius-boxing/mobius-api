import { Request, Response, NextFunction } from "express";

export interface IBaseController {
  getAll(req: Request, res: Response, next: NextFunction): Promise<void>;
  getByUuid(req: Request, res: Response, next: NextFunction): Promise<void>;
  create(req: Request, res: Response, next: NextFunction): Promise<void>;
  update(req: Request, res: Response, next: NextFunction): Promise<void>;
  delete(req: Request, res: Response, next: NextFunction): Promise<void>;
}

// Extend Express Request with user property for JWT authentication
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        uuid: string;
        email: string;
        role: "member" | "admin" | "superAdmin";
        companyId?: number;
      };
      // Set by authenticateStore (store customer JWT). Distinct from `user`:
      // an internal request never has `storeUser`, a store request never has `user`.
      // All ids here are UUIDs (the store JWT carries the company UUID, mirroring
      // the internal JWT). companyId === companyUuid (kept both for call-site clarity).
      storeUser?: {
        storeUserId: string; // store_users.uuid
        companyId: string; // companies.uuid (the JWT scope)
        companyUuid: string; // alias of companyId for readability
        companyName: string;
        email: string;
      };
    }
  }
}
