import { Router } from "express";
import { Request, Response, NextFunction } from "express";
import { PermissionDAO } from "../../dao/permission/permission.dao";
import {
  authenticate,
  requirePermission,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";

/** Read-only permission catalogue (the role editor's matrix source). */
export class PermissionsRouter {
  public router: Router = Router();
  private readonly dao: PermissionDAO = new PermissionDAO();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("roles.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const result = await this.dao.getAllWithFilters(req);
          res.status(200).json(result);
        } catch (err: any) {
          next(err);
        }
      },
    );
  }
}
