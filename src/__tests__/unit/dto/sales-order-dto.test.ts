/**
 * AC-7 / AC-9 — SalesOrder DTO validation.
 *
 * `inputValidator` only rejects empty objects, so every rule below must live
 * in `build()` and THROW. Each assertion also checks the message names the
 * offending field, so a caller can fix the request without guessing.
 */
import { describe, it, expect } from "@jest/globals";
import {
  SalesOrderCreateInputDTO,
  SalesOrderUpdateInputDTO,
} from "../../../dto/input/sales-order";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const PART = "33333333-3333-4333-8333-333333333333";

const validBody = (overrides: Record<string, unknown> = {}) => ({
  customerUuid: CUSTOMER,
  productUuid: PRODUCT,
  quantity: 100,
  ...overrides,
});

describe("SalesOrderCreateInputDTO", () => {
  it("accepts a minimal valid body", () => {
    const dto = new SalesOrderCreateInputDTO(validBody()).build();

    expect(dto.customerUuid).toBe(CUSTOMER);
    expect(dto.productUuid).toBe(PRODUCT);
    expect(dto.quantity).toBe(100);
  });

  it("keeps the order_data notes fields on the DTO", () => {
    const dto = new SalesOrderCreateInputDTO(
      validBody({
        notes: "obs",
        dispatchNotes: "desp",
        conversionNotes: "conv",
      }),
    ).build();

    expect(dto.notes).toBe("obs");
    expect(dto.dispatchNotes).toBe("desp");
    expect(dto.conversionNotes).toBe("conv");
  });

  it("does not leak its internal key set into the persisted payload", () => {
    const dto = new SalesOrderCreateInputDTO(validBody()).build();

    expect(Object.keys({ ...dto })).not.toContain("providedKeys");
  });

  // ── AC-7: quantity / required references ─────────────────────────────────
  it("rejects quantity 0 naming the field (AC-7)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ quantity: 0 })).build(),
    ).toThrow(/quantity/);
  });

  it("rejects quantity -1 naming the field (AC-7)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ quantity: -1 })).build(),
    ).toThrow(/quantity/);
  });

  it("rejects a non-numeric quantity naming the field (AC-7)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ quantity: "abc" })).build(),
    ).toThrow(/quantity/);
  });

  it("rejects a missing quantity naming the field (AC-7)", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).quantity;

    expect(() => new SalesOrderCreateInputDTO(body).build()).toThrow(
      /quantity/,
    );
  });

  it("rejects a missing productUuid naming the field (AC-7)", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).productUuid;

    expect(() => new SalesOrderCreateInputDTO(body).build()).toThrow(
      /productUuid/,
    );
  });

  it("rejects a missing customerUuid naming the field (AC-7)", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).customerUuid;

    expect(() => new SalesOrderCreateInputDTO(body).build()).toThrow(
      /customerUuid/,
    );
  });

  // ── AC-9: `parts` removed — partUuid is unsupported, not a discriminator ──
  // (formerly AC-2's TPH-discriminator suite; every case below sent partUuid
  // and is now rejected outright instead of accepted as the parte leg.)
  it("rejects partUuid alone instead of deriving anything from it (AC-9, was AC-2)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO({
        partUuid: PART,
        quantity: 100,
      }).build(),
    ).toThrow("partUuid is not supported");
  });

  it("rejects partUuid outright, naming the field (AC-9, D-1, L-007)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ partUuid: PART })).build(),
    ).toThrow("partUuid is not supported");
  });

  it("rejects neither productUuid nor partUuid, naming productUuid (AC-9, was AC-2)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO({
        customerUuid: CUSTOMER,
        quantity: 100,
      }).build(),
    ).toThrow(/productUuid/);
  });

  it("rejects a blank partUuid the same as a filled one — presence alone is unsupported (AC-9, was AC-2)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO({ partUuid: "   ", quantity: 100 }).build(),
    ).toThrow("partUuid is not supported");
  });

  it("rejects partUuid even alongside a customerUuid the controller would otherwise check (AC-9, was AC-4)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO({
        partUuid: PART,
        customerUuid: CUSTOMER,
        quantity: 100,
      }).build(),
    ).toThrow("partUuid is not supported");
  });

  it("rejects partUuid AND an emptied customerUuid together, naming both (AC-9, was AC-4)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO({
        partUuid: PART,
        customerUuid: "",
        quantity: 100,
      }).build(),
    ).toThrow(/partUuid is not supported/);
  });

  it("rejects partUuid even without productUuid (AC-9)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO({
        customerUuid: CUSTOMER,
        partUuid: PART,
        quantity: 100,
      }).build(),
    ).toThrow("partUuid is not supported");
  });

  // ── AC-9: server-generated / unsupported keys ────────────────────────────
  it("rejects a body carrying number instead of ignoring it (AC-9, L-007)", () => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ number: "00000042" })).build(),
    ).toThrow("number is server-generated");
  });

  it.each([
    "partUuid",
    "sheetSupplyUuid",
    "quotationUuid",
    "paymentTermUuid",
    "currencyUuid",
    "purchaseOrderImageFileUuid",
  ])("rejects the out-of-scope reference %s (AC-9, L-007)", (key) => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ [key]: PRODUCT })).build(),
    ).toThrow(`${key} is not supported`);
  });

  // ── money & dates ────────────────────────────────────────────────────────
  it.each(["price", "paid"])("rejects a negative %s", (key) => {
    expect(() =>
      new SalesOrderCreateInputDTO(validBody({ [key]: -0.01 })).build(),
    ).toThrow(new RegExp(key));
  });

  it.each(["price", "paid"])("accepts %s = 0", (key) => {
    const dto = new SalesOrderCreateInputDTO(validBody({ [key]: 0 })).build();

    expect((dto as unknown as Record<string, unknown>)[key]).toBe(0);
  });

  it("rejects an unparseable deliveryDate", () => {
    expect(() =>
      new SalesOrderCreateInputDTO(
        validBody({ deliveryDate: "not-a-date" }),
      ).build(),
    ).toThrow(/deliveryDate/);
  });

  it("accepts an empty deliveryDate as a clear", () => {
    const dto = new SalesOrderCreateInputDTO(
      validBody({ deliveryDate: "" }),
    ).build();

    expect(dto.deliveryDate).toBeNull();
  });
});

