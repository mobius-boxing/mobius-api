import { describe, it, expect } from "@jest/globals";
import {
  clearableText,
  codeText,
  emptyToUndefined,
  optionalDate,
  optionalInt,
  optionalNumber,
  optionalText,
  optionalUuid,
  requiredDate,
  requiredInt,
  requiredNumber,
  requiredText,
  requiredUuid,
  toBoolean,
} from "../../../../dto/input/shared/fieldValidators";
import {
  collect,
  FieldValidationError,
  ValidationError,
} from "../../../../dto/input/shared/ValidationError";

const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the validator to throw");
};

describe("fieldValidators — text", () => {
  it("trims and accepts a value at the column limit", () => {
    expect(requiredText("  AB  ", 2, "El código")).toBe("AB");
  });

  it("rejects an empty required text in Spanish", () => {
    expect(message(() => requiredText("   ", 50, "El código"))).toBe(
      "El código es obligatorio",
    );
  });

  it("rejects text longer than the column limit", () => {
    expect(message(() => requiredText("x".repeat(51), 50, "El código"))).toBe(
      "El código no puede superar los 50 caracteres",
    );
  });

  it("maps an absent optional text to undefined and keeps null as null", () => {
    expect(optionalText("", 10, "La descripción")).toBeUndefined();
    expect(optionalText(undefined, 10, "La descripción")).toBeUndefined();
    expect(optionalText(null, 10, "La descripción")).toBeNull();
  });

  it("accepts every character the client's code class allows", () => {
    // Mirror of CODE_PATTERN in mobius-web-app `src/validation/fields.ts`:
    // letters, digits, `_ . - /` and spaces. Padding is trimmed first, so a
    // leading/trailing space never reaches the class check — same as zod's
    // `.trim().min(1).max(n).regex(...)` chain.
    expect(codeText("  AB_1.2-3/4 X  ", 50, "El código")).toBe("AB_1.2-3/4 X");
  });

  it("rejects a code carrying a character outside that class", () => {
    expect(message(() => codeText("A+B", 50, "El código"))).toBe(
      "El código tiene un formato inválido",
    );
    expect(message(() => codeText("Ñ", 50, "El código"))).toBe(
      "El código tiene un formato inválido",
    );
  });

  it("reports a blank code as required, never as a format error", () => {
    // The class is quantified `*` precisely so emptiness stays requiredText's
    // job; `+` would make one blank field raise two messages.
    expect(message(() => codeText("   ", 50, "El código"))).toBe(
      "El código es obligatorio",
    );
  });

  it("still bounds a well-formed code by the column limit", () => {
    expect(message(() => codeText("x".repeat(51), 50, "El código"))).toBe(
      "El código no puede superar los 50 caracteres",
    );
  });

  it("keeps an explicit empty string clearable", () => {
    // Update DTOs strip undefined keys, so "" must survive or a field can
    // never be cleared once set.
    expect(clearableText("", 10, "La descripción")).toBe("");
    expect(clearableText(undefined, 10, "La descripción")).toBeUndefined();
  });
});

describe("fieldValidators — numbers", () => {
  it("never produces NaN from an empty string", () => {
    // parseFloat("") is NaN, and NaN reaches Postgres as an invalid numeric
    // literal. This is the silent-corruption bug the helper closes.
    const parsed = optionalNumber("", {}, "El largo");
    expect(parsed).toBeUndefined();
    expect(Number.isNaN(parsed as unknown as number)).toBe(false);
  });

  it("coerces numeric strings and accepts the column maximum", () => {
    expect(
      optionalNumber("12.5", { max: 999999.99, decimals: 2 }, "El largo"),
    ).toBe(12.5);
    expect(
      optionalNumber(999999.99, { max: 999999.99, decimals: 2 }, "El largo"),
    ).toBe(999999.99);
  });

  it("rejects a non-numeric string", () => {
    expect(message(() => optionalNumber("abc", {}, "El largo"))).toBe(
      "El largo debe ser un número",
    );
  });

  it("rejects negatives, over-maximum values and excess decimals", () => {
    expect(message(() => optionalNumber(-1, {}, "El largo"))).toBe(
      "El largo no puede ser menor que 0",
    );
    expect(
      message(() => optionalNumber(1000000, { max: 999999.99 }, "El largo")),
    ).toBe("El largo no puede ser mayor que 999999.99");
    expect(
      message(() => optionalNumber(1.005, { decimals: 2 }, "El largo")),
    ).toBe("El largo admite como máximo 2 decimales");
  });

  it("requires a value when the column is notNullable", () => {
    expect(message(() => requiredNumber("", {}, "La cantidad"))).toBe(
      "La cantidad es obligatorio",
    );
    expect(requiredNumber("3", {}, "La cantidad")).toBe(3);
  });

  it("rejects fractions on integer columns", () => {
    expect(message(() => optionalInt("1.5", {}, "La cantidad"))).toBe(
      "La cantidad debe ser un número entero",
    );
    expect(optionalInt("7", { max: 2147483647 }, "La cantidad")).toBe(7);
    expect(requiredInt(0, {}, "La cantidad")).toBe(0);
  });
});

