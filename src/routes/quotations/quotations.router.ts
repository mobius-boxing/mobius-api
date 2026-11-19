import { Router } from "express";
import { QuotationController } from "../../controllers/quotation/quotation.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  apiRateLimiter,
} from "../../middlewares";

const EDIT = "quotations.edit";
const APPROVE = "quotations.approve";
const DELETE = "quotations.delete";

/** `/api/quotations` (terminadora-order-flow model.md §Quotations). */
export class QuotationsRouter {
  public router: Router = Router();
  private readonly controller = new QuotationController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    const c = this.controller;
    this.router.get(
      "/",
      authenticate,
      requirePermission(EDIT),
      apiRateLimiter,
      c.getAll.bind(c),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission(EDIT),
      apiRateLimiter,
      c.create.bind(c),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission(EDIT),
      validateUUID(),
      apiRateLimiter,
      c.getByUuid.bind(c),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission(EDIT),
      validateUUID(),
      apiRateLimiter,
      c.update.bind(c),
    );
    this.router.patch(
      "/:uuid/approval",
      authenticate,
      requirePermission(APPROVE),
      validateUUID(),
      apiRateLimiter,
      c.setApproval.bind(c),
    );
    this.router.post(
      "/:uuid/generate-order",
      authenticate,
      requirePermission(EDIT),
      requirePermission("orders.edit"),
      validateUUID(),
      apiRateLimiter,
      c.generateOrder.bind(c),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission(DELETE),
      validateUUID(),
      apiRateLimiter,
      c.delete.bind(c),
    );
  }
}
