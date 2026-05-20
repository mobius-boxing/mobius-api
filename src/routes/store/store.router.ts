import { Router } from "express";
import { StoreAuthController } from "../../controllers/store/store-auth.controller";
import { StoreCatalogController } from "../../controllers/store/store-catalog.controller";
import { StoreOrderController } from "../../controllers/store/store-order.controller";
import {
  authenticateStore,
  validateUUID,
  validatePagination,
  authRateLimiter,
  apiRateLimiter,
} from "../../middlewares";

/**
 * Customer-facing store API. Auto-mounts at /api/store (folder name = mount path).
 * No collision with backoffice /api/store-boxes | store-rolls | store-users (distinct prefixes).
 *
 * Isolation: all authenticated routes use authenticateStore (separate STORE_JWT_SECRET +
 * audience:'store'), NOT the internal `authenticate`. requireModule is intentionally NOT used
 * here (it reads req.user; login already gates module-enabled).
 */
export class StoreRouter {
  public router: Router = Router();
  private auth = new StoreAuthController();
  private catalog = new StoreCatalogController();
  private orders = new StoreOrderController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // Public
    this.router.post(
      "/auth/login",
      authRateLimiter,
      this.auth.login.bind(this.auth),
    );

    // Authenticated (store audience)
    this.router.get(
      "/me",
      authenticateStore,
      apiRateLimiter,
      this.auth.me.bind(this.auth),
    );

    this.router.get(
      "/catalog/boxes",
      authenticateStore,
      validatePagination,
      apiRateLimiter,
      this.catalog.boxes.bind(this.catalog),
    );
    this.router.get(
      "/catalog/rolls",
      authenticateStore,
      validatePagination,
      apiRateLimiter,
      this.catalog.rolls.bind(this.catalog),
    );

    this.router.post(
      "/orders",
      authenticateStore,
      apiRateLimiter,
      this.orders.create.bind(this.orders),
    );
    this.router.get(
      "/orders",
      authenticateStore,
      validatePagination,
      apiRateLimiter,
      this.orders.list.bind(this.orders),
    );
    this.router.get(
      "/orders/:uuid",
      authenticateStore,
      validateUUID(),
      apiRateLimiter,
      this.orders.getOne.bind(this.orders),
    );
  }
}