describe("fieldValidators — booleans, uuids and dates", () => {
  it("coerces boolean strings and never reads '' as false", () => {
    expect(toBoolean("true", "Activo")).toBe(true);
    expect(toBoolean("false", "Activo")).toBe(false);
    expect(toBoolean("", "Activo")).toBeUndefined();
    expect(message(() => toBoolean("yes", "Activo"))).toBe(
      "Activo debe ser verdadero o falso",
    );
  });

  it("accepts a uuid and rejects anything else", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(requiredUuid(uuid, "El almacén")).toBe(uuid);
    expect(optionalUuid("", "El almacén")).toBeUndefined();
    expect(message(() => optionalUuid("42", "El almacén"))).toBe(
      "El almacén no es válido",
    );
  });

  it("accepts DD/MM/YYYY and ISO, normalising to ISO", () => {
    expect(optionalDate("05/02/2026", "La fecha")).toBe("2026-02-05");
    expect(optionalDate("2026-02-05", "La fecha")).toBe("2026-02-05");
    expect(optionalDate("2026-02-05T10:00:00.000Z", "La fecha")).toBe(
      "2026-02-05",
    );
    expect(optionalDate("", "La fecha")).toBeUndefined();
  });

  it("rejects an impossible calendar date instead of rolling it over", () => {
    expect(message(() => optionalDate("31/02/2026", "La fecha"))).toBe(
      "La fecha no es una fecha válida",
    );
    expect(message(() => requiredDate("", "La fecha"))).toBe(
      "La fecha es obligatorio",
    );
  });
});

describe("emptyToUndefined", () => {
  it("only collapses blank strings", () => {
    expect(emptyToUndefined("  ")).toBeUndefined();
    expect(emptyToUndefined(0)).toBe(0);
    expect(emptyToUndefined(false)).toBe(false);
    expect(emptyToUndefined(null)).toBeNull();
  });
});

describe("collect", () => {
  it("aggregates every failing field instead of stopping at the first", () => {
    let thrown: unknown;
    try {
      collect((field) => {
        field("code", () => requiredText("", 50, "El código"));
        field("length", () => optionalNumber("abc", {}, "El largo"));
        field("description", () => optionalText("ok", 50, "La descripción"));
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    const error = thrown as ValidationError;
    expect(error.name).toBe("ValidationError");
    expect(error.statusCode).toBe(400);
    expect(error.isValidationError).toBe(true);
    expect(error.errors).toEqual([
      { field: "code", message: "El código es obligatorio" },
      { field: "length", message: "El largo debe ser un número" },
    ]);
    expect(error.message).toBe("El código es obligatorio");
  });

  it("returns the built value untouched when every field passes", () => {
    const result = collect((field) => ({
      code: field("code", () => requiredText("A1", 50, "El código")),
    }));

    expect(result).toEqual({ code: "A1" });
  });

  it("prefers the field name a FieldValidationError carries", () => {
    let thrown: unknown;
    try {
      collect((field) => {
        field("outer", () => {
          throw new FieldValidationError("inner", "explota");
        });
      });
    } catch (err) {
      thrown = err;
    }

    expect((thrown as ValidationError).errors).toEqual([
      { field: "inner", message: "explota" },
    ]);
  });
});
