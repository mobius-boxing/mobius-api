import { Router } from "express";
import { CustomerCategoryController } from "../../controllers/customer-category/customer-category.controller";
import {
  authenticate,
  requireAdmin,
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
      validatePagination,
      apiRateLimiter,
      this.customerCategoryController.getAll.bind(
        this.customerCategoryController
      )
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.customerCategoryController.getByUuid.bind(
        this.customerCategoryController
      )
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.customerCategoryController.create.bind(
        this.customerCategoryController
      )
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.customerCategoryController.update.bind(
        this.customerCategoryController
      )
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.customerCategoryController.delete.bind(
        this.customerCategoryController
      )
    );
  }
}
