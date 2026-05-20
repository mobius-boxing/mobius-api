import { Request, Response, NextFunction } from "express";
import { CompanyDAO } from "../dao/company/company.dao";
import { CompanyModuleDAO } from "../dao/company-module/company-module.dao";

/**
 * requireModule(slug): resolves the target company (same precedence as companyScope —
 * superAdmin reads query/body companyId; everyone else uses the JWT company UUID),
 * resolves the UUID to a numeric companyId, then 403s unless that company has the
 * module enabled (CompanyModuleDAO.isEnabled).
 *
 * SECURITY: mirrors companyScope precedence exactly so this gate and the data-scoping
 * never disagree. SuperAdmin MUST pass a company (query/body companyId) for store routes —
 * store data is always company-scoped.
 */
export const requireModule = (slug: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = (req as any).user;
      const isSuperAdmin = user?.role === "superAdmin";

      const companyUuid = isSuperAdmin
        ? ((req.query.companyId as string | undefined) ??
          (req.body?.companyId as string | undefined))
        : (user?.companyId as unknown as string | undefined);

      if (!companyUuid) {
        res.status(400).json({
          success: false,
          message: isSuperAdmin
            ? "SuperAdmin must specify a company (companyId)."
            : "User must belong to a company.",
        });
        return;
      }

      const companyId = await new CompanyDAO().getIdByUuid(companyUuid);
      if (!companyId) {
        res.status(404).json({
          success: false,
          message: "Company not found.",
        });
        return;
      }

      const enabled = await new CompanyModuleDAO().isEnabled(companyId, slug);
      if (!enabled) {
        res.status(403).json({
          success: false,
          message: `The '${slug}' module is not enabled for this company.`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireStoreModule = requireModule("store");
