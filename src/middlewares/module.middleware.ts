import { Request, Response, NextFunction } from "express";
import { CompanyModuleDAO } from "../dao/company-module/company-module.dao";
import { getCompanyScope } from "../utils/companyScope";

/**
 * requireModule(slug): 403s unless the effective company has the module enabled
 * (CompanyModuleDAO.isEnabled).
 *
 * SECURITY: the company is `req.companyId`, resolved once by `authenticate` with
 * companyScope precedence, so this gate and the data-scoping never disagree.
 * SuperAdmin MUST pass a company (query/body companyId) — module data is always
 * company-scoped.
 */
export const requireModule = (slug: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { companyUuid, isSuperAdmin } = getCompanyScope(req);

      if (!companyUuid) {
        res.status(400).json({
          success: false,
          message: isSuperAdmin
            ? "SuperAdmin must specify a company (companyId)."
            : "User must belong to a company.",
        });
        return;
      }

      const companyId = req.companyId;
      if (companyId === undefined) {
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

export const requireCountdownModule = requireModule("countdown");
