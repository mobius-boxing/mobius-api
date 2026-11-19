export const DELIVERY_AMOUNT_TYPES = ["quantity", "percentage"] as const;
export type DeliveryAmountType = (typeof DELIVERY_AMOUNT_TYPES)[number];

/** One element of `deliveries` in a quotation / sales-order body, as validated. */
export interface IDeliveryInput {
  deliveryDate: string;
  deliveryLocationUuid: string | null;
  amountType: DeliveryAmountType;
  amount: number;
}

/** Write-ready row: location already resolved inside the company and customer. */
export interface IDeliveryRow {
  deliveryDate: Date | string;
  deliveryLocationId: number | null;
  amountType: DeliveryAmountType;
  amount: number;
}

export type DeliveryParentColumn = "quotationId" | "salesOrderId";

/** Response object. `quantity` is `amount`, or parentQuantity × amount / 100. */
export interface IDelivery {
  uuid: string;
  position: number;
  deliveryDate: Date;
  deliveryLocation: { uuid: string; address: string | null } | null;
  amountType: DeliveryAmountType;
  amount: number;
  quantity: number;
}

export interface IDeliverySummary {
  deliveries: IDelivery[];
  deliveriesTotal: number;
  deliveriesMatch: boolean;
}

/** Stored row with its numeric ids — internal, never serialised. */
export interface IDeliveryStoredRow extends IDeliveryRow {
  id: number;
  position: number;
  deliveryDate: Date;
}
