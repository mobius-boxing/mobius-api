import { Request, Response, NextFunction } from "express";

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
      /** Per-request cache filled by requirePermission. */
      permissionCodes?: string[];
      permissionHasRole?: boolean;
    }
  }
}
