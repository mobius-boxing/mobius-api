import { Router } from "express";
import { ProductController } from "../../controllers/product/product.controller";
import {
  authenticate,
  requireAdmin,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class ProductRouter {
  public router: Router = Router();
  private readonly productController: ProductController =
    new ProductController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.productController.getAll.bind(this.productController),
    );
    this.router.get(
      "/:uuid/with-details",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.productController.getWithDetails.bind(this.productController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.productController.getByUuid.bind(this.productController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.productController.create.bind(this.productController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.productController.update.bind(this.productController),
    );
    // Product technical approval (Procusto ProductoForm - Aprobacion tecnica).
    this.router.patch(
      "/:uuid/approval",
      authenticate,
      requirePermission("products.approve.technical"),
      validateUUID(),
      apiRateLimiter,
      this.productController.setApproval.bind(this.productController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.productController.delete.bind(this.productController),
    );
  }
}
