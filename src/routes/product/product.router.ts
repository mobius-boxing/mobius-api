import { Router } from "express";
import { ProductController } from "../../controllers/product/product.controller";
import { PartController } from "../../controllers/part/part.controller";
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
  private partController = new PartController();

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
    // Nested parts (15-list-page.md: embedded product-detail grid).
    this.router.get(
      "/:productUuid/parts",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.partController.getAllForProduct.bind(this.partController),
    );
    this.router.post(
      "/:productUuid/parts",
      authenticate,
      requirePermission("parts.edit"),
      apiRateLimiter,
      this.partController.create.bind(this.partController),
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
