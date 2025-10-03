import { Router } from "express";
import { CustomerController } from "../../controllers/customer/customer.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class CustomerRouter {
  public router: Router = Router();
  private readonly customerController: CustomerController =
    new CustomerController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      validatePagination,
      apiRateLimiter,
      this.customerController.getAll.bind(this.customerController)
    );
    this.router.get(
      "/:uuid/with-details",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.customerController.getWithDetails.bind(this.customerController)
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.customerController.getByUuid.bind(this.customerController)
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.customerController.create.bind(this.customerController)
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.customerController.update.bind(this.customerController)
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.customerController.delete.bind(this.customerController)
    );
  }
}
