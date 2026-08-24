import { toNumberInput as num, toIntInput } from "../../../utils/numbers";
import { IPromisedQuantity } from "../../../interfaces/production-order/production-order.interfaces";

/**
 * Orden de producción DTOs — module 13.
 *
 * `inputValidator` only rejects empty objects, so every type and numeric-sanity
 * rule lives in `build()` and THROWS (CLAUDE.md validation rule).
 *
 * What these DTOs deliberately do NOT enforce: "a part is required" and
 * "quantity must be greater than zero". Those are `Problemas()` rules V1 and V3
 * and must surface as a 422 carrying Procusto's Spanish text, not as a 400
 * naming an English field — otherwise the create path and the generate path
 * would reject the same payload with two different vocabularies.
 *
 * `number` is carried through untouched. Whether a client may supply it at all
 * is a per-company configuration decision, so the gate lives in the controller;
 * silently dropping the field here would be an accepted-and-ignored input.
 *
 * The lifecycle endpoints have NO DTO and NO body on purpose: there is exactly
 * one thing each of them can do, and an unknown key must not be able to change
 * that.
 */

/** Foreign keys arrive as UUIDs (SECURITY: numeric ids never cross the API). */
const REFERENCE_FIELDS = [
  "partUuid",
  "orderDataUuid",
  "salesOrderUuid",
  "routeUuid",
  "palletizationUuid",
] as const;

const BOOLEAN_FIELDS = [
  "newPlate",
  "newPlateReady",
  "newDie",
  "newDieReady",
  "isSample",
  "dispatchable",
] as const;

/** Every nullable float column a client may write. */
const FLOAT_FIELDS = [
  "compression",
  "burst",
  "cobb",
  "testedInternalLength",
  "testedInternalWidth",
  "testedInternalHeight",
  "testedExternalLength",
  "testedExternalWidth",
  "testedExternalHeight",
  "avgGrammage",
  "avgWeight",
  "compressionMax",
  "compressionMin",
  "compressionAvg",
  "cobbMax",
  "cobbMin",
  "cobbAvg",
  "avgBurst",
] as const;

export class ProductionOrderCreateInputDTO {
  partUuid?: string;
  orderDataUuid?: string | null;
  salesOrderUuid?: string | null;
  routeUuid?: string | null;
  palletizationUuid?: string | null;

  number?: string;
  quantity?: number;
  orderDate?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
  lastLabelNumber?: number | null;

  [key: string]: unknown;

  /**
   * Raw body keys, so `build()` and the controller can tell "sent as null" from
   * "absent". Non-enumerable: the controller spreads the DTO into the DB
   * payload and an enumerable Set would ride along into the insert.
   */
  protected readonly providedKeys!: Set<string>;

  constructor(data: any) {
    const body = data ?? {};
    Object.defineProperty(this, "providedKeys", {
      value: new Set(Object.keys(body)),
      enumerable: false,
    });

    const self = this as Record<string, unknown>;
    for (const key of REFERENCE_FIELDS) {
      if (body[key] !== undefined) self[key] = body[key] || null;
    }
    if (body.number !== undefined) this.number = body.number;
    if (body.quantity !== undefined) this.quantity = num(body.quantity);
    if (body.lastLabelNumber !== undefined)
      this.lastLabelNumber = toIntInput(body.lastLabelNumber) ?? null;
    for (const key of ["orderDate", "deliveryDate"] as const) {
      if (body[key] !== undefined) self[key] = body[key] || null;
    }
    if (body.notes !== undefined) this.notes = body.notes ?? null;
    for (const key of BOOLEAN_FIELDS) {
      if (body[key] !== undefined) self[key] = Boolean(body[key]);
    }
    // `null` clears the column; anything unparseable stays `undefined` so
    // build() can reject it instead of silently writing null.
    for (const key of FLOAT_FIELDS) {
      if (body[key] === undefined) continue;
      self[key] =
        body[key] === null || body[key] === "" ? null : num(body[key]);
    }
  }

