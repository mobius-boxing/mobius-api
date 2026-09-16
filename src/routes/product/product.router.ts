import { Router } from "express";
import { ProductController } from "../../controllers/product/product.controller";
import {
  authenticate,
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
      requirePermission("products.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.productController.getAll.bind(this.productController),
    );
    // Registered BEFORE `/:uuid` — otherwise Express would match "calculate"
    // as a uuid path param and 404 it under validateUUID().
    this.router.post(
      "/calculate",
      authenticate,
      requirePermission("products.edit"),
      apiRateLimiter,
      this.productController.calculate.bind(this.productController),
    );
    this.router.get(
      "/:uuid/with-details",
      authenticate,
      requirePermission("products.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.productController.getWithDetails.bind(this.productController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("products.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.productController.getByUuid.bind(this.productController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("products.edit"),
      apiRateLimiter,
      this.productController.create.bind(this.productController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("products.edit"),
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
      requirePermission("products.delete"),
      validateUUID(),
      sensitiveRateLimiter,
      this.productController.delete.bind(this.productController),
    );
  }
}
