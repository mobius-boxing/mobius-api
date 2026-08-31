import { toNumberInput as num } from "../../../utils/numbers";
import {
  collect,
  FieldValidationError,
} from "../shared/ValidationError";

/**
 * Pedido DTOs — module 18 sub-area D.
 *
 * `inputValidator` only rejects empty objects, so every required-field and
 * numeric-sanity rule lives in `build()` and THROWS (CLAUDE.md validation
 * rule). Messages always name the offending field.
 *
 * `number` is server-generated (CodeGeneratorService, D-5): a body carrying it
 * is a 400, never a silent drop (L-007). The five references below belong to
 * modules that are out of scope here (PedidoDePlancha, quoting, payment terms,
 * currencies, OC image), so they are rejected rather than
 * accepted-and-ignored.
 */
const UNSUPPORTED_REFERENCES = [
  "sheetSupplyUuid",
  "quotationUuid",
  "paymentTermUuid",
  "currencyUuid",
  "purchaseOrderImageFileUuid",
] as const;

/** Scalars copied straight through when present. */
const PASSTHROUGH_FIELDS = [
  "purchaseOrder",
  "supplierCode",
  "salesSector",
  "notes",
  "dispatchNotes",
  "conversionNotes",
] as const;

const BOOLEAN_FIELDS = ["needsAdvanceInvoice", "invoiceSent"] as const;

export class SalesOrderCreateInputDTO {
  // SECURITY: foreign keys arrive as UUIDs.
  customerUuid?: string;
  productUuid?: string;
  /**
   * The second TPH discriminator (`DBPedido.cs:33,35`): a pedido carries a
   * producto XOR a parte. On the parte path the cliente is DERIVED by the
   * controller from parte → producto → cliente (`PedidoDeParteMapper.cs:19`).
   */
  partUuid?: string;
  deliveryLocationUuid?: string | null;
  salesUserUuid?: string | null;

  quantity?: number;
  price?: number;
  paid?: number;
  deliveryDate?: string | null;

  purchaseOrder?: string | null;
  supplierCode?: string | null;
  salesSector?: string | null;
  needsAdvanceInvoice?: boolean;
  invoiceSent?: boolean;

  // Routed to order_data, not sales_orders.
  notes?: string | null;
  dispatchNotes?: string | null;
  conversionNotes?: string | null;

  /**
   * Raw body keys, so build() can reject server-owned / unsupported ones and
   * the controller can tell "sent as null" from "absent". Defined
   * non-enumerable: controllers spread the DTO into the DB payload, and an
   * enumerable Set would ride along into the insert.
   */
  protected readonly providedKeys!: Set<string>;

  constructor(data: any) {
    const body = data ?? {};
    Object.defineProperty(this, "providedKeys", {
      value: new Set(Object.keys(body)),
      enumerable: false,
    });

    if (body.customerUuid !== undefined) this.customerUuid = body.customerUuid;
    if (body.productUuid !== undefined) this.productUuid = body.productUuid;
    if (body.partUuid !== undefined) this.partUuid = body.partUuid;
    if (body.deliveryLocationUuid !== undefined)
      this.deliveryLocationUuid = body.deliveryLocationUuid || null;
    if (body.salesUserUuid !== undefined)
      this.salesUserUuid = body.salesUserUuid || null;

    if (body.quantity !== undefined) this.quantity = num(body.quantity);
    if (body.price !== undefined) this.price = num(body.price);
    if (body.paid !== undefined) this.paid = num(body.paid);
    if (body.deliveryDate !== undefined)
      this.deliveryDate = body.deliveryDate || null;

    const self = this as Record<string, unknown>;
    for (const key of PASSTHROUGH_FIELDS) {
      if (body[key] !== undefined) self[key] = body[key];
    }
    for (const key of BOOLEAN_FIELDS) {
      if (body[key] !== undefined) self[key] = Boolean(body[key]);
    }
  }

  /** True when the caller sent the key at all (even as null). */
  public sent(key: string): boolean {
    return this.providedKeys.has(key);
  }

  protected rejectServerOwnedFields(): void {
    if (this.providedKeys.has("number")) {
      throw new FieldValidationError(
        "number",
        "number is server-generated",
      );
    }
    for (const key of UNSUPPORTED_REFERENCES) {
      if (this.providedKeys.has(key)) {
        throw new FieldValidationError(key, `${key} is not supported`);
      }
    }
  }

