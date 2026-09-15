import { Router } from "express";
import { CustomerCategoryController } from "../../controllers/customer-category/customer-category.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class CustomerCategoryRouter {
  public router: Router = Router();
  private readonly customerCategoryController: CustomerCategoryController =
    new CustomerCategoryController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("customer-categories.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.customerCategoryController.getAll.bind(
        this.customerCategoryController,
      ),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("customer-categories.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.customerCategoryController.getByUuid.bind(
        this.customerCategoryController,
      ),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("customer-categories.edit"),
      apiRateLimiter,
      this.customerCategoryController.create.bind(
        this.customerCategoryController,
      ),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("customer-categories.edit"),
      validateUUID(),
      apiRateLimiter,
      this.customerCategoryController.update.bind(
        this.customerCategoryController,
      ),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("customer-categories.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.customerCategoryController.delete.bind(
        this.customerCategoryController,
      ),
    );
  }
}