describe("SalesOrderUpdateInputDTO", () => {
  it("allows a partial body without the create-only requirements", () => {
    const dto = new SalesOrderUpdateInputDTO({ purchaseOrder: "OC-1" }).build();

    expect(dto.purchaseOrder).toBe("OC-1");
    expect(dto.customerUuid).toBeUndefined();
  });

  it("still rejects quantity <= 0 (AC-7)", () => {
    expect(() => new SalesOrderUpdateInputDTO({ quantity: 0 }).build()).toThrow(
      /quantity/,
    );
  });

  it("still rejects a body carrying number (AC-9)", () => {
    expect(() =>
      new SalesOrderUpdateInputDTO({ number: "00000042" }).build(),
    ).toThrow("number is server-generated");
  });

  it("keeps customerUuid/productUuid so the controller can answer AC-13", () => {
    const dto = new SalesOrderUpdateInputDTO({
      customerUuid: CUSTOMER,
      productUuid: PRODUCT,
    }).build();

    expect(dto.customerUuid).toBe(CUSTOMER);
    expect(dto.productUuid).toBe(PRODUCT);
  });

  it("rejects an emptied customerUuid", () => {
    expect(() =>
      new SalesOrderUpdateInputDTO({ customerUuid: "" }).build(),
    ).toThrow(/customerUuid/);
  });

  // ── AC-9: partUuid is rejected on update too (parts removed, D-1) ─────────
  it("rejects partUuid on update (AC-9, was AC-5 'keeps partUuid')", () => {
    expect(() =>
      new SalesOrderUpdateInputDTO({ partUuid: PART }).build(),
    ).toThrow("partUuid is not supported");
  });

  it("rejects an emptied partUuid too — presence alone is unsupported (AC-9, was AC-5)", () => {
    expect(() =>
      new SalesOrderUpdateInputDTO({ partUuid: "" }).build(),
    ).toThrow("partUuid is not supported");
  });

  it("does not require a discriminator on a partial update naming only productUuid (AC-5 analog)", () => {
    const dto = new SalesOrderUpdateInputDTO({ productUuid: PRODUCT }).build();

    expect(Object.keys({ ...dto })).toEqual(["productUuid"]);
  });

  it("strips unset keys so a partial update never nulls a column", () => {
    const dto = new SalesOrderUpdateInputDTO({ quantity: 5 }).build();

    expect(Object.keys({ ...dto })).toEqual(["quantity"]);
  });
});