  protected validateQuantity(required: boolean): void {
    if (!this.providedKeys.has("quantity")) {
      if (required)
        throw new FieldValidationError("quantity", "quantity is required");
      return;
    }
    if (this.quantity === undefined) {
      throw new FieldValidationError("quantity", "quantity must be a number");
    }
    // PedidoDeProducto.cs:52-55 — "Debe especificar una cantidad mayor que cero!"
    if (this.quantity <= 0) {
      throw new FieldValidationError(
        "quantity",
        "quantity must be greater than zero",
      );
    }
  }

  protected validateMoney(): void {
    for (const key of ["price", "paid"] as const) {
      if (!this.providedKeys.has(key)) continue;
      const value = this[key];
      if (value === undefined)
        throw new FieldValidationError(key, `${key} must be a number`);
      if (value < 0)
        throw new FieldValidationError(key, `${key} must be zero or greater`);
    }
  }

  protected validateDeliveryDate(): void {
    if (!this.providedKeys.has("deliveryDate")) return;
    if (this.deliveryDate === null) return;
    if (Number.isNaN(new Date(this.deliveryDate as string).getTime())) {
      throw new FieldValidationError(
        "deliveryDate",
        "deliveryDate must be a valid date",
      );
    }
  }

  /** True when the key arrived with a non-blank value. */
  protected filled(key: "customerUuid" | "productUuid" | "partUuid"): boolean {
    return String(this[key] ?? "").trim() !== "";
  }

  /**
   * Rules and messages are UNCHANGED — every string below is what this DTO
   * threw before, down to the Procusto source references. What changed is that
   * they are keyed to a field and aggregated, so a sales order with a bad
   * quantity AND a missing customer reports both, each against its own input,
   * instead of one bare sentence with nothing to attach it to.
   *
   * The discriminator rule (exactly one of productUuid/partUuid) is reported
   * against `productUuid`: it is a cross-field rule with no field of its own,
   * and the product select is the one the user picks first.
   */
  public build(): this {
    collect((field) => {
      field("_server", () => this.rejectServerOwnedFields());
      field("_discriminator", () => this.validateDiscriminator());
      field("quantity", () => this.validateQuantity(true));
      field("money", () => this.validateMoney());
      field("deliveryDate", () => this.validateDeliveryDate());
    });
    return this;
  }

  protected validateDiscriminator(): void {
    // One row per pedido, exactly one discriminator — the table's CHECK
    // (create_sales_orders_tables.ts:208-209) mirrors `PedidoMapper.cs:147-165`.
    // PedidoDeProducto.cs:48-51 "Debe especificar un producto!" /
    // PedidoDeParte.cs:41-45 "Debe especificar una parte!".
    if (this.filled("productUuid") && this.filled("partUuid")) {
      throw new FieldValidationError(
        "productUuid",
        "exactly one of productUuid or partUuid is allowed",
      );
    }
    if (!this.filled("productUuid") && !this.filled("partUuid")) {
      throw new FieldValidationError(
        "productUuid",
        "exactly one of productUuid or partUuid is required",
      );
    }
    if (this.filled("partUuid")) {
      // PedidoDeParteMapper.cs:19 — the cliente is derived from the parte, so a
      // blank explicit customerUuid is a mistake, not a request to derive.
      if (
        this.providedKeys.has("customerUuid") &&
        !this.filled("customerUuid")
      ) {
        throw new FieldValidationError(
          "customerUuid",
          "customerUuid cannot be empty",
        );
      }
    } else if (!this.filled("customerUuid")) {
      // D-1: Mobius picks the cliente first, so customerUuid is required on the
      // producto path even though Procusto derives it from the product.
      throw new FieldValidationError(
        "customerUuid",
        "customerUuid is required",
      );
    }
  }
}

export class SalesOrderUpdateInputDTO extends SalesOrderCreateInputDTO {
  protected validateDiscriminator(): void {
    // customerUuid / productUuid / partUuid stay accepted on PUT so the
    // controller can answer 400 "cannot be changed" for a DIFFERENT value and
    // 200 for the same one (AC-13); emptying them is meaningless either way.
    for (const key of ["customerUuid", "productUuid", "partUuid"] as const) {
      if (this.providedKeys.has(key) && !String(this[key] ?? "").trim()) {
        throw new FieldValidationError(key, `${key} cannot be empty`);
      }
    }
  }

  /**
   * Same aggregation as the create DTO, with `quantity` optional: an update
   * that does not mention it must not demand it. `rejectServerOwnedFields`
   * still runs — a PUT may no more set `number` than a POST may.
   */
  public build(): this {
    collect((field) => {
      field("_server", () => this.rejectServerOwnedFields());
      field("_discriminator", () => this.validateDiscriminator());
      field("quantity", () => this.validateQuantity(false));
      field("money", () => this.validateMoney());
      field("deliveryDate", () => this.validateDeliveryDate());
    });

    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
