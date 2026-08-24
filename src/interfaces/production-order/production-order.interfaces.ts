/**
 * OrdenDeProduccion (`OrdenesDeProduccion`) — module 13.
 *
 * This file is the single source for the feature's vocabulary: the six config
 * keys it reads, the three lifecycle machines, and every user-facing Spanish
 * string it can emit. The messages live HERE rather than beside the services
 * that raise them so the acceptance sweeps over `src/services/production-order*`
 * stay honest about what that code does (it calls the code generator; it does
 * not format numbers).
 *
 * Every string below is Procusto's, verbatim — punctuation, accents and the
 * trailing "!" included. Changing one is a parity regression, not a typo fix.
 */

/**
 * The Procusto configuration keys this flow honours. Accents are preserved
 * verbatim (L-010) — `PermitirModificaciónDeNumeroDeOrdenDeProducción` is the
 * real key name and normalising it silently disables the gate.
 */
export const PRODUCTION_ORDER_CONFIG_KEYS = {
  /** Generated orders are born habilitadas. */
  ordersEnabledByDefault: "OrdenesHabilitadasPorDefecto",
  /** V6's ceiling; 0 disables the rule. */
  maxQuantity: "CantidadMaximaEnOrdenes",
  /** Blocks manual creation (not generation). */
  noNewOrders: "NoAgregarOrdenes",
  /** Lets a client supply `number` instead of the generator. */
  allowNumberEdit: "PermitirModificaciónDeNumeroDeOrdenDeProducción",
  /** Generation must produce exactly one order for the whole pedido. */
  oneOrderPerSalesOrder: "UnaOrdenPorPedido",
  /** The pedido needs its OC image before orders may be generated. */
  purchaseOrderImageRequired: "ImagenOCObligatoria",
} as const;

export type ProductionOrderConfigKey =
  (typeof PRODUCTION_ORDER_CONFIG_KEYS)[keyof typeof PRODUCTION_ORDER_CONFIG_KEYS];

/** The three orthogonal lifecycle machines (04-state-machines-lifecycle.md:30-32). */
export const LIFECYCLE_MACHINES = ["scheduling", "completion", "void"] as const;
export type LifecycleMachine = (typeof LIFECYCLE_MACHINES)[number];

/** `set` stamps the machine; `cancel` stamps its reversal. */
export const LIFECYCLE_ACTIONS = ["set", "cancel"] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** Generation guards G2…G10 (G1 is a plain 404 and carries no Procusto text). */
export const GUARD_MESSAGES = {
  NO_QUANTITIES: "Se debe especificar al menos una cantidad!",
  ORDERS_ALREADY_EXIST: "El pedido ya tiene órdenes de producción asociadas",
  SALES_ORDER_WITHOUT_PART:
    "El pedido no tiene parte asociada. No se generarán órdenes",
  SALES_ORDER_WITHOUT_ORDER_DATA:
    "El pedido no tiene datos de pedido asociados",
  ORDER_DATA_WITHOUT_NUMBER: "El pedido no tiene número",
  PURCHASE_ORDER_IMAGE_REQUIRED:
    "No es posible generar la orden de producción sin una imagen de la orden de compra cargada.",
  SALES_ORDER_NOT_APPROVED:
    "No es posible generar órdenes sin aprobación comercial/financiera del pedido",
  SALES_ORDER_VOIDED: "Se intenta generar las órdenes de un pedido anulado.",
  ONE_ORDER_PER_SALES_ORDER: "Solo se permite una orden por pedido",
} as const;

export type GuardCode = keyof typeof GUARD_MESSAGES;

/** `OrdenDeProduccion.Problemas()` V1…V6 (DomainModel/OrdenDeProduccion.cs:332-360). */
export const VALIDATION_MESSAGES = {
  V1: "Debe especificar una parte!",
  V2: "La ruta de la orden debe tener etapas!",
  V3: "Debe especificar una cantidad mayor que cero!",
  V4: "La parte no está aprobada!",
  V5: "El cliente asociado al producto no está activo!",
  /** `{max}` is the CantidadMaximaEnOrdenes value, rendered as-is. */
  V6: (max: number): string =>
    `No se permiten órdenes de producción mayores a ${max} unidades.`,
} as const;

/** Non-blocking advice; never turns a 201 into a 4xx. */
export const WARNING_MESSAGES = {
  /** OrdenDeProduccionForm.cs:634 */
  partProductMismatch: (orderProduct: string, salesOrderProduct: string) =>
    `La parte seleccionada corresponde al producto [${orderProduct}], pero el pedido corresponde al producto [${salesOrderProduct}].`,
  /** OrdenDeProduccionForm.cs:639 */
  quantityAboveSalesOrder:
    "La cantidad registrada en la orden de producción es mayor que la cantidad del pedido.",
  /** GenerarOrdenesForm.cs:101 */
  quantitySumMismatch:
    "La suma de las cantidades no coincide con la cantidad del pedido.",
} as const;

