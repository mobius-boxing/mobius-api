import { describe, it, expect } from "@jest/globals";
import { ConsumableTypeCreateInputDTO } from "../../../dto/input/consumable-type/ConsumableTypeCreateInputDTO";
import { ConsumableTypeUpdateInputDTO } from "../../../dto/input/consumable-type/ConsumableTypeUpdateInputDTO";
import {
  ToolingTypeCreateInputDTO,
  ToolingTypeUpdateInputDTO,
} from "../../../dto/input/toolingType";
import {
  WarehouseCreateInputDTO,
  WarehouseUpdateInputDTO,
} from "../../../dto/input/warehouse";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/__tests__/validation/b3Lookups.test.ts`.
 * The two files carry the same rules on purpose: a rule that exists on only one
 * side is the failure mode this batch is meant to close.
 *
 * Bounds are the LIVE column widths from `information_schema.columns`
 * (2026-08-29) EXCEPT where the sign-off keeps a stricter existing UI rule.
 * `role` is absent: it moved to B7 (10 of 62 live rows carry an out-of-list
 * `profileType`).
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

describe("ConsumableTypeCreateInputDTO / ConsumableTypeUpdateInputDTO", () => {
  /** A real row from `traffic_production`. */
  const seeded = {
    code: "QD-TCN-001",
    name: "Tinta de línea",
    autoConsumption: true,
  };

  it("round-trips a real seeded row through create", () => {
    expect(new ConsumableTypeCreateInputDTO(seeded).build()).toEqual(seeded);
  });

  it("round-trips the same row through update, unchanged (Risk 2)", () => {
    expect(new ConsumableTypeUpdateInputDTO(seeded).build()).toEqual(seeded);
  });

  it("trims instead of storing surrounding whitespace", () => {
    expect(
      new ConsumableTypeCreateInputDTO({
        ...seeded,
        code: "  QD-TCN-001  ",
        name: "  Tinta de línea  ",
      }).build(),
    ).toEqual(seeded);
  });

  it("sets only the fields an update actually carried", () => {
    expect(Object.keys(new ConsumableTypeUpdateInputDTO({}).build())).toEqual(
      [],
    );
  });

  it("requires the code and the name, in Spanish, with fields attached", () => {
    const error = failure(() =>
      new ConsumableTypeCreateInputDTO({ code: "  ", name: "" }).build(),
    );
    expect(error.statusCode).toBe(400);
    expect(error.errors).toEqual([
      { field: "code", message: "El código es obligatorio" },
      { field: "name", message: "El nombre es obligatorio" },
    ]);
  });

  it("KEEPS the UI cap of 50 even though the column is varchar(255)", () => {
    // Sign-off: the column width is the CEILING, not the target. The API
    // mirrors the FORM, and code widths are per-table (50/100/255/400) — never
    // a shared constant.
    expect(
      (
        new ConsumableTypeCreateInputDTO({
          ...seeded,
          code: "x".repeat(50),
        }).build() as { code: string }
      ).code,
    ).toHaveLength(50);

    expect(
      failure(() =>
        new ConsumableTypeCreateInputDTO({
          ...seeded,
          code: "x".repeat(51),
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "code",
        message: "El código no puede superar los 50 caracteres",
      },
    ]);
  });

  it("caps the name at the live varchar(255)", () => {
    expect(
      failure(() =>
        new ConsumableTypeCreateInputDTO({
          ...seeded,
          name: "x".repeat(256),
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "name",
        message: "El nombre no puede superar los 255 caracteres",
      },
    ]);
  });

  it("rejects a code character the client's class forbids, on both doors", () => {
    expect(
      failure(() =>
        new ConsumableTypeCreateInputDTO({ ...seeded, code: "A+B" }).build(),
      ).errors,
    ).toEqual([
      { field: "code", message: "El código tiene un formato inválido" },
    ]);
    expect(
      failure(() => new ConsumableTypeUpdateInputDTO({ code: "A+B" }).build())
        .errors,
    ).toEqual([
      { field: "code", message: "El código tiene un formato inválido" },
    ]);
  });

  it("still validates a code an update carries", () => {
    expect(
      failure(() => new ConsumableTypeUpdateInputDTO({ code: "" }).build())
        .errors,
    ).toEqual([{ field: "code", message: "El código es obligatorio" }]);
  });

  it("drops an absent checkbox so the column default applies", () => {
    const dto = new ConsumableTypeCreateInputDTO({
      code: seeded.code,
      name: seeded.name,
    }).build() as object;
    expect(Object.keys(dto)).not.toContain("autoConsumption");
  });

  it("accepts the string a form-encoded checkbox sends", () => {
    expect(
      (
        new ConsumableTypeUpdateInputDTO({
          autoConsumption: "false",
        }).build() as { autoConsumption?: boolean }
      ).autoConsumption,
    ).toBe(false);
  });

  it("leaves companyId alone for the controller to inject (L-009)", () => {
    expect(
      new ConsumableTypeCreateInputDTO({ ...seeded, companyId: 7 }).build(),
    ).not.toHaveProperty("companyId");
  });
});

describe("ToolingTypeCreateInputDTO / ToolingTypeUpdateInputDTO", () => {
  /** A real row from `traffic_production`. */
  const seeded = {
    code: "QD-TTL-001",
    name: "Troquel plano",
    description: "Herramental troquel plano",
    automaticConsumption: true,
  };

  it("round-trips a real seeded row through create", () => {
    expect(new ToolingTypeCreateInputDTO(seeded).build()).toEqual(seeded);
  });

  it("round-trips the same row through update, unchanged (Risk 2)", () => {
    expect(new ToolingTypeUpdateInputDTO(seeded).build()).toEqual(seeded);
  });

  it("bounds the code by the live varchar(50)", () => {
    expect(
      new ToolingTypeCreateInputDTO({
        ...seeded,
        code: "x".repeat(50),
      }).build().code,
    ).toHaveLength(50);

    expect(
      failure(() =>
        new ToolingTypeCreateInputDTO({
          ...seeded,
          code: "x".repeat(51),
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "code",
        message: "El código no puede superar los 50 caracteres",
      },
    ]);
  });

  it("caps the name at the live varchar(255)", () => {
    expect(
      failure(() =>
        new ToolingTypeCreateInputDTO({
          ...seeded,
          name: "x".repeat(256),
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "name",
        message: "El nombre no puede superar los 255 caracteres",
      },
    ]);
  });

  it("rejects a code character the client's class forbids", () => {
    expect(
      failure(() =>
        new ToolingTypeCreateInputDTO({ ...seeded, code: "A+B" }).build(),
      ).errors,
    ).toEqual([
      { field: "code", message: "El código tiene un formato inválido" },
    ]);
  });

  it("adds the first rule the free textarea ever had, at 10000 chars", () => {
    expect(
      failure(() =>
        new ToolingTypeCreateInputDTO({
          ...seeded,
          description: "x".repeat(10001),
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "description",
        message: "La descripción no puede superar los 10000 caracteres",
      },
    ]);
  });

  it("drops an absent description instead of sending an undefined key", () => {
    const { description, ...rest } = seeded;
    expect(
      Object.keys(new ToolingTypeCreateInputDTO(rest).build()),
    ).not.toContain("description");
  });

  it("keeps an empty description so the field stays clearable", () => {
    expect(
      new ToolingTypeUpdateInputDTO({ description: "" }).build().description,
    ).toBe("");
  });

  it("reports every bad field at once, not just the first", () => {
    const error = failure(() =>
      new ToolingTypeCreateInputDTO({
        code: "x".repeat(51),
        name: "x".repeat(256),
        description: "x".repeat(10001),
      }).build(),
    );
    expect(error.errors.map((e) => e.field)).toEqual([
      "code",
      "name",
      "description",
    ]);
  });

  it("leaves companyId alone for the controller to inject (L-009)", () => {
    expect(
      new ToolingTypeCreateInputDTO({ ...seeded, companyId: 7 }).build(),
    ).not.toHaveProperty("companyId");
  });
});

describe("WarehouseCreateInputDTO", () => {
  /**
   * A real row from `traffic_production` plus the companyId
   * `WarehouseController.beforeCreate` resolves from the caller's token BEFORE
   * constructing the DTO (L-009).
   */
  const seeded = {
    name: "Depósito Central 01",
    gridRows: 5,
    gridCols: 5,
    companyId: 1,
  };

  it("round-trips a real seeded row", () => {
    expect(new WarehouseCreateInputDTO(seeded).build()).toEqual(seeded);
  });

  it("carries the controller-resolved companyId through untouched (L-009)", () => {
    // Unlike the other BaseCrudController entities, this DTO is constructed
    // AFTER the company is resolved, so `build()` must not strip it.
    expect(
      new WarehouseCreateInputDTO({ ...seeded, companyId: "3" }).build()
        .companyId,
    ).toBe(3);
  });

  it("adds the name cap the form never had, at the live varchar(255)", () => {
    expect(
      new WarehouseCreateInputDTO({
        ...seeded,
        name: "x".repeat(255),
      }).build().name,
    ).toHaveLength(255);

    expect(
      failure(() =>
        new WarehouseCreateInputDTO({
          ...seeded,
          name: "x".repeat(256),
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "name",
        message: "El nombre no puede superar los 255 caracteres",
      },
    ]);
  });

  it("requires the name", () => {
    expect(
      failure(() =>
        new WarehouseCreateInputDTO({ ...seeded, name: "   " }).build(),
      ).errors,
    ).toEqual([{ field: "name", message: "El nombre es obligatorio" }]);
  });

  it("KEEPS the 1..50 product bound on both grid dimensions", () => {
    // Sign-off: `grid_rows`/`grid_cols` are plain `integer` columns with ZERO
    // CHECK constraints, so Postgres would take any int32. 1..50 is a product
    // rule and is NOT widened to the column's physical range.
    expect(
      new WarehouseCreateInputDTO({
        ...seeded,
        gridRows: 1,
        gridCols: 50,
      }).build(),
    ).toEqual({ ...seeded, gridRows: 1, gridCols: 50 });

    expect(
      failure(() =>
        new WarehouseCreateInputDTO({ ...seeded, gridRows: 0 }).build(),
      ).errors,
    ).toEqual([
      {
        field: "gridRows",
        message: "El número de filas no puede ser menor que 1",
      },
    ]);
    expect(
      failure(() =>
        new WarehouseCreateInputDTO({ ...seeded, gridCols: 51 }).build(),
      ).errors,
    ).toEqual([
      {
        field: "gridCols",
        message: "El número de columnas no puede ser mayor que 50",
      },
    ]);
    // The int32 ceiling a "corrected" DTO would have allowed.
    expect(
      failure(() =>
        new WarehouseCreateInputDTO({
          ...seeded,
          gridRows: 2147483647,
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "gridRows",
        message: "El número de filas no puede ser mayor que 50",
      },
    ]);
  });

  it('parses the strings an <input type="number"> submits', () => {
    expect(
      new WarehouseCreateInputDTO({
        ...seeded,
        gridRows: "7",
        gridCols: "8",
      }).build(),
    ).toEqual({ ...seeded, gridRows: 7, gridCols: 8 });
  });

  it("rejects the garbage that used to reach knex as NaN", () => {
    // `parseInt("abc", 10)` was assigned straight to the column before this
    // batch; Postgres then answered with an invalid-numeric-literal error.
    expect(
      failure(() =>
        new WarehouseCreateInputDTO({ ...seeded, gridRows: "abc" }).build(),
      ).errors,
    ).toEqual([
      { field: "gridRows", message: "El número de filas debe ser un número" },
    ]);
  });

  it("rejects a fractional grid size", () => {
    expect(
      failure(() =>
        new WarehouseCreateInputDTO({ ...seeded, gridCols: 2.5 }).build(),
      ).errors,
    ).toEqual([
      {
        field: "gridCols",
        message: "El número de columnas debe ser un número entero",
      },
    ]);
  });

  it("applies the column default of 10 when the grid is not stated at all", () => {
    // Pre-existing behaviour, preserved deliberately: the columns are NOT NULL
    // with `default 10`, and the create path used to fall back to 10 for an
    // absent or empty value. A batch changes what a request is CHECKED for,
    // never what it ACCEPTS.
    const dto = new WarehouseCreateInputDTO({
      name: seeded.name,
      companyId: 1,
    }).build();
    expect(dto.gridRows).toBe(10);
    expect(dto.gridCols).toBe(10);
    expect(
      new WarehouseCreateInputDTO({ ...seeded, gridRows: "" }).build().gridRows,
    ).toBe(10);
  });
});

describe("WarehouseUpdateInputDTO", () => {
  it("saves a real seeded row unchanged (Risk 2)", () => {
    // What `EditWarehouseModal` actually PUTs: the name and nothing else.
    expect(
      new WarehouseUpdateInputDTO({ name: "Depósito Central 01" }).build(),
    ).toEqual({ name: "Depósito Central 01" });
  });

  it("sets nothing when the request carried nothing", () => {
    expect(Object.keys(new WarehouseUpdateInputDTO({}).build())).toEqual([]);
  });

  it("keeps the 1..50 bound on the grid-editor's door into the same columns", () => {
    // `WarehouseGridEditorModal` (B7) PUTs `{gridRows, gridCols}` here.
    expect(
      new WarehouseUpdateInputDTO({ gridRows: 12, gridCols: 8 }).build(),
    ).toEqual({ gridRows: 12, gridCols: 8 });

    expect(
      failure(() => new WarehouseUpdateInputDTO({ gridCols: 0 }).build())
        .errors,
    ).toEqual([
      {
        field: "gridCols",
        message: "El número de columnas no puede ser menor que 1",
      },
    ]);
    expect(
      failure(() => new WarehouseUpdateInputDTO({ gridRows: 51 }).build())
        .errors,
    ).toEqual([
      {
        field: "gridRows",
        message: "El número de filas no puede ser mayor que 50",
      },
    ]);
  });

  it("still validates a name that is present", () => {
    expect(
      failure(() => new WarehouseUpdateInputDTO({ name: "" }).build()).errors,
    ).toEqual([{ field: "name", message: "El nombre es obligatorio" }]);
  });
});
