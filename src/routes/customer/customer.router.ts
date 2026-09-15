import { Router } from "express";
import { CustomerController } from "../../controllers/customer/customer.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveCustomerDeletionRateLimiter,
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
      requirePermission("customers.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.customerController.getAll.bind(this.customerController),
    );
    this.router.get(
      "/:uuid/with-details",
      authenticate,
      requirePermission("customers.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.customerController.getWithDetails.bind(this.customerController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("customers.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.customerController.getByUuid.bind(this.customerController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("customers.edit"),
      apiRateLimiter,
      this.customerController.create.bind(this.customerController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("customers.edit"),
      validateUUID(),
      apiRateLimiter,
      this.customerController.update.bind(this.customerController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("customers.edit"),
      validateUUID(),
      sensitiveCustomerDeletionRateLimiter,
      this.customerController.delete.bind(this.customerController),
    );
  }
}