  /** True when the caller sent the key at all (even as null). */
  public sent(key: string): boolean {
    return this.providedKeys.has(key);
  }

  protected validateTypes(): void {
    if (this.providedKeys.has("quantity") && this.quantity === undefined) {
      throw new Error("quantity must be a number");
    }
    if (this.providedKeys.has("number")) {
      const value = this.number;
      if (typeof value !== "string" || !value.trim()) {
        throw new Error("number must be a non-empty string");
      }
    }
    for (const key of ["orderDate", "deliveryDate"] as const) {
      if (!this.providedKeys.has(key)) continue;
      const value = this[key];
      if (value === null) continue;
      if (Number.isNaN(new Date(value as string).getTime())) {
        throw new Error(`${key} must be a valid date`);
      }
    }
    for (const key of FLOAT_FIELDS) {
      if (!this.providedKeys.has(key)) continue;
      if (this[key] === undefined) throw new Error(`${key} must be a number`);
    }
    // The pedido reference is either its own uuid or the order_data uuid;
    // accepting both and silently preferring one would hide a client bug.
    if (
      this.providedKeys.has("salesOrderUuid") &&
      this.providedKeys.has("orderDataUuid") &&
      this.salesOrderUuid &&
      this.orderDataUuid
    ) {
      throw new Error("send either salesOrderUuid or orderDataUuid, not both");
    }
  }

  public build(): this {
    this.validateTypes();
    return this;
  }
}

export class ProductionOrderUpdateInputDTO extends ProductionOrderCreateInputDTO {
  public build(): this {
    this.validateTypes();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

/**
 * How many `{cantidad, fecha}` rows one generation may carry. The dialog seeds
 * ONE row and a user splits it by hand (`GenerarOrdenesForm.cs:88-97`), so 200
 * is far above any real batch — it is a denial-of-service bound, not a business
 * rule. Each row costs a `code_sequences` upsert on a SEPARATE connection plus
 * an insert, all while the pedido row is held under `FOR UPDATE`; the 100 kb
 * body cap alone would have allowed a few thousand.
 */
const MAX_PROMISED_QUANTITIES = 200;

/**
 * `POST /production-orders/generate`.
 *
 * An EMPTY `promisedQuantities` array is accepted here on purpose: "at least
 * one quantity" is guard G2 and must answer with Procusto's
 * "Se debe especificar al menos una cantidad!", not a DTO 400.
 */
export class GenerateOrdersInputDTO {
  salesOrderUuid!: string;
  promisedQuantities!: IPromisedQuantity[];
  force = false;

  private readonly raw: any;

  constructor(data: any) {
    this.raw = data ?? {};
    if (this.raw.salesOrderUuid !== undefined)
      this.salesOrderUuid = this.raw.salesOrderUuid;
    this.force = this.raw.force === true;
    this.promisedQuantities = [];
  }

  public build(): this {
    if (!this.salesOrderUuid || !String(this.salesOrderUuid).trim()) {
      throw new Error("salesOrderUuid is required");
    }
    const rows = this.raw.promisedQuantities;
    if (!Array.isArray(rows)) {
      throw new Error("promisedQuantities must be an array");
    }
    if (rows.length > MAX_PROMISED_QUANTITIES) {
      throw new Error(
        `promisedQuantities must not exceed ${MAX_PROMISED_QUANTITIES} rows`,
      );
    }
    this.promisedQuantities = rows.map((row: any, index: number) => {
      const quantity = num(row?.quantity);
      if (quantity === undefined) {
        throw new Error(
          `promisedQuantities[${index}].quantity must be a number`,
        );
      }
      const deliveryDate = row?.deliveryDate || null;
      if (
        deliveryDate !== null &&
        Number.isNaN(new Date(deliveryDate).getTime())
      ) {
        throw new Error(
          `promisedQuantities[${index}].deliveryDate must be a valid date`,
        );
      }
      return { quantity, deliveryDate };
    });
    return this;
  }
}
