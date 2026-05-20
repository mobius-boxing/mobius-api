// Status union — validated/enforced in TS, no DB enum.
// v1 only ever writes 'submitted'; the rest are forward-compat.
export type StoreOrderStatus =
  | "submitted"
  | "processing"
  | "fulfilled"
  | "cancelled";

export type StoreOrderItemType = "box" | "roll";

export interface IStoreOrder {
  id?: number;
  uuid?: string;
  companyId?: number;
  storeUserId?: number | null;
  status?: StoreOrderStatus; // defaults to 'submitted' at DB level
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
}

// Lightweight shape for list views ("my orders") that want a count rather than full items.
export interface IStoreOrderWithItemCount extends IStoreOrder {
  itemCount: number;
}
