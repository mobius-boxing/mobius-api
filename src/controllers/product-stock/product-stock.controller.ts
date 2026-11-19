import { Request, Response, NextFunction } from "express";
import { ProductStockDAO } from "../../dao/product-stock/product-stock.dao";

/** `GET /api/product-stock` — read-only; rows are written by receipts only. */
export class ProductStockController {
  private dao = new ProductStockDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (req.companyId === undefined) {
        res
          .status(400)
          .json({ success: false, message: "A company is required" });
        return;
      }
      res
        .status(200)
        .json(await this.dao.getAllWithFilters(req, req.companyId));
    } catch (err) {
      next(err);
    }
  }
}
