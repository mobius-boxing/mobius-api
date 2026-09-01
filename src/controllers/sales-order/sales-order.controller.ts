import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { SalesOrderDAO } from "../../dao/sales-order/sales-order.dao";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { ProductDAO } from "../../dao/product/product.dao";
import { PartDAO } from "../../dao/part/part.dao";
import { DeliveryLocationDAO } from "../../dao/delivery-location/delivery-location.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { ISalesOrder } from "../../interfaces/sales-order/sales-order.interfaces";
import {
  ORDER_APPROVAL_MACHINES,
  OrderApprovalMachine,
} from "../../interfaces/sales-order/sales-order-approval.interfaces";
import {
  SalesOrderCreateInputDTO,
  SalesOrderUpdateInputDTO,
} from "../../dto/input/sales-order";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getCompanyFilterUuid } from "../../utils/companyScope";
import { setAuditAction } from "../../database/audit-context";
import { RbacService } from "../../services/rbac.service";
import {
  FulfillmentAction,
  ILifecycleOutcome,
  LifecycleRejection,
  SalesOrderLifecycleDAO,
  VoidAction,
} from "../../dao/sales-order/sales-order-lifecycle.dao";

/** The nested read's page-size cap, identical to `queryBuilder.ts:34`. */
const MAX_PAGE_SIZE = 100;

/** Permission codes this endpoint consults (all pre-existing catalogue codes). */
const EDIT_PRICES = "orders.edit-prices";
const VIEW_SALES_SECTOR = "orders.view-sales-sector";
const EDIT_DELIVERY_DATE = "orders.edit-delivery-date";

/** The DAO's rejection vocabulary → the 409 body's message (AC-6, D-1). */
const LIFECYCLE_REJECTION_MESSAGES: Record<LifecycleRejection, string> = {
  ORDER_ALREADY_FULFILLED: "A fulfilled sales order cannot be voided",
};

/**
 * Recursively drop `salesSector` from a response body — same res.json-wrapping
 * technique as sanitize-response.middleware.ts, kept local because the rule is
 * per-caller, not global (EdicionDatosPedido.cs:159-160).
 */
function stripSalesSectorKey(value: any): any {
  if (Array.isArray(value)) return value.map(stripSalesSectorKey);
  if (value instanceof Date) return value;
  if (value !== null && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === "salesSector") continue;
      out[key] = stripSalesSectorKey(val);
    }
    return out;
  }
  return value;
}

const sameUuid = (a?: string | null, b?: string | null): boolean =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * Pedido — module 18 sub-area D. Plain CRUD on BaseCrudController; the atomic
 * two-table write lives in `SalesOrderDAO` so this stays one controller shape.
 *
 * NOT here (separate features, non-goals 1-4): commercial/financial approval,
 * cumplimiento, anulación, the credit-limit engine and the Procusto
 * auto-approval on save (D-6). The lifecycle columns are read-only on every
 * verb below.
 */
