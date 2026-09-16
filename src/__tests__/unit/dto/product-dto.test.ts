/**
 * AC-4 — Product DTO validation (`ProductCreateInputDTO` / `ProductUpdateInputDTO`
 * / `ProductCalculateInputDTO`). `parts` is gone (D-1): these replace
 * `dto/input/part/index.ts`'s DTOs, closed allow-list per model.md.
 */
import { describe, it, expect } from "@jest/globals";
import {
  ProductCreateInputDTO,
  ProductUpdateInputDTO,
  READ_ONLY_KEYS,
  LEGACY_KEYS,
} from "../../../dto/input/product";
import {
  ProductCalculateInputDTO,
  CALCULATE_FIELDS,
} from "../../../dto/input/product/ProductCalculateInputDTO";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const CORRUGATION = "22222222-2222-4222-8222-222222222222";

describe("ProductCreateInputDTO", () => {
  it("code + customerId only is enough — nothing new is required (C-9, D-14)", () => {
    // customerId is already numeric here — the controller resolves the
    // client's uuid to this id BEFORE constructing the DTO (D-12).
    const dto = new ProductCreateInputDTO({
      code: "CAJA-1",
      customerId: 9,
    }).build();

    expect(dto.code).toBe("CAJA-1");
    expect(dto.customerId).toBe(9);
  });

  it("rejects a missing code", () => {
    expect(() =>
      new ProductCreateInputDTO({ customerId: CUSTOMER }).build(),
    ).toThrow(/code/);
  });

  it("rejects a missing customerId", () => {
    expect(() => new ProductCreateInputDTO({ code: "X" }).build()).toThrow(
      /customerId/,
    );
  });

  it("accepts every folded-recipe key the model lists", () => {
    const dto = new ProductCreateInputDTO({
      code: "CAJA-2",
      customerId: CUSTOMER,
      boxLength: 600,
      boxWidth: 400,
      boxHeight: 300,
      externalLength: 604,
      sheetLength: 2060,
      sheetWidth: 1070,
      additionalSheetLength: 0,
      flap: 30,
      corrugationScoreLines: "200; 500; 700",
      colorCount: 2,
      printSides: 1,
      inks: "Negro; Rojo 485",
      symmetricScoreLines: true,
      printRecyclable: true,
      overrunPercentage: 10,
      allowsGluing: true,
      corrugationUuid: CORRUGATION,
      modelUuid: null,
    }).build();

    expect(dto.boxLength).toBe(600);
    expect(dto.sheetLength).toBe(2060);
    expect(dto.corrugationScoreLines).toBe("200; 500; 700");
    expect(dto.colorCount).toBe(2);
    expect(dto.symmetricScoreLines).toBe(true);
    expect(dto.corrugationUuid).toBe(CORRUGATION);
    expect(dto.modelUuid).toBeNull();
  });

  it("rejects boxWeight — read-only, server-computed (I-6, C-12)", () => {
    const dto = new ProductCreateInputDTO({
      code: "CAJA-3",
      customerId: CUSTOMER,
      boxWeight: 999,
    }).build();

    expect(
      (dto as unknown as Record<string, unknown>).boxWeight,
    ).toBeUndefined();
  });

  it.each([
    "uuid",
    "id",
    "createdAt",
    "updatedAt",
    "approvalStatus",
    "effectiveGrammage",
    "sheetSurface",
    "partLegacyId",
  ])(
    "silently drops the read-only key %s instead of persisting or rejecting it",
    (key) => {
      const dto = new ProductCreateInputDTO({
        code: "CAJA-4",
        customerId: CUSTOMER,
        [key]: "junk-value",
      }).build();

      expect((dto as unknown as Record<string, unknown>)[key]).toBeUndefined();
    },
  );

  it("READ_ONLY_KEYS names every stripped key the model lists under POST", () => {
    expect(READ_ONLY_KEYS).toEqual(
      expect.arrayContaining([
        "boxWeight",
        "approvalStatus",
        "effectiveGrammage",
        "sheetSurface",
        "partLegacyId",
        "uuid",
        "id",
        "createdAt",
        "updatedAt",
        "productApprovalAt",
        "productApprovalBy",
        "productCancellationAt",
        "productCancellationBy",
        "customer",
        "productType",
        "boxType",
        "corrugation",
        "productionRoute",
        "palletization",
        "model",
        "flapType",
        "glueType",
        "strappingType",
        "traceType",
        "complement",
      ]),
    );
  });

  it("LEGACY_KEYS is exactly initialPart (D-18)", () => {
    expect(LEGACY_KEYS).toEqual(["initialPart"]);
  });

  it("merges initialPart into the flat body, a flat key of the same name winning (D-18, I-22)", () => {
    const dto = new ProductCreateInputDTO({
      code: "CAJA-5",
      customerId: CUSTOMER,
      sheetLength: 500, // flat — wins
      initialPart: { sheetLength: 999, sheetWidth: 700, flap: 30 },
    }).build();

    expect(dto.sheetLength).toBe(500);
    expect(dto.sheetWidth).toBe(700);
    expect(dto.flap).toBe(30);
    expect(
      (dto as unknown as Record<string, unknown>).initialPart,
    ).toBeUndefined();
  });

  it("rejects a non-positive sheetLength when sent (V4-analog)", () => {
    expect(() =>
      new ProductCreateInputDTO({
        code: "CAJA-6",
        customerId: CUSTOMER,
        sheetLength: 0,
      }).build(),
    ).toThrow(/[Ss]heet length/);
  });

  it("rejects a negative additionalSheetLength when sent", () => {
    expect(() =>
      new ProductCreateInputDTO({
        code: "CAJA-7",
        customerId: CUSTOMER,
        additionalSheetLength: -1,
      }).build(),
    ).toThrow(/[Aa]dditional sheet length/);
  });

  it("rejects a score-line string outside the allowed character set", () => {
    expect(() =>
      new ProductCreateInputDTO({
        code: "CAJA-8",
        customerId: CUSTOMER,
        corrugationScoreLines: "abc",
      }).build(),
    ).toThrow(/[Ss]core lines/);
  });
});

