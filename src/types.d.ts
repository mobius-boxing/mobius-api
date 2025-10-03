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
        role: 'member' | 'admin' | 'superAdmin';
        companyId?: number;
      };
    }
  }
}
