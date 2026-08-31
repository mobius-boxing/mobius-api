import { describe, it, expect } from "@jest/globals";
import { PaperStockCreateInputDTO } from "../../../dto/input/paperStock/PaperStockCreateInputDTO";
import { SheetStockCreateInputDTO } from "../../../dto/input/sheetStock/SheetStockCreateInputDTO";
import { SheetStockUpdateInputDTO } from "../../../dto/input/sheetStock/SheetStockUpdateInputDTO";
import { ToolingStockCreateInputDTO } from "../../../dto/input/tooling-stock/ToolingStockCreateInputDTO";
import { ConsumableSupplyCreateInputDTO } from "../../../dto/input/consumable-supply/ConsumableSupplyCreateInputDTO";
import { PaperSupplyCreateInputDTO } from "../../../dto/input/paperSupply/PaperSupplyCreateInputDTO";
import { ToolingCreateInputDTO } from "../../../dto/input/tooling/ToolingCreateInputDTO";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/__tests__/validation/b5Lookups.test.ts`.
 *
 * The asymmetry this file exists to pin down: `paperStock`/`sheetStock`/
 * `paperSheet`/`paperSupply` receive RESOLVED NUMERIC IDS (their controllers
 * call `resolveForeignKeys(req.body)` before `build()`), while
 * `toolingStock`/`consumableStock`/`consumableSupply`/`tooling` receive UUIDS
 * and are resolved afterwards. Same client rule, two different server rules —
 * get it backwards and every request 400s.
 */
const failure = (fn: () => unknown): ValidationError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected build() to throw a ValidationError");
};

const fields = (error: ValidationError): string[] =>
  error.errors.map((e) => e.field);

const UUID = "11111111-2222-3333-4444-555555555555";

describe("stock DTOs — the id/uuid asymmetry", () => {
  it("paperStock takes resolved integer ids, not uuids", () => {
    expect(
      new PaperStockCreateInputDTO({
        warehouseId: 7,
        paperSupplyId: 9,
        price: 10.5,
      }).build(),
    ).toEqual({ warehouseId: 7, paperSupplyId: 9, price: 10.5 });

    // A uuid reaching this DTO means resolveForeignKeys did not run.
    expect(
      fields(
        failure(() =>
          new PaperStockCreateInputDTO({
            warehouseId: UUID,
            paperSupplyId: 9,
          }).build(),
        ),
      ),
    ).toEqual(["warehouseId"]);
  });

  it("toolingStock takes uuids, not integers", () => {
    expect(
      new ToolingStockCreateInputDTO({
        warehouseUuid: UUID,
        toolingUuid: UUID,
        quantity: 3,
      }).build(),
    ).toEqual({ warehouseUuid: UUID, toolingUuid: UUID, quantity: 3 });

    expect(
      fields(
        failure(() =>
          new ToolingStockCreateInputDTO({
            warehouseUuid: 7,
            toolingUuid: UUID,
            quantity: 3,
          }).build(),
        ),
      ),
    ).toEqual(["warehouseUuid"]);
  });

  it("requires both NOT NULL foreign keys and reports both at once", () => {
    expect(
      fields(failure(() => new PaperStockCreateInputDTO({}).build())).sort(),
    ).toEqual(["paperSupplyId", "warehouseId"]);
  });

  /**
   * The asymmetry this batch settled on, deliberately: `quantity` is NOT NULL
   * *with a default of 0*, so the SERVER leaves it optional — omitting it takes
   * the default exactly as it did before. The MODAL marks it required, and that
   * stricter client rule stands. A stricter client is a product decision; a
   * stricter API would be a contract change for every non-form caller.
   */
  it("leaves quantity optional on the server (the column has a default)", () => {
    expect(
      new SheetStockCreateInputDTO({
        warehouseId: 1,
        paperSheetId: 2,
      }).build(),
    ).toEqual({ warehouseId: 1, paperSheetId: 2 });
  });

  it("still bounds a quantity that IS sent", () => {
    expect(
      fields(
        failure(() =>
          new SheetStockCreateInputDTO({
            warehouseId: 1,
            paperSheetId: 2,
            quantity: -1,
          }).build(),
        ),
      ),
    ).toEqual(["quantity"]);
  });

  it("rejects a fractional quantity on an integer column", () => {
    expect(
      fields(
        failure(() =>
          new SheetStockCreateInputDTO({
            warehouseId: 1,
            paperSheetId: 2,
            quantity: 2.5,
          }).build(),
        ),
      ),
    ).toEqual(["quantity"]);
  });

  it("sets only the fields an update actually carried", () => {
    expect(new SheetStockUpdateInputDTO({ quantity: 4 }).build()).toEqual({
      quantity: 4,
    });
  });

  it("enforces numeric(10,2) on price", () => {
    expect(
      fields(
        failure(() =>
          new PaperStockCreateInputDTO({
            warehouseId: 1,
            paperSupplyId: 2,
            price: 1.234,
          }).build(),
        ),
      ),
    ).toEqual(["price"]);
  });
});

describe("supply DTOs", () => {
  it("keeps consumableTypeUuid required over a nullable column (sign-off)", () => {
    expect(
      fields(
        failure(() =>
          new ConsumableSupplyCreateInputDTO({
            code: "CS-1",
            name: "Insumo",
          }).build(),
        ),
      ),
    ).toEqual(["consumableTypeUuid"]);
  });

  /** `expiry` is a text column; a date rule would reject what it already holds. */
  it("accepts free-form text in expiry", () => {
    const built = new ConsumableSupplyCreateInputDTO({
      code: "CS-1",
      name: "Insumo",
      consumableTypeUuid: UUID,
      expiry: "Lote 2027, sin vencimiento",
    }).build() as unknown as Record<string, unknown>;
    expect(built.expiry).toBe("Lote 2027, sin vencimiento");
  });

  it("validates the jsonb minimumStock members under their own paths", () => {
    const error = failure(() =>
      new PaperSupplyCreateInputDTO({
        companyId: 1,
        code: "PSUP-1",
        name: "Papel",
        minimumStock: { weightKg: -5, diameterMm: 900 },
      }).build(),
    );
    expect(fields(error)).toEqual(["minimumStock.weightKg"]);
  });

  it("preserves an explicit null inside the jsonb document", () => {
    const built = new PaperSupplyCreateInputDTO({
      companyId: 1,
      code: "PSUP-1",
      name: "Papel",
      minimumStock: { weightKg: null, diameterMm: 900 },
    }).build() as unknown as Record<string, unknown>;
    expect(built.minimumStock).toEqual({ weightKg: null, diameterMm: 900 });
  });

  it("gives paperSupply.price the wider numeric(12,2) ceiling", () => {
    const built = new PaperSupplyCreateInputDTO({
      companyId: 1,
      code: "PSUP-1",
      name: "Papel",
      price: 9999999999.99,
    }).build() as unknown as Record<string, unknown>;
    expect(built.price).toBe(9999999999.99);
    expect(
      fields(
        failure(() =>
          new PaperSupplyCreateInputDTO({
            companyId: 1,
            code: "PSUP-1",
            name: "Papel",
            price: 10000000000,
          }).build(),
        ),
      ),
    ).toEqual(["price"]);
  });

  it("validates companyId, which arrives through the body on this entity", () => {
    expect(
      fields(
        failure(() =>
          new PaperSupplyCreateInputDTO({ code: "P", name: "Papel" }).build(),
        ),
      ),
    ).toEqual(["companyId"]);
  });

  it("requires tooling.toolingTypeUuid but not its nullable code", () => {
    const built = new ToolingCreateInputDTO({
      name: "Troquel",
      toolingTypeUuid: UUID,
    }).build() as unknown as Record<string, unknown>;
    expect("code" in built).toBe(false);
    expect(
      fields(
        failure(() => new ToolingCreateInputDTO({ name: "Troquel" }).build()),
      ),
    ).toEqual(["toolingTypeUuid"]);
  });
});
