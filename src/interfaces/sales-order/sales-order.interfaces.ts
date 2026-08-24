/**
 * Pedido (`plus_Pedidos`) + DatosPedido (`DatosPedidos`) — module 18 sub-area
 * D and module 03 §10.
 *
 * The four Procusto approve/cancel machines stay raw timestamptz+user column
 * pairs; the single `status` label below is DERIVED on read and never
 * persisted (D-4, 04-state-machines.md:65-70). This file is the single source
 * for the status vocabulary and its precedence — never re-derive it in a DAO,
 * controller or frontend copy.
 */

/** First match wins, in this order (Pedido.cs:122-135). */
export const SALES_ORDER_STATUSES = [
  "voided",
  "fulfilled",
  "approved",
  "financially-approved",
  "commercially-approved",
  "pending",
] as const;

export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

/** The five booleans exposed on the DTO: `<pair>At IS NOT NULL`. */
export interface ISalesOrderFlags {
  commerciallyApproved: boolean;
  financiallyApproved: boolean;
  fulfilled: boolean;
  voided: boolean;
  creditLimitOverridden: boolean;
}

export function deriveSalesOrderStatus(
  flags: Pick<
    ISalesOrderFlags,
    "voided" | "fulfilled" | "commerciallyApproved" | "financiallyApproved"
  >,
): SalesOrderStatus {
  if (flags.voided) return "voided";
  if (flags.fulfilled) return "fulfilled";
  if (flags.commerciallyApproved && flags.financiallyApproved)
    return "approved";
  if (flags.financiallyApproved) return "financially-approved";
  if (flags.commerciallyApproved) return "commercially-approved";
  return "pending";
}

/** Nested reference shape on the outward surface: uuid + a label field or two. */
export interface ISalesOrderRef {
  uuid: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  address?: string | null;
  email?: string | null;
}

export interface IOrderData {
  // Internal use only — stripped from the public surface.
  id?: number;
  companyId?: number;
  deliveryLocationId?: number | null;
  customerId?: number | null;

  uuid?: string;
  number?: string | null;
  quantity?: number;
  notes?: string | null;
  dispatchNotes?: string | null;
  conversionNotes?: string | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  deliveryLocation?: ISalesOrderRef | null;
}

export interface ISalesOrder {
  // Internal use only — stripped from the public surface.
  id?: number;
  companyId?: number;
  customerId?: number;
  salesUserId?: number | null;
  productId?: number | null;
  partId?: number | null;
  orderDataId?: number | null;

  uuid?: string;
  number?: string;
  quantity?: number;
  price?: number | null;
  paid?: number | null;
  deliveryDate?: Date | null;
  purchaseOrder?: string | null;
  stockOrder?: boolean;
  specialOrder?: boolean;
  needsAdvanceInvoice?: boolean | null;
  invoiceSent?: boolean | null;
  /** Present ONLY for callers holding orders.view-sales-sector. */
  salesSector?: string | null;
  balancePercentage?: number | null;
  supplierCode?: string | null;
  createdBy?: string | null;

  // The nine lifecycle pairs (read-only in this feature).
  fulfilledAt?: Date | null;
  fulfilledBy?: string | null;
  fulfillmentCancelledAt?: Date | null;
  fulfillmentCancelledBy?: string | null;
  commercialApprovedAt?: Date | null;
  commercialApprovedBy?: string | null;
  commercialCancelledAt?: Date | null;
  commercialCancelledBy?: string | null;
  financialApprovedAt?: Date | null;
  financialApprovedBy?: string | null;
  financialCancelledAt?: Date | null;
  financialCancelledBy?: string | null;
  voidedAt?: Date | null;
  voidedBy?: string | null;
  voidCancelledAt?: Date | null;
  voidCancelledBy?: string | null;
  creditLimitOverrideAt?: Date | null;
  creditLimitOverrideBy?: string | null;

  purchaseOrderImageFileUuid?: string | null;
  quotationFileUuid?: string | null;

  // FK-less integer columns: the modules that own these tables are out of
  // scope, so they stay unwired (Q-4, non-goal 6).
  sheetSupplyId?: number | null;
  quotationId?: number | null;
  paymentTermId?: number | null;
  currencyId?: number | null;

  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins, uuid-only outward).
  customer?: ISalesOrderRef | null;
  product?: ISalesOrderRef | null;
  salesUser?: ISalesOrderRef | null;
  orderData?: IOrderData | null;

  // Derived, never stored.
  /**
   * Column 6 of the grid, built server-side from the TPH subtype exactly as
   * Procusto's overrides do (PedidoDeProducto.cs:19, PedidoDeParte.cs:18,
   * PedidoDePlancha.cs:20); `""` when none of the three is set.
   */
  itemDescription?: string;
  priceTotal?: number | null;
  commerciallyApproved?: boolean;
  financiallyApproved?: boolean;
  fulfilled?: boolean;
  voided?: boolean;
  creditLimitOverridden?: boolean;
  status?: SalesOrderStatus;
}

/**
 * The order_data sub-payload the controller hands to the DAO — resolved to
 * numeric ids, so the DAO's single transaction never resolves a uuid itself.
 */
export interface ISalesOrderOrderDataInput {
  notes?: string | null;
  dispatchNotes?: string | null;
  conversionNotes?: string | null;
  deliveryLocationId?: number | null;
}

/** What SalesOrderDAO.create / update accept (post-resolution). */
export interface ISalesOrderWrite extends ISalesOrder {
  orderDataInput?: ISalesOrderOrderDataInput;
  createdByUsername?: string | null;
}

/**
 * One row of `GET /sales-orders/:uuid/production-orders`
 * (OrdenesAsociadasForm.cs:106-168). Ten fields, uuid-only: the numeric ids of
 * the OP, its parte and its cliente never leave the API.
 */
export interface IAssociatedProductionOrder {
  uuid: string;
  number: string;
  orderDate: Date | string | null;
  deliveryDate: Date | string | null;
  quantity: number;
  part: { uuid: string; code: string | null; description: string | null } | null;
  customer: { uuid: string; name: string | null } | null;
  schedulingApprovedAt: Date | string | null;
  completedAt: Date | string | null;
  voidedAt: Date | string | null;
}
