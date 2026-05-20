import { Request, Response, NextFunction } from "express";
import { StoreBoxDAO } from "../../dao/store-box/store-box.dao";
import { StoreRollDAO } from "../../dao/store-roll/store-roll.dao";

/**
 * Force company + active scope onto the request, Express-5-safe.
 *
 * In Express 5 `req.query` is a getter that re-parses `req.url` on every access, so
 * mutating/replacing `req.query` does NOT persist. We instead rewrite the query string on
 * `req.url` (the source of truth the getter reads). `searchParams.set` OVERWRITES any
 * client-supplied companyId/isActive — this is the strict-scope guarantee: a customer can
 * never browse another company's or inactive catalog. Other params (page/limit/sort/search)
 * are preserved.
 */
function forceCompanyAndActiveScope(req: Request, companyUuid: string): void {
  const u = new URL(req.url, "http://internal");
  u.searchParams.set("companyId", companyUuid); // forced JWT company
  u.searchParams.set("isActive", "true"); // forced active-only
  req.url = u.pathname + u.search;
}

export class StoreCatalogController {
  private _boxDAO = new StoreBoxDAO();
  private _rollDAO = new StoreRollDAO();

  /**
   * GET /api/store/catalog/boxes — AUTHENTICATED.
   * Active boxes for the JWT company only. SECURITY: companyId (UUID) and isActive
   * are FORCED from the JWT — any client-supplied values are overwritten, so a client
   * can never browse another company's or inactive catalog.
   * Returns a plain array (no pagination envelope) per the frontend contract.
   */
  public async boxes(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      forceCompanyAndActiveScope(req, req.storeUser!.companyId);

      const result = await this._boxDAO.getAllWithFilters(req);
      res.status(200).json({
        success: true,
        data: result.data.map((b) => ({
          uuid: b.uuid,
          description: b.description,
          unitsPerPackage: b.unitsPerPackage,
          unitsPerPallet: b.unitsPerPallet,
        })),
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /api/store/catalog/rolls — AUTHENTICATED.
   * Active rolls for the JWT company only. Same forced scope as boxes().
   */
  public async rolls(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      forceCompanyAndActiveScope(req, req.storeUser!.companyId);

      const result = await this._rollDAO.getAllWithFilters(req);
      res.status(200).json({
        success: true,
        data: result.data.map((r) => ({
          uuid: r.uuid,
          description: r.description,
          minQuantity: r.minQuantity,
        })),
      });
    } catch (err: any) {
      next(err);
    }
  }
}
