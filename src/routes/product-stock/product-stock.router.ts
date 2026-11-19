import { Router } from "express";
import { ProductStockController } from "../../controllers/product-stock/product-stock.controller";
import {
  authenticate,
  requirePermission,
  apiRateLimiter,
} from "../../middlewares";

/** `/api/product-stock` (terminadora-order-flow model.md §Product stock). */
export class ProductStockRouter {
  public router: Router = Router();
  private readonly controller = new ProductStockController();

  constructor() {
    this.router.get(
      "/",
      authenticate,
      requirePermission("product-stock.view"),
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
  }
}
