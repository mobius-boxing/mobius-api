import { Router } from "express";
import { SupplierPurchaseOrderController } from "../../controllers/supplier-purchase-order/supplier-purchase-order.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  apiRateLimiter,
} from "../../middlewares";

const PLAN = "supplier-orders.plan";
const SEND = "supplier-orders.send";
const RECEIVE = "supplier-orders.receive";

/**
 * `/api/supplier-purchase-orders` (terminadora-order-flow model.md). Route
 * ORDER matters: `/pool` and `/lines…` are registered before `/:uuid`, or
 * `validateUUID` would capture them as malformed uuids.
 */
export class SupplierPurchaseOrdersRouter {
  public router: Router = Router();
  private readonly controller = new SupplierPurchaseOrderController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    const c = this.controller;
    this.router.get(
      "/pool",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      apiRateLimiter,
      c.getPool.bind(c),
    );
    this.router.get(
      "/lines",
      authenticate,
      requirePermission(RECEIVE, { allowReadOnly: true }),
      apiRateLimiter,
      c.getLines.bind(c),
    );
    this.router.post(
      "/lines/:uuid/receipts",
      authenticate,
      requirePermission(RECEIVE),
      validateUUID(),
      apiRateLimiter,
      c.createReceipt.bind(c),
    );
    this.router.patch(
      "/lines/:uuid/close",
      authenticate,
      requirePermission(RECEIVE),
      validateUUID(),
      apiRateLimiter,
      c.closeLine.bind(c),
    );

    this.router.get(
      "/",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      apiRateLimiter,
      c.getAll.bind(c),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission(PLAN),
      apiRateLimiter,
      c.create.bind(c),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      c.getByUuid.bind(c),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      c.update.bind(c),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      c.delete.bind(c),
    );
    this.router.post(
      "/:uuid/send",
      authenticate,
      requirePermission(SEND),
      validateUUID(),
      apiRateLimiter,
      c.sendOrder.bind(c),
    );
    this.router.post(
      "/:uuid/unsend",
      authenticate,
      requirePermission(SEND),
      validateUUID(),
      apiRateLimiter,
      c.unsendOrder.bind(c),
    );
  }
}
