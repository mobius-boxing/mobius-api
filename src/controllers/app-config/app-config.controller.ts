import { Request, Response, NextFunction } from "express";
import { AppConfigService } from "../../services/app-config.service";

/**
 * Per-company settings endpoints (keyed store — not a paginated list page, so the
 * standardized query builder intentionally does not apply here).
 *
 * GET    /app-config          → merged defaults+overrides for the caller's company
 * GET    /app-config/:key     → one typed entry
 * PUT    /app-config/:key     → set override  { value }
 * DELETE /app-config/:key     → reset to default
 */
export class AppConfigController {
  private service = new AppConfigService();

  /** Resolve the caller's numeric companyId from the JWT company UUID. */
  private async companyId(req: Request, res: Response): Promise<number | null> {
    const companyUuid = (req as any).user?.companyId;
    if (!companyUuid) {
      res.status(400).json({
        success: false,
        message: "No company associated with the current user.",
      });
      return null;
    }
    const id = await this.service.resolveCompanyId(companyUuid);
    if (!id) {
      res.status(404).json({ success: false, message: "Company not found" });
      return null;
    }
    return id;
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.companyId(req, res);
      if (companyId === null) return;
      const data = await this.service.getAll(companyId);
      res.status(200).json({ success: true, data });
    } catch (err: any) {
      next(err);
    }
  }

  public async getByKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.companyId(req, res);
      if (companyId === null) return;
      const { key } = req.params;
      const entry = await this.service.getEntry(companyId, key);
      if (!entry) {
        res
          .status(404)
          .json({ success: false, message: "Config key not found" });
        return;
      }
      res.status(200).json({ success: true, data: entry });
    } catch (err: any) {
      next(err);
    }
  }

  public async set(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.companyId(req, res);
      if (companyId === null) return;
      const { key } = req.params;
      const { value } = req.body;
      if (value === undefined || value === null) {
        res.status(400).json({ success: false, message: "value is required" });
        return;
      }
      try {
        const entry = await this.service.set(companyId, key, value);
        res.status(200).json({ success: true, data: entry });
      } catch (e: any) {
        if (e?.message?.startsWith("Unknown config key")) {
          res.status(404).json({ success: false, message: e.message });
          return;
        }
        throw e;
      }
    } catch (err: any) {
      next(err);
    }
  }

  public async reset(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this.companyId(req, res);
      if (companyId === null) return;
      const { key } = req.params;
      try {
        await this.service.reset(companyId, key);
        res
          .status(200)
          .json({ success: true, message: "Config key reset to default" });
      } catch (e: any) {
        if (e?.message?.startsWith("Unknown config key")) {
          res.status(404).json({ success: false, message: e.message });
          return;
        }
        throw e;
      }
    } catch (err: any) {
      next(err);
    }
  }
}
