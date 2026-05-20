// Status union — validated/enforced in TS, no DB enum/CHECK.
// Ordered lifecycle: pending → confirmed → in_production → shipped → delivered.
// STORE_ORDER_STATUSES is the single source of truth for validation/iteration;
// StoreOrderStatus is derived from it so the two can never drift.
export const STORE_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "in_production",
  "shipped",
  "delivered",
] as const;

export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

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
