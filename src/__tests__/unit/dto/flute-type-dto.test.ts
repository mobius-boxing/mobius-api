import { describe, it, expect } from "@jest/globals";
import {
  FluteTypeCreateInputDTO,
  FluteTypeUpdateInputDTO,
} from "../../../dto/input/fluteType";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/fluteType.ts`.
 * Bounds come from `20251101162721_create_flute_types_table.ts`:
 * code varchar(50) NOT NULL, description text NULL, and four numeric(8,2)
 * measures — NOT the modal's old inline `maxLength: 50` guess, and not the
 * brief's assumed varchar(400).
 */
const validBody = (overrides: Record<string, unknown> = {}) => ({
  code: "QD-ONDA-B01",
  description: "Onda B",
  fluteFactor: "1.36",
  length: "1.44",
  width: "1.49",
  height: "1.51",
  ...overrides,
});

const failure = (fn: () => unknown): ValidationError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected build() to throw a ValidationError");
};

describe("FluteTypeCreateInputDTO", () => {
  it("round-trips a valid payload, coercing numeric strings", () => {
    const dto = new FluteTypeCreateInputDTO(validBody()).build();

    expect(dto).toEqual({
      code: "QD-ONDA-B01",
      description: "Onda B",
      fluteFactor: 1.36,
      length: 1.44,
      width: 1.49,
      height: 1.51,
    });
  });

  it("turns an empty numeric field into undefined, never NaN", () => {
    // The bug this closes: parseFloat("") is NaN, and NaN reaches Postgres as
    // an invalid numeric literal instead of a clean 400.
    const dto = new FluteTypeCreateInputDTO(
      validBody({ fluteFactor: "", length: "", width: "", height: "" }),
    ).build();

    expect(dto.fluteFactor).toBeUndefined();
    expect(dto.length).toBeUndefined();
    expect(Number.isNaN(dto.width as unknown as number)).toBe(false);
    // The keys are DROPPED, not left holding undefined: `inputValidator`
    // rejects any own key whose value is undefined ("Param length is missing"),
    // which used to 400 a create that merely left an optional measure blank.
    expect(Object.keys(dto)).toEqual(["code", "description"]);
  });

  it("requires the code, because the column is notNullable", () => {
    const error = failure(() =>
      new FluteTypeCreateInputDTO(validBody({ code: "  " })).build(),
    );

    expect(error.statusCode).toBe(400);
    expect(error.errors).toEqual([
      { field: "code", message: "El código es obligatorio" },
    ]);
  });

  it("bounds the code by the real varchar(50)", () => {
    expect(
      new FluteTypeCreateInputDTO(validBody({ code: "x".repeat(50) })).build()
        .code,
    ).toHaveLength(50);

    expect(
      failure(() =>
        new FluteTypeCreateInputDTO(
          validBody({ code: "x".repeat(51) }),
        ).build(),
      ).errors,
    ).toEqual([
      {
        field: "code",
        message: "El código no puede superar los 50 caracteres",
      },
    ]);
  });

  // AC #4: `src/validation/schemas/fluteType.ts` builds `code` from the client
  // `code` primitive (`/^[\w.\-/ ]*$/`). The API used to accept what the form
  // refused, so the class is re-stated server-side.
  it("rejects a code character the client's class forbids", () => {
    const error = failure(() =>
      new FluteTypeCreateInputDTO(validBody({ code: "A+B" })).build(),
    );

    expect(error.statusCode).toBe(400);
    expect(error.errors).toEqual([
      { field: "code", message: "El código tiene un formato inválido" },
    ]);
  });

  it("accepts the whole class the client allows, padding trimmed", () => {
    expect(
      new FluteTypeCreateInputDTO(
        validBody({ code: "  AB_1.2-3/4 X  " }),
      ).build().code,
    ).toBe("AB_1.2-3/4 X");
  });

  it("reports every bad field at once, not just the first", () => {
    const error = failure(() =>
      new FluteTypeCreateInputDTO(
        validBody({ code: "", fluteFactor: "abc", length: -1, width: 1.005 }),
      ).build(),
    );

    expect(error.errors).toEqual([
      { field: "code", message: "El código es obligatorio" },
      { field: "fluteFactor", message: "El factor de onda debe ser un número" },
      { field: "length", message: "El largo no puede ser menor que 0" },
      {
        field: "width",
        message: "El ancho admite como máximo 2 decimales",
      },
    ]);
  });

  it("rejects a measure above the numeric(8,2) ceiling", () => {
    expect(
      failure(() =>
        new FluteTypeCreateInputDTO(validBody({ height: 1000000 })).build(),
      ).errors,
    ).toEqual([
      { field: "height", message: "El alto no puede ser mayor que 999999.99" },
    ]);
  });

  it("leaves companyId alone for the controller to inject (L-009)", () => {
    // Tenant scoping is applied by BaseCrudController AFTER buildCreateDTO
    // returns. A DTO that rejected or stripped unknown keys would break it.
    const dto = new FluteTypeCreateInputDTO(
      validBody({ companyId: 7 }),
    ).build() as unknown as Record<string, unknown>;

    expect(() => dto).not.toThrow();
    expect(dto.companyId).toBeUndefined();
    expect(dto.code).toBe("QD-ONDA-B01");
  });
});

describe("FluteTypeUpdateInputDTO", () => {
  it("sets only the fields the request carried", () => {
    const dto = new FluteTypeUpdateInputDTO({ length: "2.5" }).build();

    expect(Object.keys(dto)).toEqual(["length"]);
    expect(dto.length).toBe(2.5);
  });

  it("still validates a code that is present", () => {
    expect(
      failure(() => new FluteTypeUpdateInputDTO({ code: "" }).build()).errors,
    ).toEqual([{ field: "code", message: "El código es obligatorio" }]);

    expect(
      failure(() => new FluteTypeUpdateInputDTO({ code: "A+B" }).build())
        .errors,
    ).toEqual([
      { field: "code", message: "El código tiene un formato inválido" },
    ]);
  });

  it("keeps an empty description so the field stays clearable", () => {
    const dto = new FluteTypeUpdateInputDTO({ description: "" }).build();

    expect(dto.description).toBe("");
    expect(Object.keys(dto)).toEqual(["description"]);
  });

  it("drops an emptied number rather than sending NaN", () => {
    const dto = new FluteTypeUpdateInputDTO({
      code: "QD-ONDA-B01",
      fluteFactor: "",
    }).build();

    expect(Object.keys(dto)).toEqual(["code"]);
  });

  it("accepts an unchanged legacy row round-trip", () => {
    // Risk 2: an edit schema stricter than create blocks saving a row the user
    // never touched. These are the real values seeded in flute_types.
    const dto = new FluteTypeUpdateInputDTO({
      code: "QD-ONDA-EB06",
      description: "Onda EB — paso 6.1 mm",
      fluteFactor: "1.34",
      length: "1.53",
      width: "1.50",
      height: "4.78",
    }).build();

    expect(dto).toEqual({
      code: "QD-ONDA-EB06",
      description: "Onda EB — paso 6.1 mm",
      fluteFactor: 1.34,
      length: 1.53,
      width: 1.5,
      height: 4.78,
    });
  });
});
