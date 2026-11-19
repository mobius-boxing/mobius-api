import { IDeliverySummary } from "../order-delivery/order-delivery.interfaces";

export const QUOTATION_STATUSES = [
  "draft",
  "informed",
  "accepted",
  "rejected",
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export interface IQuotation extends Partial<IDeliverySummary> {
  uuid?: string;
  number?: number;
  customer?: { uuid: string; name: string } | null;
  product?: {
    uuid: string;
    code: string;
    description: string | null;
  } | null;
  quantity?: number;
  price?: number;
  priceTotal?: number;
  deliveryDate?: Date | null;
  salesUser?: { uuid: string; name: string } | null;
  notes?: string | null;
  status?: QuotationStatus;
  approved?: boolean;
  approvedAt?: Date | null;
  approvedByUser?: string | null;
  ordered?: boolean;
  salesOrder?: { uuid: string; number: string } | null;
  createdByUser?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** The stored row with its numeric ids — internal to DAO and controller, never serialised. */
export interface IQuotationRow {
  id: number;
  uuid: string;
  companyId: number;
  customerId: number;
  productId: number;
  quantity: number;
  price: number;
  deliveryDate: Date | null;
  salesUserId: number | null;
  notes: string | null;
  status: QuotationStatus;
  approvedAt: Date | null;
  approvedByUser: string | null;
  salesOrderId: number | null;
}

export interface IQuotationWrite {
  companyId?: number;
  customerId?: number;
  productId?: number;
  quantity?: number;
  price?: number;
  deliveryDate?: Date | string | null;
  salesUserId?: number | null;
  notes?: string | null;
  status?: QuotationStatus;
  createdByUser?: string | null;
}

export interface IGenerateOrderResult {
  quotation: IQuotation;
  salesOrder: { uuid: string; number: string };
  productionOrders: { uuid: string; number: string }[];
  warnings?: string[];
}
