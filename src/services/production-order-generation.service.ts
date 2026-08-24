import { v4 as uuidv4 } from "uuid";
import {
  ProductionOrderDAO,
  ILockedSalesOrder,
} from "../dao/production-order/production-order.dao";
import {
  GUARD_MESSAGES,
  GuardCode,
  IBlockingReason,
  IGenerationEligibility,
  IProductionOrder,
  IPromisedQuantity,
  PRODUCTION_ORDER_CONFIG_KEYS,
  WARNING_MESSAGES,
} from "../interfaces/production-order/production-order.interfaces";
import { AppConfigService } from "./app-config.service";
import { CodeGeneratorService, CODE_SCOPES } from "./code-generator.service";
import { validateProductionOrder } from "./production-order-validator.service";

/**
 * "Generar órdenes de producción" — `PLSUseCases.PedidosDePartes/Editar.cs:60-107`.
 *
 * Two structural decisions worth stating where they live:
 *
 * (a) VALIDATE BEFORE NUMBERING. `CodeGeneratorService` advances its counter on
 *     its OWN connection and therefore cannot join this transaction, so a
 *     rolled-back batch would burn counter values. Every row is validated
 *     first; only then does the number-and-insert loop start. An aborted batch
 *     after numbering still leaves a gap in the pedido's suffixes — gaps are
 *     harmless and no rule forbids them.
 *
 * (b) ALL OR NOTHING (divergence D-2). Procusto silently saves the valid subset
 *     of an invalid batch, which flips "this pedido has orders" true and
 *     permanently blocks regeneration. One transaction, all rows or none.
 *
 * The only numbering call in this file is `codeGenerator.next(...)`. There is
 * no formatting here, by design: the pedido-dependent format is the generator's
 * (autonumeradores.md:86) and duplicating it is how the two drift apart.
 */

/** HTTP status per guard, per the spec's guard table. */
const GUARD_STATUS: Record<GuardCode, number> = {
  NO_QUANTITIES: 422,
  ORDERS_ALREADY_EXIST: 409,
  SALES_ORDER_WITHOUT_PART: 422,
  SALES_ORDER_WITHOUT_ORDER_DATA: 422,
  ORDER_DATA_WITHOUT_NUMBER: 422,
  PURCHASE_ORDER_IMAGE_REQUIRED: 422,
  SALES_ORDER_NOT_APPROVED: 409,
  SALES_ORDER_VOIDED: 409,
  ONE_ORDER_PER_SALES_ORDER: 422,
};

export interface IGenerationConfig {
  purchaseOrderImageRequired: boolean;
  oneOrderPerSalesOrder: boolean;
  ordersEnabledByDefault: boolean;
  maxQuantity: number;
}

export interface IGuardInput {
  salesOrder: Pick<
    ILockedSalesOrder,
    | "partId"
    | "orderDataId"
    | "orderDataNumber"
    | "quantity"
    | "commercialApprovedAt"
    | "financialApprovedAt"
    | "voidedAt"
    | "purchaseOrderImageFileUuid"
  >;
  existingOrderCount: number;
  promisedQuantities: IPromisedQuantity[];
  force: boolean;
  config: Pick<
    IGenerationConfig,
    "purchaseOrderImageRequired" | "oneOrderPerSalesOrder"
  >;
}

export type GenerationOutcome =
  | { ok: true; generated: IProductionOrder[]; warnings: string[] }
  | { ok: false; kind: "not-found" }
  | { ok: false; kind: "guard"; status: number; reason: IBlockingReason }
  | { ok: false; kind: "invalid"; problems: string[] };

const reason = (code: GuardCode): IBlockingReason => ({
  code,
  message: GUARD_MESSAGES[code],
});

/**
 * G2…G10, evaluated in the spec's order and returned in that order. Read-only
 * and pure: `getEligibility` and `generate` share it so the dialog can never
 * disagree with the endpoint. G1 (pedido not found) is the caller's 404 — it
 * has no Procusto message.
 *
 * G5 and G6 are unreachable through the sales-order API (its create path always
 * writes an `order_data` row with a number). They exist because the Mobius
 * split makes the FK nullable and the column optional, and failing loudly beats
 * emitting an unusable order number (divergences D-4, D-5).
 */