/** One `CantidadPrometida` row (PLSUseCases.Pedidos/CantidadPrometida.cs:5-10). */
export interface IPromisedQuantity {
  quantity: number;
  deliveryDate: string | null;
}

/** A guard that fired, in the order the guards are evaluated. */
export interface IBlockingReason {
  code: GuardCode;
  message: string;
}

/** `GET /production-orders/generation-eligibility` payload. */
export interface IGenerationEligibility {
  canGenerate: boolean;
  alreadyHasOrders: boolean;
  blockingReasons: IBlockingReason[];
  /** True when the only thing standing in the way is the voided-pedido confirm. */
  requiresForce: boolean;
  oneOrderPerSalesOrder: boolean;
  /** The dialog's single seeded row (GenerarOrdenesForm.cs:68-72). */
  defaultRow: { quantity: number; deliveryDate: string | null };
}

/** Nested reference on the outward surface: uuid plus a label field or two. */
export interface IProductionOrderRef {
  uuid: string;
  code?: string | null;
  name?: string | null;
  number?: string | null;
  description?: string | null;
}

export interface IProductionOrder {
  // Internal use only — stripped from the public surface by mapToInterface
  // plus the global sanitize middleware.
  id?: number;
  companyId?: number;
  partId?: number;
  orderDataId?: number | null;
  routeId?: number | null;
  palletizationId?: number | null;

  uuid?: string;
  number?: string;
  orderDate?: Date | null;
  quantity?: number;
  deliveryDate?: Date | null;
  notes?: string | null;

  newPlate?: boolean;
  newPlateReady?: boolean;
  newDie?: boolean;
  newDieReady?: boolean;
  isSample?: boolean;
  dispatchable?: boolean | null;
  lastLabelNumber?: number | null;

  // Quality targets + the denormalised QA snapshot block.
  compression?: number | null;
  burst?: number | null;
  cobb?: number | null;
  testedInternalLength?: number | null;
  testedInternalWidth?: number | null;
  testedInternalHeight?: number | null;
  testedExternalLength?: number | null;
  testedExternalWidth?: number | null;
  testedExternalHeight?: number | null;
  avgGrammage?: number | null;
  avgWeight?: number | null;
  compressionMax?: number | null;
  compressionMin?: number | null;
  compressionAvg?: number | null;
  cobbMax?: number | null;
  cobbMin?: number | null;
  cobbAvg?: number | null;
  avgBurst?: number | null;

  // The three lifecycle machines.
  schedulingApprovedAt?: Date | null;
  schedulingApprovedByUser?: string | null;
  schedulingCancelledAt?: Date | null;
  schedulingCancelledByUser?: string | null;
  completedAt?: Date | null;
  completedByUser?: string | null;
  completionCancelledAt?: Date | null;
  completionCancelledByUser?: string | null;
  voidedAt?: Date | null;
  voidedByUser?: string | null;
  voidCancelledAt?: Date | null;
  voidCancelledByUser?: string | null;

  createdAt?: Date;
  createdByUser?: string | null;
  updatedAt?: Date | null;
  legacyId?: number | null;

  // Related entities (populated by DAO joins, uuid-only outward).
  part?: IProductionOrderRef | null;
  product?: IProductionOrderRef | null;
  customer?: IProductionOrderRef | null;
  orderData?: IProductionOrderRef | null;
  salesOrder?: IProductionOrderRef | null;
  route?: IProductionOrderRef | null;
  palletization?: IProductionOrderRef | null;

  // Derived, never stored (OrdenDeProduccion.cs:109-127).
  habilitada?: boolean;
  cumplida?: boolean;
  anulada?: boolean;
  clisePendiente?: boolean;
  troquelPendiente?: boolean;
}

/** What `validateProductionOrder` inspects beyond the row itself. */
export interface IProductionOrderValidationContext {
  /** Rows in the effective route (`order.routeId ?? part.productionRouteId`). */
  routeStageCount: number;
  /** `parts.partApprovalAt IS NOT NULL`. */
  partApproved: boolean;
  /** `customers.active` for `parts.productId → products.customerId`. */
  customerActive: boolean;
  /** Config `CantidadMaximaEnOrdenes`; 0 (or less) disables V6. */
  maxQuantity: number;
}

/** The subset of a row the validator reads. */
export interface IProductionOrderValidationInput {
  partId?: number | null;
  quantity?: number | null;
}
