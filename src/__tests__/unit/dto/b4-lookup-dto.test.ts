import { describe, it, expect } from "@jest/globals";
import {
  PalletTypeCreateInputDTO,
  PalletTypeUpdateInputDTO,
} from "../../../dto/input/palletization";
import {
  MachineTypeCreateInputDTO,
  MachineTypeUpdateInputDTO,
} from "../../../dto/input/machine";
import { ColorCreateInputDTO } from "../../../dto/input/color/ColorCreateInputDTO";
import { ColorUpdateInputDTO } from "../../../dto/input/color/ColorUpdateInputDTO";
import { CorrugationCreateInputDTO } from "../../../dto/input/corrugation/CorrugationCreateInputDTO";
import { CorrugationUpdateInputDTO } from "../../../dto/input/corrugation/CorrugationUpdateInputDTO";
import { FinishedGoodCreateInputDTO } from "../../../dto/input/finished-good/FinishedGoodCreateInputDTO";
import { FinishedGoodUpdateInputDTO } from "../../../dto/input/finished-good/FinishedGoodUpdateInputDTO";
import { SupplierCreateInputDTO } from "../../../dto/input/supplier/SupplierCreateInputDTO";
import { SupplierUpdateInputDTO } from "../../../dto/input/supplier/SupplierUpdateInputDTO";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/__tests__/validation/b4Lookups.test.ts`.
 * The two files carry the same rules on purpose: a rule that exists on only one
 * side is the failure mode this batch closes.
 *
 * Bounds are LIVE column widths from `information_schema.columns` (2026-08-30).
 * EVIDENCE GAP inherited from the client file: the tables B2/B3 read real rows
 * from are empty on this machine, so every fixture here is CONSTRUCTED except
 * corrugation's `CORR1`, which is a genuine row.
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

describe("PalletTypeCreateInputDTO / PalletTypeUpdateInputDTO", () => {
  const row = {
    code: "PAL-STD",
    description: "Pallet estándar",
    length: 1200,
    width: 1000,
    weight: 25.5,
    height: 144,
  };

  it("round-trips a constructed row through create and update", () => {
    expect(new PalletTypeCreateInputDTO(row).build()).toEqual(row);
    expect(new PalletTypeUpdateInputDTO(row).build()).toEqual(row);
  });

  it("keeps the client `required` on a NULLABLE code column (sign-off)", () => {
    const error = failure(() =>
      new PalletTypeCreateInputDTO({ ...row, code: "" }).build(),
    );
    expect(fields(error)).toEqual(["code"]);
    expect(error.errors[0].message).toContain("obligatorio");
  });

  it("does NOT require code on an update that omits it", () => {
    expect(new PalletTypeUpdateInputDTO({ width: 900 }).build()).toEqual({
      width: 900,
    });
  });

  /**
   * L-010: `double precision` has no scale, so many decimals must survive. A
   * `decimals` rule here would reject numbers Procusto stores today.
   */
  it("accepts unlimited decimals on a double precision column", () => {
    expect(
      (
        new PalletTypeCreateInputDTO({
          ...row,
          weight: 25.123456789,
        }).build() as typeof row
      ).weight,
    ).toBe(25.123456789);
  });

  it("rejects a negative measure with a field-level error", () => {
    expect(
      fields(
        failure(() =>
          new PalletTypeCreateInputDTO({ ...row, length: -1 }).build(),
        ),
      ),
    ).toEqual(["length"]);
  });

  it("drops a blank measure rather than storing NaN", () => {
    const built = new PalletTypeCreateInputDTO({
      ...row,
      weight: "",
    }).build() as unknown as Record<string, unknown>;
    expect("weight" in built).toBe(false);
  });

  it("reports EVERY bad field at once, not just the first", () => {
    const error = failure(() =>
      new PalletTypeCreateInputDTO({
        code: "",
        length: -1,
        width: "abc",
      }).build(),
    );
    expect(fields(error).sort()).toEqual(["code", "length", "width"]);
  });
});

describe("MachineTypeCreateInputDTO / MachineTypeUpdateInputDTO", () => {
  const row = {
    name: "Corrugadora",
    attribute: "ATR-1",
    corrugated: true,
    generatesSheets: false,
    requiresDie: false,
    requiresPlate: true,
  };

  it("round-trips a constructed row through create and update", () => {
    expect(new MachineTypeCreateInputDTO(row).build()).toEqual(row);
    expect(new MachineTypeUpdateInputDTO(row).build()).toEqual(row);
  });

  it("requires name, which is NOT NULL, as a field error not a bare Error", () => {
    const error = failure(() =>
      new MachineTypeCreateInputDTO({ ...row, name: "   " }).build(),
    );
    expect(fields(error)).toEqual(["name"]);
  });

  /**
   * The bound the old DTO did not have: `location` is `smallint`. 40000 used to
   * reach Postgres and return a 22003 carrying the generated SQL.
   */
  it("bounds location by smallint, not int32", () => {
    expect(
      (
        new MachineTypeCreateInputDTO({ ...row, location: 32767 }).build() as {
          location?: number;
        }
      ).location,
    ).toBe(32767);
    expect(
      fields(
        failure(() =>
          new MachineTypeCreateInputDTO({ ...row, location: 40000 }).build(),
        ),
      ),
    ).toEqual(["location"]);
  });

  it("lets an update blank the nullable attribute but not the name", () => {
    expect(new MachineTypeUpdateInputDTO({ attribute: "" }).build()).toEqual({
      attribute: "",
    });
    expect(
      fields(
        failure(() => new MachineTypeUpdateInputDTO({ name: "" }).build()),
      ),
    ).toEqual(["name"]);
  });
});

describe("ColorCreateInputDTO / ColorUpdateInputDTO", () => {
  const row = {
    code: "COL-001",
    name: "Rojo",
    description: "Rojo intenso",
    observations: "Secado lento",
    tonality: 3,
  };

  it("round-trips a constructed row through create and update", () => {
    expect(new ColorCreateInputDTO(row).build()).toEqual(row);
    expect(new ColorUpdateInputDTO(row).build()).toEqual(row);
  });

  /** `parseInt("abc", 10)` was `NaN`, and NaN reaches pg as invalid SQL. */
  it("rejects an unparseable tonality instead of sending NaN", () => {
    expect(
      fields(
        failure(() =>
          new ColorCreateInputDTO({ ...row, tonality: "abc" }).build(),
        ),
      ),
    ).toEqual(["tonality"]);
  });

  it("rejects a fractional tonality on an integer column", () => {
    expect(
      fields(
        failure(() =>
          new ColorCreateInputDTO({ ...row, tonality: 2.5 }).build(),
        ),
      ),
    ).toEqual(["tonality"]);
  });

  it("rejects a colorTypeUuid that is not a uuid", () => {
    expect(
      fields(
        failure(() =>
          new ColorCreateInputDTO({ ...row, colorTypeUuid: "42" }).build(),
        ),
      ),
    ).toEqual(["colorTypeUuid"]);
  });

  it("lets an update clear a nullable column with null", () => {
    expect(new ColorUpdateInputDTO({ tonality: null }).build()).toEqual({
      tonality: null,
    });
  });
});

describe("CorrugationCreateInputDTO / CorrugationUpdateInputDTO", () => {
  /** The one genuinely live row on this machine. */
  const liveRow = { code: "CORR1", description: "Corrugado demo" };

  it("round-trips the real CORR1 row through create and update", () => {
    expect(new CorrugationCreateInputDTO(liveRow).build()).toEqual(liveRow);
    expect(new CorrugationUpdateInputDTO(liveRow).build()).toEqual(liveRow);
  });

  it("enforces the two different numeric scales on one entity", () => {
    expect(
      fields(
        failure(() =>
          new CorrugationCreateInputDTO({
            ...liveRow,
            theoreticalGrammage: 1.234,
          }).build(),
        ),
      ),
    ).toEqual(["theoreticalGrammage"]);
    // The same 4 decimals are legal on caliper — numeric(10,4).
    expect(
      (
        new CorrugationCreateInputDTO({
          ...liveRow,
          caliper: 1.2345,
        }).build() as { caliper?: number }
      ).caliper,
    ).toBe(1.2345);
  });

  it("rejects a caliper above its own smaller ceiling", () => {
    expect(
      fields(
        failure(() =>
          new CorrugationCreateInputDTO({
            ...liveRow,
            caliper: 99999999.99,
          }).build(),
        ),
      ),
    ).toEqual(["caliper"]);
  });

  /**
   * The layer stack is still `useState` in the modal (pattern B, B7), so the
   * server is the only guard on it today. Errors are keyed per index so a bad
   * row in a stack of six says WHICH row.
   */
  it("reports a bad layer under its own index", () => {
    const error = failure(() =>
      new CorrugationCreateInputDTO({
        ...liveRow,
        layers: [
          { position: 1, isLiner: true },
          { position: 2, paperClassUuid: "not-a-uuid" },
        ],
      }).build(),
    );
    expect(fields(error)).toEqual(["layers.1.paperClassUuid"]);
  });

  it("accepts a well-formed layer stack unchanged", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const built = new CorrugationCreateInputDTO({
      ...liveRow,
      layers: [{ position: 1, isLiner: true, paperClassUuid: uuid }],
    }).build() as { layers?: Array<Record<string, unknown>> };
    expect(built.layers?.[0]).toEqual({
      position: 1,
      isLiner: true,
      paperClassUuid: uuid,
      fluteTypeUuid: undefined,
    });
  });
});

describe("FinishedGoodCreateInputDTO / FinishedGoodUpdateInputDTO", () => {
  const row = {
    code: "FG-1",
    name: "Producto terminado",
    description: "Demo",
    minimumStock: 10.5,
  };

  it("round-trips a constructed row through create and update", () => {
    expect(new FinishedGoodCreateInputDTO(row).build()).toEqual(row);
    expect(new FinishedGoodUpdateInputDTO(row).build()).toEqual(row);
  });

  it("requires name but not code, matching the columns exactly", () => {
    expect(
      fields(
        failure(() =>
          new FinishedGoodCreateInputDTO({ ...row, name: " " }).build(),
        ),
      ),
    ).toEqual(["name"]);
    const built = new FinishedGoodCreateInputDTO({
      ...row,
      code: "",
    }).build() as unknown as Record<string, unknown>;
    expect("code" in built).toBe(false);
  });

  it("allows 4 decimals on numeric(14,4) and rejects a 5th", () => {
    expect(
      (
        new FinishedGoodCreateInputDTO({
          ...row,
          minimumStock: 1.2345,
        }).build() as { minimumStock?: number }
      ).minimumStock,
    ).toBe(1.2345);
    expect(
      fields(
        failure(() =>
          new FinishedGoodCreateInputDTO({
            ...row,
            minimumStock: 1.23456,
          }).build(),
        ),
      ),
    ).toEqual(["minimumStock"]);
  });

  it("keeps an explicit 0 and drops a blank", () => {
    expect(
      (
        new FinishedGoodCreateInputDTO({
          ...row,
          minimumStock: 0,
        }).build() as { minimumStock?: number }
      ).minimumStock,
    ).toBe(0);
    const blank = new FinishedGoodCreateInputDTO({
      ...row,
      minimumStock: "",
    }).build() as unknown as Record<string, unknown>;
    expect("minimumStock" in blank).toBe(false);
  });
});

describe("SupplierCreateInputDTO / SupplierUpdateInputDTO", () => {
  const row = {
    code: "SUP-1",
    suppliesSheets: true,
    suppliesElaborated: false,
    suppliesConsumables: false,
    suppliesPaper: true,
    suppliesTooling: false,
  };

  it("round-trips a constructed row through create and update", () => {
    expect(new SupplierCreateInputDTO(row).build()).toEqual(row);
    expect(new SupplierUpdateInputDTO(row).build()).toEqual(row);
  });

  it("caps code at 100, this table's own width", () => {
    expect(
      fields(
        failure(() =>
          new SupplierCreateInputDTO({ ...row, code: "x".repeat(101) }).build(),
        ),
      ),
    ).toEqual(["code"]);
  });

  /**
   * The old constructor wrote `?? false` for every flag, recording an explicit
   * choice the user never made. An absent flag is now dropped so the column
   * default applies — same stored value, honest payload.
   */
  it("omits an absent flag instead of writing false", () => {
    const built = new SupplierCreateInputDTO({
      code: "SUP-2",
    }).build() as unknown as Record<string, unknown>;
    expect(built).toEqual({ code: "SUP-2" });
    expect("suppliesPaper" in built).toBe(false);
  });
});