export function evaluateGuards(input: IGuardInput): IBlockingReason[] {
  const { salesOrder, promisedQuantities, config } = input;
  const reasons: IBlockingReason[] = [];

  if (promisedQuantities.length === 0) reasons.push(reason("NO_QUANTITIES"));
  if (input.existingOrderCount > 0)
    reasons.push(reason("ORDERS_ALREADY_EXIST"));
  if (salesOrder.partId == null)
    reasons.push(reason("SALES_ORDER_WITHOUT_PART"));
  if (salesOrder.orderDataId == null)
    reasons.push(reason("SALES_ORDER_WITHOUT_ORDER_DATA"));
  if (!salesOrder.orderDataNumber || !String(salesOrder.orderDataNumber).trim())
    reasons.push(reason("ORDER_DATA_WITHOUT_NUMBER"));
  if (
    config.purchaseOrderImageRequired &&
    salesOrder.purchaseOrderImageFileUuid == null
  )
    reasons.push(reason("PURCHASE_ORDER_IMAGE_REQUIRED"));
  if (
    salesOrder.commercialApprovedAt == null ||
    salesOrder.financialApprovedAt == null
  )
    reasons.push(reason("SALES_ORDER_NOT_APPROVED"));
  if (salesOrder.voidedAt != null && input.force !== true)
    reasons.push(reason("SALES_ORDER_VOIDED"));
  if (
    config.oneOrderPerSalesOrder &&
    (promisedQuantities.length !== 1 ||
      promisedQuantities[0].quantity !== salesOrder.quantity)
  )
    reasons.push(reason("ONE_ORDER_PER_SALES_ORDER"));

  return reasons;
}

export class ProductionOrderGenerationService {
  private dao = new ProductionOrderDAO();
  private appConfig = new AppConfigService();
  private codeGenerator = new CodeGeneratorService();

  /** The four config toggles this flow honours, resolved for one company. */
  async loadConfig(companyId: number): Promise<IGenerationConfig> {
    const [
      purchaseOrderImageRequired,
      oneOrderPerSalesOrder,
      ordersEnabledByDefault,
      maxQuantity,
    ] = await Promise.all([
      this.appConfig.getBool(
        companyId,
        PRODUCTION_ORDER_CONFIG_KEYS.purchaseOrderImageRequired,
      ),
      this.appConfig.getBool(
        companyId,
        PRODUCTION_ORDER_CONFIG_KEYS.oneOrderPerSalesOrder,
      ),
      this.appConfig.getBool(
        companyId,
        PRODUCTION_ORDER_CONFIG_KEYS.ordersEnabledByDefault,
      ),
      this.appConfig.getNumber(
        companyId,
        PRODUCTION_ORDER_CONFIG_KEYS.maxQuantity,
      ),
    ]);
    return {
      purchaseOrderImageRequired,
      oneOrderPerSalesOrder,
      ordersEnabledByDefault,
      maxQuantity,
    };
  }

  /**
   * `GET /production-orders/generation-eligibility`. Runs the same guards
   * read-only against the pedido's DEFAULT proposal (one row = the whole
   * pedido, GenerarOrdenesForm.cs:68-72), so a dialog that has not been edited
   * yet is never told "no" for a reason the user could fix by pressing Sí.
   *
   * A voided pedido is not a blocker but a confirm (PedidoDeParteForm.cs:180),
   * so the guards run with `force` and `requiresForce` reports it separately.
   */
  async getEligibility(
    salesOrderUuid: string,
    companyUuid?: string,
  ): Promise<IGenerationEligibility | null> {
    const salesOrder = await this.dao.readSalesOrderForGeneration(
      salesOrderUuid,
      companyUuid,
    );
    if (!salesOrder) return null;

    const existingOrderCount = salesOrder.orderDataId
      ? await this.dao.countByOrderDataId(salesOrder.orderDataId)
      : 0;
    const config = await this.loadConfig(salesOrder.companyId);
    const defaultRow = {
      quantity: salesOrder.quantity,
      deliveryDate: salesOrder.deliveryDate
        ? new Date(salesOrder.deliveryDate).toISOString()
        : null,
    };

    const blockingReasons = evaluateGuards({
      salesOrder,
      existingOrderCount,
      promisedQuantities: [defaultRow],
      force: true,
      config,
    });

    return {
      canGenerate: blockingReasons.length === 0,
      alreadyHasOrders: existingOrderCount > 0,
      blockingReasons,
      requiresForce: salesOrder.voidedAt != null,
      oneOrderPerSalesOrder: config.oneOrderPerSalesOrder,
      defaultRow,
    };
  }

