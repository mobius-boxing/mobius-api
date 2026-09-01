import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ProductionOrderDAO } from "../../dao/production-order/production-order.dao";
import {
  IProductionOrder,
  LifecycleAction,
  LifecycleMachine,
  PRODUCTION_ORDER_CONFIG_KEYS,
  WARNING_MESSAGES,
} from "../../interfaces/production-order/production-order.interfaces";
import {
  GenerateOrdersInputDTO,
  ProductionOrderCreateInputDTO,
  ProductionOrderUpdateInputDTO,
} from "../../dto/input/production-order";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import {
  getCompanyFilterUuid,
  getCompanyForCreate,
} from "../../utils/companyScope";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { AppConfigService } from "../../services/app-config.service";
import {
  CodeGeneratorService,
  CODE_SCOPES,
} from "../../services/code-generator.service";
import { ProductionOrderGenerationService } from "../../services/production-order-generation.service";
import { validateProductionOrder } from "../../services/production-order-validator.service";
import { autoFulfillIfComplete } from "../../services/sales-order-fulfillment.service";
import { setAuditAction } from "../../database/audit-context";

/** uuid body field → { table it lives in, numeric column it resolves to }. */
const REFERENCES: Record<string, { table: string; idKey: string }> = {
  partUuid: { table: "parts", idKey: "partId" },
  orderDataUuid: { table: "order_data", idKey: "orderDataId" },
  routeUuid: { table: "production_routes", idKey: "routeId" },
  palletizationUuid: { table: "palletizations", idKey: "palletizationId" },
};

/**
 * Órdenes de producción — module 13.
 *
 * Plain CRUD on `BaseCrudController`; the pedido flow (`generate`,
 * `generation-eligibility`) delegates to the generation service, and the six
 * lifecycle verbs share one handler factory.
 *
 * WHAT IS DELIBERATELY ABSENT, and must stay absent until the corresponding
 * module lands:
 *
 * - Anulación has no precondition of any kind. The source refuses to void an
 *   order that already has work planned against it, but that check needs a
 *   table this system does not have yet. Adding a weaker stand-in would create
 *   a rule nobody can reason about; the deferral is recorded in the spec's
 *   divergences table, where a reader will look for it.
 * - Completion writes its four columns and nothing else: no fan-out to
 *   downstream work items, no domain event. Those subscribers do not exist.
 * - `POST /:uuid/complete` takes NO request body. The source's completion verb
 *   accepts an extra flag; that flag only means something once the downstream
 *   tables exist, and an accepted-and-ignored parameter is worse than an absent
 *   one — clients build on it and discover later that it never did anything.
 */
