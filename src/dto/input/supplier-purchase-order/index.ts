/**
 * Supplier purchase order + receipt DTOs (terminadora-order-flow model.md).
 * `build()` throws on invalid input and the controller answers 400; server-owned
 * keys are rejected rather than dropped (L-007).
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function uuidField(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${name} must be a uuid`);
  }
  return value.trim();
}

function notesField(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("notes must be text");
  return value;
}

function isoDateField(value: unknown, name: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${name} must be an ISO date`);
  }
  return value;
}

function positiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be an integer greater than zero`);
  }
  return value;
}

export class SupplierPurchaseOrderCreateInputDTO {
  machineUuid!: string;
  productionOrderUuids!: string[];
  notes?: string | null;

  constructor(private readonly data: unknown) {}

  public build(): this {
    const body = isObject(this.data) ? this.data : {};
    this.machineUuid = uuidField(body.machineUuid, "machineUuid");
    if (
      !Array.isArray(body.productionOrderUuids) ||
      body.productionOrderUuids.length === 0
    ) {
      throw new Error(
        "productionOrderUuids must be a non-empty array of uuids",
      );
    }
    this.productionOrderUuids = body.productionOrderUuids.map((u, i) =>
      uuidField(u, `productionOrderUuids[${i}]`),
    );
    if (body.notes !== undefined) this.notes = notesField(body.notes);
    return this;
  }
}

export interface IPurchaseOrderLineInput {
  productionOrderUuid: string;
  quantity?: number;
  deliveryDate?: string | null;
}

export class SupplierPurchaseOrderUpdateInputDTO {
  notes?: string | null;
  lines?: IPurchaseOrderLineInput[];

  constructor(private readonly data: unknown) {}

  public build(): this {
    const body = isObject(this.data) ? this.data : {};
    if ("machineUuid" in body) {
      throw new Error(
        "machineUuid cannot be changed: delete the draft and create another",
      );
    }
    if (body.notes !== undefined) this.notes = notesField(body.notes);
    if (body.lines !== undefined) {
      if (!Array.isArray(body.lines)) throw new Error("lines must be an array");
      this.lines = body.lines.map((raw, i) => {
        if (!isObject(raw)) throw new Error(`lines[${i}] must be an object`);
        const line: IPurchaseOrderLineInput = {
          productionOrderUuid: uuidField(
            raw.productionOrderUuid,
            `lines[${i}].productionOrderUuid`,
          ),
        };
        if (raw.quantity !== undefined) {
          line.quantity = positiveInt(raw.quantity, `lines[${i}].quantity`);
        }
        if (raw.deliveryDate !== undefined) {
          line.deliveryDate =
            raw.deliveryDate === null
              ? null
              : isoDateField(raw.deliveryDate, `lines[${i}].deliveryDate`);
        }
        return line;
      });
    }
    if (this.notes === undefined && this.lines === undefined) {
      throw new Error("No updatable field was sent");
    }
    return this;
  }
}

const RECEIPT_SERVER_OWNED = [
  "receivedByUser",
  "productStockUuid",
  "productStockId",
  "lineId",
  "lineUuid",
] as const;

export class SupplierReceiptCreateInputDTO {
  quantity!: number;
  warehouseUuid!: string;
  receivedAt?: string;
  confirmMismatch?: boolean;
  closeLine?: boolean;
  notes?: string | null;

  constructor(private readonly data: unknown) {}

  public build(): this {
    const body = isObject(this.data) ? this.data : {};
    for (const key of RECEIPT_SERVER_OWNED) {
      if (key in body) throw new Error(`${key} is server-owned`);
    }
    this.quantity = positiveInt(body.quantity, "quantity");
    this.warehouseUuid = uuidField(body.warehouseUuid, "warehouseUuid");
    if (body.receivedAt !== undefined) {
      this.receivedAt = isoDateField(body.receivedAt, "receivedAt");
    }
    for (const key of ["confirmMismatch", "closeLine"] as const) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean")
        throw new Error(`${key} must be a boolean`);
      this[key] = body[key] as boolean;
    }
    if (body.notes !== undefined) this.notes = notesField(body.notes);
    return this;
  }
}
