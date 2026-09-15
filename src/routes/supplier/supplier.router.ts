import { Router } from "express";
import { SupplierController } from "../../controllers/supplier/supplier.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class SupplierRouter {
  public router: Router = Router();
  private readonly supplierController: SupplierController =
    new SupplierController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("suppliers.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.supplierController.getAll.bind(this.supplierController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("suppliers.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.supplierController.getByUuid.bind(this.supplierController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("suppliers.edit"),
      apiRateLimiter,
      this.supplierController.create.bind(this.supplierController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("suppliers.edit"),
      validateUUID(),
      apiRateLimiter,
      this.supplierController.update.bind(this.supplierController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("suppliers.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.supplierController.delete.bind(this.supplierController),
    );
  }
}