export class ProductionOrderController extends BaseCrudController<IProductionOrder> {
  protected dao = new ProductionOrderDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Production order",
    fkCatchOnDelete: true,
  };

  private appConfig = new AppConfigService();
  private codeGenerator = new CodeGeneratorService();
  private generation = new ProductionOrderGenerationService();

  // ── DTOs ─────────────────────────────────────────────────────────────────
  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    return this.buildDTO(
      new ProductionOrderCreateInputDTO(req.body),
      req,
      next,
    );
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    return this.buildDTO(
      new ProductionOrderUpdateInputDTO(req.body),
      req,
      next,
    );
  }

  private async buildDTO(
    dto: ProductionOrderCreateInputDTO,
    req: Request,
    next: NextFunction,
  ): Promise<any | null> {
    let built: ProductionOrderCreateInputDTO;
    try {
      built = dto.build();
    } catch (e: any) {
      // DTO build() throws are validation failures (CLAUDE.md validation rule).
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(built);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return built;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────
  /** Append `warnings` to the success envelope this request is about to write. */
  private attachWarnings(res: Response, warnings: string[]): void {
    if (!warnings.length) return;
    const originalJson = res.json.bind(res);
    res.json = (body: any) =>
      body && body.success === true
        ? originalJson({ ...body, warnings })
        : originalJson(body);
  }

  /**
   * uuid → numeric id for every reference the payload carries, scoped to the
   * caller's company (L-009: a uuid from another tenant must behave exactly
   * like a non-existent one). Returns false after writing the error response.
   */
  private async resolveReferences(
    dto: ProductionOrderCreateInputDTO,
    req: Request,
    res: Response,
  ): Promise<Record<string, number | null> | false> {
    const companyUuid = getCompanyFilterUuid(req);
    const refs: Record<string, number | null> = {};

    for (const [uuidKey, config] of Object.entries(REFERENCES)) {
      if (!dto.sent(uuidKey)) continue;
      const value = dto[uuidKey] as string | null;
      if (!value) {
        refs[config.idKey] = null;
        continue;
      }
      const id = await this.dao.resolveReferenceId(
        config.table,
        value,
        companyUuid,
      );
      if (!id) {
        res.status(404).json({
          success: false,
          message: `Referenced ${config.table.replace(/_/g, " ")} not found`,
        });
        return false;
      }
      refs[config.idKey] = id;
    }

    // A pedido may be named by its own uuid; it resolves to its order_data row.
    if (dto.sent("salesOrderUuid") && dto.salesOrderUuid) {
      const salesOrder = await this.dao.readSalesOrderForGeneration(
        dto.salesOrderUuid as string,
        companyUuid,
      );
      if (!salesOrder?.orderDataId) {
        res.status(404).json({
          success: false,
          code: "SALES_ORDER_NOT_FOUND",
          message: "Sales order not found",
        });
        return false;
      }
      refs.orderDataId = salesOrder.orderDataId;
    }

    return refs;
  }

  /**
   * `Problemas()` over one row. Returns false after writing the 422, so callers
   * read it exactly like the reference-resolution helper above.
   */
  private async runValidator(
    row: { partId: number | null; quantity: number | null },
    routeId: number | null,
    companyId: number,
    isNew: boolean,
    res: Response,
  ): Promise<boolean> {
    const context = await this.dao.loadOrderValidationContext({
      partId: row.partId,
      routeId,
    });
    const maxQuantity = await this.appConfig.getNumber(
      companyId,
      PRODUCTION_ORDER_CONFIG_KEYS.maxQuantity,
    );
    const { problems } = validateProductionOrder(
      row,
      {
        routeStageCount: context?.routeStageCount ?? 0,
        partApproved: context?.partApproved ?? false,
        customerActive: context?.customerActive ?? false,
        maxQuantity,
      },
      { isNew },
    );
    if (problems.length === 0) return true;
    res.status(422).json({
      success: false,
      code: "ORDER_INVALID",
      message: problems[0],
      problems,
    });
    return false;
  }

  /** OrdenDeProduccionForm.cs:634,639 — advice, never a rejection. */
  private async buildWarnings(row: {
    partId: number | null;
    quantity: number | null;
    orderDataId: number | null;
  }): Promise<string[]> {
    if (!row.orderDataId) return [];
    const salesOrder = await this.dao.readSalesOrderByOrderDataId(
      row.orderDataId,
    );
    if (!salesOrder) return [];

    const warnings: string[] = [];
    const partContext = await this.dao.loadOrderValidationContext({
      partId: row.partId,
    });
    const orderProduct = partContext?.productId ?? null;
    const isPedidosOwnPart =
      salesOrder.partId != null && salesOrder.partId === row.partId;
    if (
      !isPedidosOwnPart &&
      salesOrder.productId != null &&
      orderProduct !== salesOrder.productId
    ) {
      warnings.push(
        WARNING_MESSAGES.partProductMismatch(
          partContext?.productCode ?? "?",
          salesOrder.productCode ?? "?",
        ),
      );
    }
    if ((row.quantity ?? 0) > salesOrder.quantity) {
      warnings.push(WARNING_MESSAGES.quantityAboveSalesOrder);
    }
    return warnings;
  }

  /** Strip the uuid reference keys so they never reach an INSERT. */
  private stripReferenceKeys(payload: Record<string, unknown>): void {
    for (const key of Object.keys(REFERENCES)) delete payload[key];
    delete payload.salesOrderUuid;
  }

  // ── Create ───────────────────────────────────────────────────────────────
  protected async beforeCreate(
    inputDTO: ProductionOrderCreateInputDTO,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const company = getCompanyForCreate(req);
    if (!company.success) {
      res.status(400).json({ success: false, message: company.message });
      return null;
    }
    const companyId = await getIdByUuid(company.companyUuid, "companies");
    if (!companyId) {
      res.status(400).json({ success: false, message: "Company not found" });
      return null;
    }

    // OrdenesDeProduccionForm.cs:155 — the "Agregar" button is disabled by
    // configuration. Generation is NOT affected: it is a different verb with a
    // different permission.
    if (
      await this.appConfig.getBool(
        companyId,
        PRODUCTION_ORDER_CONFIG_KEYS.noNewOrders,
      )
    ) {
      res.status(403).json({
        success: false,
        code: "ORDER_CREATION_DISABLED",
        message: "Order creation is disabled by configuration",
      });
      return null;
    }

    if (!(await this.enforceNumberGate(inputDTO, companyId, res))) return null;

    const refs = await this.resolveReferences(inputDTO, req, res);
    if (refs === false) return null;

    const payload: Record<string, unknown> = {
      ...inputDTO,
      ...refs,
      companyId,
    };
    this.stripReferenceKeys(payload);
    payload.createdByUser = req.user?.email ?? null;
    // Procusto stamps `Fecha` at creation; a client may override it.
    if (payload.orderDate === undefined) payload.orderDate = new Date();

    const row = {
      partId: (refs.partId ?? null) as number | null,
      quantity: (inputDTO.quantity ?? null) as number | null,
      orderDataId: (refs.orderDataId ?? null) as number | null,
    };

    // Validate BEFORE numbering: an invalid create must not burn a counter
    // value (the same rule the generation service follows).
    if (
      !(await this.runValidator(
        row,
        (refs.routeId ?? null) as number | null,
        companyId,
        true,
        res,
      ))
    ) {
      return null;
    }

    if (payload.number === undefined) {
      payload.number = await this.nextNumber(companyId, row.orderDataId);
    }

    this.attachWarnings(res, await this.buildWarnings(row));
    return payload;
  }

  // ── Update ───────────────────────────────────────────────────────────────
  protected async beforeUpdate(
    inputDTO: ProductionOrderUpdateInputDTO,
    _existingId: number,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const existing = await this.dao.getByUuid(
      req.params.uuid,
      getCompanyFilterUuid(req),
    );
    if (!existing) {
      this.sendNotFound(res);
      return null;
    }
    const companyId = existing.companyId as number;

    if (!(await this.enforceNumberGate(inputDTO, companyId, res))) return null;

    const refs = await this.resolveReferences(inputDTO, req, res);
    if (refs === false) return null;

    const payload: Record<string, unknown> = { ...inputDTO, ...refs };
    this.stripReferenceKeys(payload);

    const row = {
      partId: (refs.partId ?? existing.partId ?? null) as number | null,
      quantity: (inputDTO.quantity ?? existing.quantity ?? null) as
        | number
        | null,
      orderDataId: (refs.orderDataId ?? existing.orderDataId ?? null) as
        | number
        | null,
    };
    const routeId = (refs.routeId ?? existing.routeId ?? null) as number | null;

    // V5 is create-only: deactivating a customer must not freeze every later
    // edit of an order that already exists.
    if (!(await this.runValidator(row, routeId, companyId, false, res))) {
      return null;
    }

    this.attachWarnings(res, await this.buildWarnings(row));
    return payload;
  }

  /**
   * `number` is server-generated (autonumeradores.md:81,86). A client may only
   * supply one when the company has explicitly enabled it
   * (OrdenDeProduccionForm.cs:483) — otherwise 422, never a silent drop.
   */
  private async enforceNumberGate(
    inputDTO: ProductionOrderCreateInputDTO,
    companyId: number,
    res: Response,
  ): Promise<boolean> {
    if (!inputDTO.sent("number")) return true;
    const allowed = await this.appConfig.getBool(
      companyId,
      PRODUCTION_ORDER_CONFIG_KEYS.allowNumberEdit,
    );
    if (allowed) return true;
    res.status(422).json({
      success: false,
      code: "NUMBER_NOT_EDITABLE",
      message: "number is server-generated",
    });
    return false;
  }

  /**
   * With a pedido the number is dependent on `order_data.number`; without one
   * it is the standalone 8-digit counter. Both formats belong to
   * `CodeGeneratorService` and are never re-implemented here.
   */
  private async nextNumber(
    companyId: number,
    orderDataId: number | null,
  ): Promise<string> {
    if (!orderDataId) {
      return this.codeGenerator.next(companyId, CODE_SCOPES.productionOrder);
    }
    return this.codeGenerator.next(
      companyId,
      CODE_SCOPES.productionOrder,
      await this.dao.getOrderDataNumber(orderDataId),
    );
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  /**
   * SECURITY (L-009): scope the list explicitly. The base class relies on
   * enforceCompanyFilter() mutating req.query, but Express 5 discards those
   * writes. superAdmin without ?companyId= keeps the cross-company view.
   *
   * Query params (flat syntax):
   * - page, limit, sortBy (number|orderDate|deliveryDate|quantity|createdAt),
   *   sortOrder, search (number)
   * - number, uuid, partUuid, orderDataUuid, salesOrderUuid, customerUuid
   * - schedulingState (enabled|disabled), completionState (open|completed),
   *   voidState (active|voided)
   * - deliveryDateFrom, deliveryDateTo, orderDateFrom, orderDateTo
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await this.dao.getAllWithFilters(
        req,
        getCompanyFilterUuid(req),
      );
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  // ── Generation ───────────────────────────────────────────────────────────
  /** `GET /production-orders/generation-eligibility?salesOrderUuid=` */
  public async generationEligibility(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const salesOrderUuid = req.query.salesOrderUuid as string | undefined;
      if (!salesOrderUuid) {
        res
          .status(400)
          .json({ success: false, message: "salesOrderUuid is required" });
        return;
      }
      const eligibility = await this.generation.getEligibility(
        salesOrderUuid,
        getCompanyFilterUuid(req),
      );
      if (!eligibility) {
        res.status(404).json({
          success: false,
          code: "SALES_ORDER_NOT_FOUND",
          message: "Sales order not found",
        });
        return;
      }
      res.status(200).json({ success: true, data: eligibility });
    } catch (err: any) {
      next(err);
    }
  }

  /** `POST /production-orders/generate` */
  public async generate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      let inputDTO: GenerateOrdersInputDTO;
      try {
        inputDTO = new GenerateOrdersInputDTO(req.body).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }

      // A domain verb: every order the run inserts shares this request's
      // `txId`, so the ledger can group one generation back together.
      await setAuditAction("production_order.generate");
      const outcome = await this.generation.generate({
        salesOrderUuid: inputDTO.salesOrderUuid,
        promisedQuantities: inputDTO.promisedQuantities,
        force: inputDTO.force,
        username: req.user?.email ?? "unknown",
        companyUuid: getCompanyFilterUuid(req),
      });

      if (outcome.ok) {
        res.status(201).json({
          success: true,
          data: { generated: outcome.generated, warnings: outcome.warnings },
        });
        return;
      }
      if (outcome.kind === "not-found") {
        res.status(404).json({
          success: false,
          code: "SALES_ORDER_NOT_FOUND",
          message: "Sales order not found",
        });
        return;
      }
      if (outcome.kind === "guard") {
        res.status(outcome.status).json({
          success: false,
          code: outcome.reason.code,
          message: outcome.reason.message,
        });
        return;
      }
      res.status(422).json({
        success: false,
        code: "ORDER_INVALID",
        message: outcome.problems[0],
        problems: outcome.problems,
      });
    } catch (err: any) {
      next(err);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  /**
   * The pedido a completing order belongs to, as a uuid `lockSalesOrderTrx` can
   * take. The chain is fixed by gate decision Q-2:
   * `production_orders.orderDataId → order_data(id) ← sales_orders.orderDataId`
   * (1:1). Null when the order is standalone or its pedido was deleted — then
   * there is nothing to lock and nothing for the roll-up to fulfil either.
   *
   * Read OUTSIDE the transaction on purpose: it only translates an id into the
   * uuid of a row whose pedido↔order_data pairing never changes, and doing it
   * inside would make some OTHER table the first lock the transaction takes.
   */
  private async findSalesOrderUuidToLock(
    orderUuid: string,
    companyUuid?: string,
  ): Promise<string | null> {
    const order = await this.dao.getByUuid(orderUuid, companyUuid);
    const orderDataId = (order as { orderDataId?: number } | null)?.orderDataId;
    if (!orderDataId) return null;
    const salesOrder = await this.dao.readSalesOrderByOrderDataId(orderDataId);
    return salesOrder?.uuid ?? null;
  }

  /**
   * One handler per (machine, action) pair, built from the same body. The three
   * machines are ORTHOGONAL: no transition may be refused because another
   * machine is in some state, so there is no precondition here at all.
   *
   * The write runs inside its own transaction even though it is a single
   * UPDATE. Completion is about to grow a second, dependent write in the same
   * commit (the pedido's fulfillment roll-up, owned by the next feature), and
   * the row's `orderDataId` is kept in scope for exactly that reason — so the
   * wiring is one call inside an existing transaction rather than a rewrite of
   * this handler.
   */
  public lifecycle(machine: LifecycleMachine, action: LifecycleAction) {
    return async (
      req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const companyUuid = getCompanyFilterUuid(req);
        const existingId = await this.dao.getIdByUuid(
          req.params.uuid,
          companyUuid,
        );
        if (!existingId) {
          this.sendNotFound(res);
          return;
        }
        const username = req.user?.email ?? "unknown";
        // Resolved BEFORE the transaction so the lock below is the first
        // statement inside it (see the lock-ordering note there).
        const pedidoUuidToLock =
          machine === "completion" && action === "set"
            ? await this.findSalesOrderUuidToLock(req.params.uuid, companyUuid)
            : null;

        const row = await this.dao.transaction(async (trx) => {
          // DEADLOCK ORDER — sales_orders BEFORE production_orders, always.
          // Manual fulfillment locks the pedido and then reads/updates its OPs;
          // if completion took production_orders first and only then reached
          // sales_orders (through the roll-up below), the two paths would form a
          // cycle. Postgres kills one with 40P01, and on this side that error is
          // raised INSIDE the roll-up's savepoint, where it is caught and
          // logged: the OP transaction would commit and the pedido roll-up would
          // be lost forever — there is no reverse event to replay it. Taking the
          // pedido lock up-front removes the cycle instead of relying on the
          // loser being the other transaction.
          //
          // The lock is taken UNSCOPED. It is a lock, not an authorisation
          // check — the caller's company was already enforced by `getIdByUuid`
          // above, and `findSalesOrderUuidToLock` resolved this uuid through
          // the same unscoped 1:1 chain. Passing `companyUuid` here would make
          // `lockSalesOrderTrx` return null WITHOUT taking any lock whenever
          // its company-scoped join disagreed with that read (an "operating
          // as" superAdmin, a pedido whose company row moved), silently
          // restoring the very ABBA cycle this block exists to prevent.
          if (pedidoUuidToLock) {
            const locked = await this.dao.lockSalesOrderTrx(
              trx,
              pedidoUuidToLock,
            );
            if (!locked) {
              // Only reachable if the pedido was deleted between the resolve
              // and this statement: there is then nothing to lock and nothing
              // for the roll-up to fulfil. Never silent — a null here with the
              // row still present would mean the lock was skipped.
              console.warn(
                `[production-order] pedido ${pedidoUuidToLock} vanished before its lock; ` +
                  `completing order ${req.params.uuid} without the sales_orders lock`,
              );
            }
          }
          // `updated` is the full row, so the pedido this order belongs to
          // (`updated.orderDataId`) is in scope inside the commit — that is the
          // seam the fulfillment roll-up plugs into. The DAO fires the hook for
          // completion/`set` ONLY: `POST /:uuid/complete/cancel` must NOT
          // un-fulfill the pedido, because Procusto reacts to `OrdenCumplida`
          // and ships no reverse event (HandlerEventosPC.cs:20-52). Symmetry
          // here would be a parity regression, not a fix.
          const updated = await this.dao.setLifecycleTrx(
            trx,
            existingId,
            machine,
            action,
            username,
            async (hookTrx, completedRow) => {
              // The roll-up's own writes are audited by the triggers on
              // `sales_orders`, inside this same transaction and `txId`.
              await autoFulfillIfComplete(
                completedRow.orderDataId,
                username,
                hookTrx,
              );
            },
          );
          return updated;
        });

        const updated = row
          ? await this.dao.getByUuid(row.uuid, companyUuid)
          : null;
        res.status(200).json({ success: true, data: updated });
      } catch (err: any) {
        next(err);
      }
    };
  }
}
