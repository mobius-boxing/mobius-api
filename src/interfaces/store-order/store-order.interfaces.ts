// Status union — validated/enforced in TS, no DB enum/CHECK.
//
// Single source of truth for the lifecycle. Two const tuples, one purpose each:
//   - STORE_ORDER_FLOW: the LINEAR happy-path lifecycle, in order. Iterate THIS
//     when you need the ordered steps (e.g. the frontend stepper).
//   - STORE_ORDER_STATUSES: the FULL validation set = the linear flow PLUS the
//     terminal `cancelled` branch. Use THIS for `.includes()` validation.
// StoreOrderStatus is derived from STORE_ORDER_STATUSES so they can never drift.
export const STORE_ORDER_FLOW = [
  "pending",
  "confirmed",
  "in_production",
  "shipped",
  "delivered",
] as const;

export const STORE_ORDER_STATUSES = [...STORE_ORDER_FLOW, "cancelled"] as const; // all valid statuses

export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

// Admin-driven transitions: advance exactly one step along the linear flow, or
// cancel while still pre-shipped. `delivered` and `cancelled` are terminal (no
// outgoing transitions). This is the ONLY allow-list the server enforces for
// admin status changes; the customer cancel path is gated separately (pending-only).
export const STORE_ORDER_ADMIN_TRANSITIONS: Record<
  StoreOrderStatus,
  StoreOrderStatus[]
> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_production", "cancelled"],
  in_production: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

// True iff an admin may move an order from `from` to `to`. Unknown statuses → false.
export const canAdminTransition = (
  from: StoreOrderStatus,
  to: StoreOrderStatus,
): boolean => STORE_ORDER_ADMIN_TRANSITIONS[from]?.includes(to) ?? false;

export type StoreOrderItemType = "box" | "roll";

export interface IStoreOrder {
  id?: number;
  uuid?: string;
  companyId?: number;
  storeUserId?: number | null;
  status?: StoreOrderStatus; // defaults to 'pending' at DB level
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IStoreOrderItem {
  id?: number;
  uuid?: string;
  orderId?: number;
  itemType: StoreOrderItemType;
  sourceUuid?: string | null; // soft reference to store_box/store_roll uuid
  description: string; // snapshot at order time
  quantity: number;
  unitsPerPallet?: number | null; // snapshot for boxes; null for rolls
  createdAt?: Date;
}

// Aggregate returned by create / getByUuid.
export interface IStoreOrderWithItems extends IStoreOrder {
  items: IStoreOrderItem[];
  storeUserEmail?: string; // populated when the read joins store_users (admin views)
}

// Lightweight shape for list views that want a count rather than full items.
// `storeUserEmail` is populated by getAllForCompany (admin list); it is left
// undefined by getAllForStoreUser (a store user already knows it's their own order).
export interface IStoreOrderWithItemCount extends IStoreOrder {
  itemCount: number;
  storeUserEmail?: string;
}