describe("ProductUpdateInputDTO", () => {
  it("allows a partial body — sheetLength is validated only when sent", () => {
    const dto = new ProductUpdateInputDTO({ clientCode: "CL-1" }).build();

    expect(dto.clientCode).toBe("CL-1");
    expect(dto.code).toBeUndefined();
  });

  it("strips unset keys so a partial update never nulls a column", () => {
    const dto = new ProductUpdateInputDTO({ grammage: 450 }).build();

    expect(Object.keys({ ...dto })).toEqual(["grammage"]);
  });

  it("still validates a sent-but-invalid sheetWidth", () => {
    expect(() => new ProductUpdateInputDTO({ sheetWidth: -5 }).build()).toThrow(
      /[Ss]heet width/,
    );
  });

  it("still strips read-only keys on update (a GET body round-trips through PUT, C-12)", () => {
    const dto = new ProductUpdateInputDTO({
      boxWeight: 1,
      effectiveGrammage: 2,
      sheetSurface: 3,
      uuid: "x",
      code: "CAJA-9",
    }).build();

    expect(Object.keys({ ...dto })).toEqual(["code"]);
  });
});

describe("ProductCalculateInputDTO (AC-6, D-11)", () => {
  it("CALCULATE_FIELDS is exactly the 8 implemented cascade fields", () => {
    expect(CALCULATE_FIELDS).toEqual([
      "boxLength",
      "boxWidth",
      "boxHeight",
      "externalLength",
      "externalWidth",
      "externalHeight",
      "boxSurface",
      "grammage",
    ]);
  });

  it("accepts a well-formed request", () => {
    const dto = new ProductCalculateInputDTO({
      corrugationUuid: CORRUGATION,
      field: "boxLength",
      value: 500,
      values: { boxLength: 500, boxWeight: null },
    }).build();

    expect(dto.field).toBe("boxLength");
    expect(dto.value).toBe(500);
    expect(dto.values).toEqual({ boxLength: 500, boxWeight: null });
  });

  it("accepts value: null (an explicit clear)", () => {
    const dto = new ProductCalculateInputDTO({
      corrugationUuid: CORRUGATION,
      field: "grammage",
      value: null,
      values: {},
    }).build();

    expect(dto.value).toBeNull();
  });

  it("rejects a missing corrugationUuid", () => {
    expect(() =>
      new ProductCalculateInputDTO({
        field: "boxLength",
        value: 1,
        values: {},
      }).build(),
    ).toThrow(/corrugationUuid/);
  });

  it("rejects a field outside the 8 cascade fields", () => {
    expect(() =>
      new ProductCalculateInputDTO({
        corrugationUuid: CORRUGATION,
        field: "averageWeight",
        value: 1,
        values: {},
      }).build(),
    ).toThrow(/field/);
  });

  it("rejects a missing value key entirely", () => {
    expect(() =>
      new ProductCalculateInputDTO({
        corrugationUuid: CORRUGATION,
        field: "boxLength",
        values: {},
      }).build(),
    ).toThrow(/value/);
  });

  it("rejects a non-numeric value", () => {
    expect(() =>
      new ProductCalculateInputDTO({
        corrugationUuid: CORRUGATION,
        field: "boxLength",
        value: "abc",
        values: {},
      }).build(),
    ).toThrow(/value/);
  });

  it("rejects a missing values object", () => {
    expect(() =>
      new ProductCalculateInputDTO({
        corrugationUuid: CORRUGATION,
        field: "boxLength",
        value: 1,
      }).build(),
    ).toThrow(/values/);
  });

  it("rejects an unknown key inside values", () => {
    expect(() =>
      new ProductCalculateInputDTO({
        corrugationUuid: CORRUGATION,
        field: "boxLength",
        value: 1,
        values: { notARealKey: 1 },
      }).build(),
    ).toThrow(/values/);
  });

  it("accepts boxWeight inside values (the 9th, output-only calculable key)", () => {
    const dto = new ProductCalculateInputDTO({
      corrugationUuid: CORRUGATION,
      field: "boxLength",
      value: 1,
      values: { boxWeight: 0.5 },
    }).build();

    expect(dto.values.boxWeight).toBe(0.5);
  });
});