export class SalesOrderController extends BaseCrudController<ISalesOrder> {
  protected dao = new SalesOrderDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Sales order",
    fkCatchOnDelete: true,
  };

  private customerDAO = new CustomerDAO();
  private productDAO = new ProductDAO();
  private partDAO = new PartDAO();
  private deliveryLocationDAO = new DeliveryLocationDAO();
  private userDAO = new UserDAO();
  private lifecycleDAO = new SalesOrderLifecycleDAO();

  /** Permission decisions route through RbacService — never inlined here. */
  private async can(req: Request, code: string): Promise<boolean> {
    const user = req.user;
    if (!user) return false;
    return RbacService.userHasPermission(user.userId, user.role, code);
  }

  /**
   * Hide `salesSector` from callers without the code, on every verb. Applied
   * by wrapping res.json before the handler writes its body.
   */
  private async applySalesSectorProjection(
    req: Request,
    res: Response,
  ): Promise<void> {
    if (await this.can(req, VIEW_SALES_SECTOR)) return;
    const originalJson = res.json.bind(res);
    res.json = (body: any) => originalJson(stripSalesSectorKey(body));
  }

  // ── DTOs ─────────────────────────────────────────────────────────────────
  protected async buildCreateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    await this.applySalesSectorProjection(req, res);
    let inputDTO: SalesOrderCreateInputDTO;
    try {
      inputDTO = new SalesOrderCreateInputDTO(req.body).build();
    } catch (e: any) {
      // DTO build() throws are validation failures (CLAUDE.md validation rule).
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async buildUpdateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    await this.applySalesSectorProjection(req, res);
    let inputDTO: SalesOrderUpdateInputDTO;
    try {
      inputDTO = new SalesOrderUpdateInputDTO(req.body).build();
    } catch (e: any) {
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  // ── Permission gates on the payload ──────────────────────────────────────
  /** Returns false after writing the 403 (EdicionDatosPedido.cs:156-160). */
  private async enforceFieldPermissions(
    inputDTO: SalesOrderCreateInputDTO,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (
      (inputDTO.sent("price") || inputDTO.sent("paid")) &&
      !(await this.can(req, EDIT_PRICES))
    ) {
      res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required: ${EDIT_PRICES}`,
      });
      return false;
    }
    if (
      inputDTO.sent("salesSector") &&
      !(await this.can(req, VIEW_SALES_SECTOR))
    ) {
      res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required: ${VIEW_SALES_SECTOR}`,
      });
      return false;
    }
    return true;
  }

  /** The scalar columns a create/update payload may carry onto sales_orders. */
  private scalarPayload(
    inputDTO: SalesOrderCreateInputDTO,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const key of [
      "quantity",
      "price",
      "paid",
      "deliveryDate",
      "purchaseOrder",
      "supplierCode",
      "salesSector",
      "needsAdvanceInvoice",
      "invoiceSent",
    ] as const) {
      if (inputDTO.sent(key)) payload[key] = inputDTO[key];
    }
    return payload;
  }

  /** Observaciones live on order_data, never on sales_orders (§Validation 11). */
  private orderDataPayload(
    inputDTO: SalesOrderCreateInputDTO,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const key of ["notes", "dispatchNotes", "conversionNotes"] as const) {
      if (inputDTO.sent(key)) payload[key] = inputDTO[key];
    }
    return payload;
  }

  /**
   * The delivery location must belong to the same customer as the order
   * (EdicionDatosPedido's lugar-de-entrega list is customer-scoped).
   * Returns `undefined` when nothing was sent, `null` on an explicit clear.
   */
  private async resolveDeliveryLocationId(
    inputDTO: SalesOrderCreateInputDTO,
    customerUuid: string,
    req: Request,
    res: Response,
  ): Promise<number | null | undefined | false> {
    if (!inputDTO.sent("deliveryLocationUuid")) return undefined;
    if (!inputDTO.deliveryLocationUuid) return null;

    const location = await this.deliveryLocationDAO.getByUuid(
      inputDTO.deliveryLocationUuid,
      getCompanyFilterUuid(req),
    );
    if (!location?.id) {
      res
        .status(400)
        .json({ success: false, message: "Delivery location not found" });
      return false;
    }
    if (!sameUuid(location.customer?.uuid, customerUuid)) {
      res.status(400).json({
        success: false,
        message: "Delivery location does not belong to the selected customer",
      });
      return false;
    }
    return location.id;
  }

  /**
   * Vendedor: explicit uuid wins; otherwise the customer's salesPersonId
   * (Mobius's stand-in for SituacionComercialCliente.Vendedor — D-7).
   * L-009: a user from another company is rejected, never silently stored.
   */
  private async resolveSalesUserId(
    inputDTO: SalesOrderCreateInputDTO,
    companyId: number,
    res: Response,
  ): Promise<number | null | undefined | false> {
    if (!inputDTO.sent("salesUserUuid")) return undefined;
    if (!inputDTO.salesUserUuid) return null;

    const user = await this.userDAO.getByUuid(inputDTO.salesUserUuid);
    if (!user?.id || user.companyId !== companyId) {
      res.status(400).json({ success: false, message: "Sales user not found" });
      return false;
    }
    return user.id;
  }

  /**
   * The parte path of the create (`PedidoDeParteForm.cs:142-153`): the parte is
   * picked over every parte of the company, and the cliente is DERIVED from
   * parte → producto → cliente (`PedidoDeParteMapper.cs:19`) — never taken from
   * the body. A `customerUuid` sent anyway must agree with the derived one.
   * Returns the derived customer uuid, or false after writing the error body.
   */
  private async resolvePartSubtype(
    inputDTO: SalesOrderCreateInputDTO,
    companyUuid: string | undefined,
    res: Response,
  ): Promise<{ partId: number; customerUuid: string } | false> {
    // L-009: a parte from another company behaves as not-found, never as a
    // CHECK-constraint 500.
    const part = await this.partDAO.getByUuid(inputDTO.partUuid!, companyUuid);
    if (!part?.id) {
      res.status(404).json({ success: false, message: "Part not found" });
      return false;
    }
    const derivedCustomerUuid = part.product?.customer?.uuid;
    if (!derivedCustomerUuid) {
      res.status(400).json({
        success: false,
        message: "Part's product has no customer",
      });
      return false;
    }
    if (
      inputDTO.sent("customerUuid") &&
      !sameUuid(inputDTO.customerUuid, derivedCustomerUuid)
    ) {
      res.status(400).json({
        success: false,
        message: "Customer does not belong to the selected part",
      });
      return false;
    }
    return { partId: part.id, customerUuid: derivedCustomerUuid };
  }

  // ── Create ───────────────────────────────────────────────────────────────
  protected async beforeCreate(
    inputDTO: SalesOrderCreateInputDTO,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    if (!(await this.enforceFieldPermissions(inputDTO, req, res))) return null;

    const companyUuid = getCompanyFilterUuid(req);

    // Exactly one discriminator reaches here (the DTO's XOR rule).
    let partId: number | null = null;
    let customerUuid = inputDTO.customerUuid;
    if (inputDTO.partUuid) {
      const subtype = await this.resolvePartSubtype(inputDTO, companyUuid, res);
      if (subtype === false) return null;
      partId = subtype.partId;
      customerUuid = subtype.customerUuid;
    }

    // L-009: a customer uuid from another company behaves as not-found.
    const customer = await this.customerDAO.getByUuid(
      customerUuid!,
      companyUuid,
    );
    if (!customer?.id) {
      res.status(404).json({ success: false, message: "Customer not found" });
      return null;
    }

    let productId: number | null = null;
    if (partId === null) {
      productId = await this.productDAO.getIdByUuid(
        inputDTO.productUuid!,
        companyUuid,
      );
      const product = productId
        ? await this.productDAO.getWithDetails(
            inputDTO.productUuid!,
            companyUuid,
          )
        : null;
      if (!productId || !product) {
        res.status(404).json({ success: false, message: "Product not found" });
        return null;
      }
      // D-1: the cliente is picked first and the product list is filtered by
      // it, but the pairing is still enforced here — the UI is not the guard
      // (AC-8).
      if (!sameUuid(product.customer?.uuid, inputDTO.customerUuid)) {
        res.status(400).json({
          success: false,
          message: "Product does not belong to the selected customer",
        });
        return null;
      }
    }

    const deliveryLocationId = await this.resolveDeliveryLocationId(
      inputDTO,
      customerUuid!,
      req,
      res,
    );
    if (deliveryLocationId === false) return null;

    const salesUserId = await this.resolveSalesUserId(
      inputDTO,
      customer.companyId as number,
      res,
    );
    if (salesUserId === false) return null;

    return {
      ...this.scalarPayload(inputDTO),
      companyId: customer.companyId,
      customerId: customer.id,
      productId,
      partId,
      // D-7: default the vendedor from the customer, always editable.
      salesUserId:
        salesUserId === undefined
          ? (customer.salesPersonId ?? null)
          : salesUserId,
      createdByUsername: req.user?.email ?? null,
      orderDataInput: {
        ...this.orderDataPayload(inputDTO),
        ...(deliveryLocationId !== undefined ? { deliveryLocationId } : {}),
      },
    };
  }

  // ── Update ───────────────────────────────────────────────────────────────
  protected async beforeUpdate(
    inputDTO: SalesOrderUpdateInputDTO,
    _existingId: number,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    if (!(await this.enforceFieldPermissions(inputDTO, req, res))) return null;

    const companyUuid = getCompanyFilterUuid(req);
    const existing = await this.dao.getByUuid(req.params.uuid, companyUuid);
    if (!existing) {
      this.sendNotFound(res);
      return null;
    }

    // PedidoDeProductoForm.cs:80 — the product lookup is disabled on edit, so
    // both references are immutable. Re-sending the same value is a no-op.
    if (
      inputDTO.sent("customerUuid") &&
      !sameUuid(inputDTO.customerUuid, existing.customer?.uuid)
    ) {
      res.status(400).json({
        success: false,
        message: "Customer cannot be changed",
      });
      return null;
    }
    if (
      inputDTO.sent("productUuid") &&
      !sameUuid(inputDTO.productUuid, existing.product?.uuid)
    ) {
      res.status(400).json({
        success: false,
        message: "Product cannot be changed",
      });
      return null;
    }
    // The parte is the other discriminator and equally immutable. The response
    // surface carries no `part` reference, so the comparison runs on the
    // numeric id `getByUuid` re-attaches; an unknown or cross-company uuid
    // resolves to null and therefore differs (L-009).
    if (inputDTO.sent("partUuid")) {
      const sentPartId = await this.partDAO.getIdByUuid(
        inputDTO.partUuid!,
        companyUuid,
      );
      if (!sentPartId || sentPartId !== (existing.partId ?? null)) {
        res.status(400).json({
          success: false,
          message: "Part cannot be changed",
        });
        return null;
      }
    }

    if (
      inputDTO.sent("deliveryDate") &&
      this.deliveryDateChanged(inputDTO.deliveryDate, existing.deliveryDate) &&
      !(await this.can(req, EDIT_DELIVERY_DATE))
    ) {
      res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required: ${EDIT_DELIVERY_DATE}`,
      });
      return null;
    }

    const customerUuid = existing.customer?.uuid ?? "";
    const deliveryLocationId = await this.resolveDeliveryLocationId(
      inputDTO,
      customerUuid,
      req,
      res,
    );
    if (deliveryLocationId === false) return null;

    const salesUserId = await this.resolveSalesUserId(
      inputDTO,
      existing.companyId as number,
      res,
    );
    if (salesUserId === false) return null;

    const orderDataInput = {
      ...this.orderDataPayload(inputDTO),
      ...(deliveryLocationId !== undefined ? { deliveryLocationId } : {}),
    };

    return {
      ...this.scalarPayload(inputDTO),
      ...(salesUserId !== undefined ? { salesUserId } : {}),
      ...(Object.keys(orderDataInput).length ? { orderDataInput } : {}),
    };
  }

  /** Timestamp comparison — the same instant sent back is not a change. */
  private deliveryDateChanged(
    incoming: string | null | undefined,
    stored: Date | string | null | undefined,
  ): boolean {
    const toTime = (value: any): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? null : time;
    };
    return toTime(incoming) !== toTime(stored);
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  /**
   * SECURITY (L-009): scope the list explicitly. The base class relies on
   * enforceCompanyFilter() mutating req.query, but Express 5 discards those
   * writes (see ModelController.getAll). superAdmin without ?companyId= keeps
   * the cross-company view.
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.applySalesSectorProjection(req, res);
      const result = await this.dao.getAllWithFilters(
        req,
        getCompanyFilterUuid(req),
      );
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /sales-orders/:uuid/production-orders — the OPs of this pedido's
   * `order_data` (OrdenesAsociadasForm), `number` ascending, `IDataPaginator`
   * returned UNWRAPPED like every other paginated read.
   *
   * L-009: the DAO resolves the pedido inside the caller's company scope, so
   * another tenant's pedido answers 404 — never 403 and never an empty 200.
   * `orderDataId IS NULL` is an empty list, not an error.
   */
  public async getProductionOrders(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(
        parseInt(req.query.limit as string, 10) || 20,
        MAX_PAGE_SIZE,
      );
      const result = await this.dao.getAssociatedProductionOrders(
        req.params.uuid,
        getCompanyFilterUuid(req),
        page < 1 ? 1 : page,
        limit < 1 ? 20 : limit,
      );
      if (!result) {
        res
          .status(404)
          .json({ success: false, message: "Sales order not found" });
        return;
      }
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.applySalesSectorProjection(req, res);
    } catch (err: any) {
      next(err);
      return;
    }
    await super.getByUuid(req, res, next);
  }

  // ── Approvals ────────────────────────────────────────────────────────────
  /**
   * PATCH /sales-orders/:uuid/approval/:machine  { action: 'approve'|'cancel' }
   *
   * The machine guard here is a second belt: the router's dispatch already
   * answers 400 for an unknown machine before requirePermission runs. Both
   * exist because either alone would be a silent single point of failure.
   *
   * L-005 / L-009: the numeric id is resolved explicitly, scoped to the
   * caller's company — never guarded on `existing.id` after the id-stripping
   * mapper — so a company-B uuid is indistinguishable from a missing one.
   */
  public async setApproval(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const machine = req.params.machine as OrderApprovalMachine;
      // Express 5 leaves `req.body` UNDEFINED for a bodyless PATCH, so this is
      // read defensively: destructuring it answers 500 with a TypeError text.
      const action = (req.body ?? {}).action;
      if (!(ORDER_APPROVAL_MACHINES as readonly string[]).includes(machine)) {
        res.status(400).json({
          success: false,
          message: `machine must be one of: ${ORDER_APPROVAL_MACHINES.join(", ")}`,
        });
        return;
      }
      if (action !== "approve" && action !== "cancel") {
        res.status(400).json({
          success: false,
          message: "action must be approve or cancel",
        });
        return;
      }
      // Below the input guards: the projection costs an RBAC round trip to the
      // database, which a malformed request must never pay for.
      await this.applySalesSectorProjection(req, res);

      const existingId = await this.dao.getIdByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!existingId) {
        res
          .status(404)
          .json({ success: false, message: "Sales order not found" });
        return;
      }

      const username = req.user?.email ?? "unknown";
      // A domain verb: the trigger sees an UPDATE of `sales_orders` and an
      // INSERT into `sales_order_approval_events`, not the intent behind them.
      await setAuditAction("sales_order.approval");
      const updated = await this.dao.setApproval(
        existingId,
        machine,
        action,
        username,
      );
      if (!updated) {
        // The row was deleted between the uuid→id resolution and the UPDATE:
        // nothing was stamped, so this is a 404 — never a 200 `{data: null}`
        // with an audit row claiming a modification that never happened.
        res
          .status(404)
          .json({ success: false, message: "Sales order not found" });
        return;
      }
      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      next(err);
    }
  }

  // ── Cumplimiento / anulación ─────────────────────────────────────────────
  /**
   * PATCH /sales-orders/:uuid/fulfillment  { action: 'fulfill' | 'cancel' }
   *
   * Gated by `orders.manual-fulfillment`. No approval is required to fulfill
   * and a voided pedido may still be fulfilled — Procusto reads neither state
   * (PLSUseCases.Pedidos/Editar.cs:97-105, Listar.cs:56-68), AC-7/AC-8.
   *
   * L-005 / L-009: the numeric id is resolved explicitly, scoped to the
   * caller's company — never guarded on `existing.id` after the id-stripping
   * mapper — so a company-B uuid is indistinguishable from a missing one.
   */
  public async setFulfillment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const action = (req.body ?? {}).action;
      if (action !== "fulfill" && action !== "cancel") {
        res.status(400).json({
          success: false,
          message: "action must be fulfill or cancel",
        });
        return;
      }
      // Below the input guards: the projection costs an RBAC round trip to the
      // database, which a malformed request must never pay for.
      await this.applySalesSectorProjection(req, res);

      const existingId = await this.dao.getIdByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!existingId) {
        this.sendLifecycleNotFound(res);
        return;
      }

      await setAuditAction(
        action === "cancel"
          ? "sales_order.fulfill.cancel"
          : "sales_order.fulfill",
      );
      const outcome = await this.lifecycleDAO.setFulfillment(
        existingId,
        action as FulfillmentAction,
        req.user?.email ?? "unknown",
      );
      await this.respondLifecycle(res, outcome);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * PATCH /sales-orders/:uuid/void  { action, includeProductionOrders? }
   *
   * Gated by `orders.delete`: anulación IS the soft delete of a pedido and no
   * `Anulación` code exists in the catalogue (spec §API surface 2).
   *
   * The cascade is opt-in here (Procusto's `incluirOrdenes` flag) and, when the
   * pedido→OP link is missing, the flag is REJECTED rather than accepted and
   * ignored (L-007, AC-18).
   */
  public async setVoid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const action = body.action;
      if (action !== "void" && action !== "cancel") {
        res.status(400).json({
          success: false,
          message: "action must be void or cancel",
        });
        return;
      }

      const sentCascadeFlag = Object.prototype.hasOwnProperty.call(
        body,
        "includeProductionOrders",
      );
      if (
        sentCascadeFlag &&
        typeof body.includeProductionOrders !== "boolean"
      ) {
        res.status(400).json({
          success: false,
          message: "includeProductionOrders must be a boolean",
        });
        return;
      }
      if (sentCascadeFlag && !(await this.lifecycleDAO.cascadeAvailable())) {
        res.status(400).json({
          success: false,
          message:
            "includeProductionOrders is not available: production orders are not linked to sales orders in this deployment",
        });
        return;
      }
      // Below the input guards: the projection costs an RBAC round trip to the
      // database, which a malformed request must never pay for.
      await this.applySalesSectorProjection(req, res);

      const existingId = await this.dao.getIdByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!existingId) {
        this.sendLifecycleNotFound(res);
        return;
      }

      await setAuditAction("sales_order.void");
      const outcome = await this.lifecycleDAO.setVoid(
        existingId,
        action as VoidAction,
        req.user?.email ?? "unknown",
        body.includeProductionOrders === true,
      );
      await this.respondLifecycle(res, outcome);
    } catch (err: any) {
      next(err);
    }
  }

  /** Same 404 body both lifecycle verbs answer for an out-of-scope uuid. */
  private sendLifecycleNotFound(res: Response): void {
    res.status(404).json({ success: false, message: "Sales order not found" });
  }

  /**
   * One shape for both verbs: 409 for a rejection, otherwise 200 with the DTO
   * and the cascade count. `productionOrdersAffected` is a SIBLING of `data`,
   * never a DTO field — the DTO belongs to the create feature (plan P-2).
   *
   * A no-op still records NO audit row (AC-3, AC-4, AC-20) — that is now the
   * trigger's no-op guard rather than this method's `changed` check: an UPDATE
   * that writes nothing is not history.
   *
   * `missing` is the TOCTOU window `setApproval` already answers 404 for: the
   * pedido was deleted between the uuid→id resolution and the locked re-read,
   * so nothing was stamped and the response must not be a 200 `{data: null}`.
   */
  private async respondLifecycle(
    res: Response,
    outcome: ILifecycleOutcome,
  ): Promise<void> {
    if (outcome.missing) {
      this.sendLifecycleNotFound(res);
      return;
    }
    if (outcome.rejected) {
      res.status(409).json({
        success: false,
        message: LIFECYCLE_REJECTION_MESSAGES[outcome.rejected],
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: outcome.order,
      productionOrdersAffected: outcome.productionOrdersAffected,
    });
  }
}