  /** `POST /production-orders/generate`. One transaction, all rows or none. */
  async generate(args: {
    salesOrderUuid: string;
    promisedQuantities: IPromisedQuantity[];
    force: boolean;
    username: string;
    companyUuid?: string;
  }): Promise<GenerationOutcome> {
    const outcome = await this.dao.transaction<GenerationOutcome>(
      async (trx) => {
        const salesOrder = await this.dao.lockSalesOrderTrx(
          trx,
          args.salesOrderUuid,
          args.companyUuid,
        );
        if (!salesOrder) return { ok: false, kind: "not-found" };

        const existingOrderCount = salesOrder.orderDataId
          ? await this.dao.countByOrderDataId(salesOrder.orderDataId, trx)
          : 0;
        const config = await this.loadConfig(salesOrder.companyId);

        const blockingReasons = evaluateGuards({
          salesOrder,
          existingOrderCount,
          promisedQuantities: args.promisedQuantities,
          force: args.force,
          config,
        });
        if (blockingReasons.length > 0) {
          const first = blockingReasons[0];
          return {
            ok: false,
            kind: "guard",
            status: GUARD_STATUS[first.code],
            reason: first,
          };
        }

        const rows = this.buildRows(salesOrder, args, config);

        // (a) Every row is validated BEFORE the first number is drawn.
        const context = await this.dao.loadOrderValidationContext(
          { partId: salesOrder.partId },
          trx,
        );
        const problems = new Set<string>();
        for (const row of rows) {
          const validation = validateProductionOrder(
            { partId: row.partId ?? null, quantity: row.quantity ?? 0 },
            {
              routeStageCount: context?.routeStageCount ?? 0,
              partApproved: context?.partApproved ?? false,
              customerActive: context?.customerActive ?? false,
              maxQuantity: config.maxQuantity,
            },
            { isNew: true },
          );
          for (const problem of validation.problems) problems.add(problem);
        }
        if (problems.size > 0) {
          return { ok: false, kind: "invalid", problems: [...problems] };
        }

        const generated: IProductionOrder[] = [];
        for (const row of rows) {
          const number = await this.codeGenerator.next(
            salesOrder.companyId,
            CODE_SCOPES.productionOrder,
            salesOrder.orderDataNumber,
          );
          const inserted = await this.dao.insertTrx(trx, { ...row, number });
          generated.push(this.dao.mapToInterface(inserted));
        }

        return {
          ok: true,
          generated,
          warnings: this.buildWarnings(salesOrder, args.promisedQuantities),
        };
      },
    );

    // Re-read after the commit so `generated` carries the same joined shape as
    // GET /production-orders/:uuid. Inside the transaction the joins are not
    // visible to any other connection, so this cannot be done there.
    if (outcome.ok) {
      const rehydrated = await Promise.all(
        outcome.generated.map(async (order) =>
          order.uuid
            ? ((await this.dao.getByUuid(order.uuid)) ?? order)
            : order,
        ),
      );
      return { ...outcome, generated: rehydrated };
    }
    return outcome;
  }

  /**
   * The field copy set of `PedidosDePartes/Editar.cs:90-104`.
   *
   * `completedAt`/`completedByUser` are copied STRAIGHT FROM THE PEDIDO
   * (`:98-99`), so generating from an already-fulfilled pedido yields orders
   * that are born cumplidas. That reads like a bug and is not one — it is the
   * documented copy semantics, and downstream features must not treat such an
   * order as a fresh completion event.
   *
   * Everything else (quality targets, plate/die flags, palletizado, route
   * override, the QA snapshot) stays at its column default: nothing is copied
   * from the parte at generation time.
   */
  private buildRows(
    salesOrder: ILockedSalesOrder,
    args: { promisedQuantities: IPromisedQuantity[]; username: string },
    config: IGenerationConfig,
  ): IProductionOrder[] {
    const now = new Date();
    return args.promisedQuantities.map((row) => ({
      uuid: uuidv4(),
      companyId: salesOrder.companyId,
      orderDataId: salesOrder.orderDataId,
      partId: salesOrder.partId as number,
      quantity: row.quantity,
      deliveryDate: row.deliveryDate ? new Date(row.deliveryDate) : null,
      orderDate: now,
      createdByUser: args.username,
      completedAt: salesOrder.fulfilledAt,
      completedByUser: salesOrder.fulfilledBy,
      dispatchable: false,
      schedulingApprovedAt: config.ordersEnabledByDefault ? now : null,
      schedulingApprovedByUser: config.ordersEnabledByDefault
        ? args.username
        : null,
      schedulingCancelledAt: null,
      schedulingCancelledByUser: null,
    }));
  }

  /** Non-blocking advice (GenerarOrdenesForm.cs:101). Never turns 201 into 4xx. */
  private buildWarnings(
    salesOrder: ILockedSalesOrder,
    promisedQuantities: IPromisedQuantity[],
  ): string[] {
    const total = promisedQuantities.reduce(
      (sum, row) => sum + (row.quantity ?? 0),
      0,
    );
    return total !== salesOrder.quantity
      ? [WARNING_MESSAGES.quantitySumMismatch]
      : [];
  }
}
