/**
 * Quotation DTOs (terminadora-order-flow model.md §Quotations). Like the other
 * hand-validated DTOs they THROW from `build()`; the controller turns a throw
 * into a 400. Server-owned keys are rejected, never silently dropped (L-007).
 */
import { QUOTATION_STATUSES } from "../../../interfaces/quotation/quotation.interfaces";
import { IDeliveryInput } from "../../../interfaces/order-delivery/order-delivery.interfaces";
import { OrderDeliveryService } from "../../../services/order-delivery.service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVER_OWNED_KEYS = [
  "number",
  "approved",
  "approvedAt",
  "approvedByUser",
  "ordered",
  "priceTotal",
  "salesOrder",
  "salesOrderId",
  "salesOrderUuid",
  "createdByUser",
] as const;

function rejectServerOwned(body: Record<string, unknown>): void {
  for (const key of SERVER_OWNED_KEYS) {
    if (key in body) throw new Error(`${key} is server-owned`);
  }
}

function uuidField(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${name} must be a uuid`);
  }
  return value.trim();
}

function numberField(value: unknown, name: string): number {
  const parsed =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function isoDateField(value: unknown, name: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${name} must be an ISO date`);
  }
  return value;
}

function nullableText(value: unknown, name: string): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  return value;
}

export class QuotationCreateInputDTO {
  customerUuid?: string;
  productUuid?: string;
  quantity?: number;
  price?: number;
  deliveryDate?: string | null;
  salesUserUuid?: string | null;
  notes?: string | null;
  status?: (typeof QUOTATION_STATUSES)[number];
  deliveries?: IDeliveryInput[];

  protected readonly body: Record<string, unknown>;

  constructor(data: unknown) {
    this.body =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  }

  protected validate(required: boolean): void {
    const body = this.body;
    rejectServerOwned(body);
    const has = (key: string): boolean => body[key] !== undefined;

    if (required || has("customerUuid")) {
      this.customerUuid = uuidField(body.customerUuid, "customerUuid");
    }
    if (required || has("productUuid")) {
      this.productUuid = uuidField(body.productUuid, "productUuid");
    }
    if (required || has("quantity")) {
      this.quantity = numberField(body.quantity, "quantity");
      if (this.quantity <= 0)
        throw new Error("quantity must be greater than zero");
    }
    if (required || has("price")) {
      this.price = numberField(body.price, "price");
      if (this.price < 0) throw new Error("price must be zero or greater");
    }
    if (has("deliveryDate")) {
      this.deliveryDate =
        body.deliveryDate === null
          ? null
          : isoDateField(body.deliveryDate, "deliveryDate");
    }
    if (has("salesUserUuid")) {
      this.salesUserUuid =
        body.salesUserUuid === null
          ? null
          : uuidField(body.salesUserUuid, "salesUserUuid");
    }
    if (has("deliveries")) {
      this.deliveries = OrderDeliveryService.parseInput(body.deliveries);
    }
    if (has("notes")) this.notes = nullableText(body.notes, "notes");
    if (has("status")) {
      if (!(QUOTATION_STATUSES as readonly unknown[]).includes(body.status)) {
        throw new Error(
          `status must be one of ${QUOTATION_STATUSES.join(", ")}`,
        );
      }
      this.status = body.status as (typeof QUOTATION_STATUSES)[number];
    }
  }

  public build(): this {
    this.validate(true);
    return this;
  }
}

/** Every field optional; `quantity` and `price` are still validated when present (never nullable). */
export class QuotationUpdateInputDTO extends QuotationCreateInputDTO {
  public build(): this {
    this.validate(false);
    return this;
  }
}

export class QuotationApprovalInputDTO {
  approved!: boolean;

  constructor(private readonly data: unknown) {}

  public build(): this {
    const body = (this.data ?? {}) as Record<string, unknown>;
    if (typeof body.approved !== "boolean") {
      throw new Error("approved must be a boolean");
    }
    this.approved = body.approved;
    return this;
  }
}

export class QuotationGenerateOrderInputDTO {
  deliveryDate?: string;
  purchaseOrder?: string;
  deliveryLocationUuid?: string;

  constructor(private readonly data: unknown) {}

  public build(): this {
    const body =
      this.data && typeof this.data === "object"
        ? (this.data as Record<string, unknown>)
        : {};
    if (body.deliveryDate !== undefined) {
      this.deliveryDate = isoDateField(body.deliveryDate, "deliveryDate");
    }
    if (body.purchaseOrder !== undefined) {
      if (typeof body.purchaseOrder !== "string") {
        throw new Error("purchaseOrder must be text");
      }
      this.purchaseOrder = body.purchaseOrder;
    }
    if (body.deliveryLocationUuid !== undefined) {
      this.deliveryLocationUuid = uuidField(
        body.deliveryLocationUuid,
        "deliveryLocationUuid",
      );
    }
    return this;
  }
}
