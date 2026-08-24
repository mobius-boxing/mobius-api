/**
 * Type coercion of extracted values (AC-9), mutation-checked (L-018).
 *
 * The invariant, stated once: **a value that does not match its declared type
 * is persisted as `null`, never as whatever JavaScript would make of it.**
 * Every case below is chosen so that the lenient alternative produces a
 * DIFFERENT, plausible-looking value — `Number("1,234")`-style ambiguity,
 * truthiness, `parseFloat` eating a suffix, `new Date` rolling February 31st
 * into March. If the invariant is broken, these flip red; a test that only
 * checked well-formed input would not.
 */
import { describe, it, expect } from "@jest/globals";
import {
  coerceFieldValue,
  coerceModelOutput,
  coerceReviewValues,
  missingRequiredLabels,
} from "../../../../services/node-files/extraction/field-schema";
import {
  INodeFilesField,
  NodeFilesFieldType,
} from "../../../../interfaces/node-files/node-files.interfaces";

const field = (
  key: string,
  type: NodeFilesFieldType,
  overrides: Partial<INodeFilesField> = {},
): INodeFilesField => ({
  key,
  label: key,
  type,
  description: null,
  required: false,
  ...overrides,
});

describe("coerceFieldValue — well-formed input", () => {
  it("keeps a value that already matches its declared type", () => {
    expect(coerceFieldValue("string", "  Acme  ")).toBe("Acme");
    expect(coerceFieldValue("number", 42)).toBe(42);
    expect(coerceFieldValue("currency", 1234.56)).toBe(1234.56);
    expect(coerceFieldValue("boolean", false)).toBe(false);
    expect(coerceFieldValue("date", "2026-08-24")).toBe("2026-08-24");
    expect(coerceFieldValue("list", ["a", " b "])).toEqual(["a", "b"]);
  });

  it("accepts the conversions that are unambiguous", () => {
    // A number written as plain digits is one reading only.
    expect(coerceFieldValue("number", "12.5")).toBe(12.5);
    expect(coerceFieldValue("number", "-7")).toBe(-7);
    // An ISO datetime has exactly one calendar day.
    expect(coerceFieldValue("date", "2026-08-24T15:04:05Z")).toBe("2026-08-24");
    // "true"/"false" are the two words the schema itself would have produced.
    expect(coerceFieldValue("boolean", "TRUE")).toBe(true);
    // A number in a string field prints one way.
    expect(coerceFieldValue("string", 7)).toBe("7");
  });

  it("treats absent and empty as 'not found'", () => {
    expect(coerceFieldValue("string", null)).toBeNull();
    expect(coerceFieldValue("string", undefined)).toBeNull();
    expect(coerceFieldValue("string", "   ")).toBeNull();
    expect(coerceFieldValue("number", null)).toBeNull();
  });
});

describe("coerceFieldValue — the invariant (mutation-checked)", () => {
  it("refuses a grouped or comma-decimal number instead of picking a reading", () => {
    // "1,234" is 1234 to an American reader and 1.234 to a European one — a
    // thousandfold difference. Null is the only honest answer.
    expect(coerceFieldValue("currency", "1,234")).toBeNull();
    expect(coerceFieldValue("currency", "1.234,56")).toBeNull();
    expect(coerceFieldValue("number", "1 234")).toBeNull();
  });

  it("refuses a number with a suffix rather than parseFloat's prefix", () => {
    // parseFloat("12 kg") is 12; Number("12 kg") is NaN. Neither may be stored.
    expect(coerceFieldValue("number", "12 kg")).toBeNull();
    expect(coerceFieldValue("currency", "$1000")).toBeNull();
    expect(coerceFieldValue("number", "abc")).toBeNull();
    expect(coerceFieldValue("number", Number.NaN)).toBeNull();
    expect(coerceFieldValue("number", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("refuses a non-boolean word rather than reading it as truthy", () => {
    // Truthiness would make every one of these `true`.
    expect(coerceFieldValue("boolean", "sí")).toBeNull();
    expect(coerceFieldValue("boolean", "yes")).toBeNull();
    expect(coerceFieldValue("boolean", "1")).toBeNull();
    expect(coerceFieldValue("boolean", 1)).toBeNull();
    // And falsiness would make this one `false` instead of "not found".
    expect(coerceFieldValue("boolean", 0)).toBeNull();
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    // new Date("2026-02-31") silently becomes March 3rd.
    expect(coerceFieldValue("date", "2026-02-31")).toBeNull();
    expect(coerceFieldValue("date", "2026-13-01")).toBeNull();
    // A non-ISO date is ambiguous (day/month order) and is refused outright.
    expect(coerceFieldValue("date", "24/08/2026")).toBeNull();
    expect(coerceFieldValue("date", "August 24, 2026")).toBeNull();
    // A real leap day still passes, so the check is a calendar check and not a
    // blanket rejection of anything unusual.
    expect(coerceFieldValue("date", "2024-02-29")).toBe("2024-02-29");
    expect(coerceFieldValue("date", "2026-02-29")).toBeNull();
  });

  it("refuses a scalar where a list was declared, and drops non-text items", () => {
    expect(coerceFieldValue("list", "a, b")).toBeNull();
    expect(coerceFieldValue("list", { 0: "a" })).toBeNull();
    expect(coerceFieldValue("list", ["a", null, { x: 1 }, "", "b"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("refuses an object or array where a scalar was declared", () => {
    expect(coerceFieldValue("string", { value: "Acme" })).toBeNull();
    expect(coerceFieldValue("string", ["Acme"])).toBeNull();
    expect(coerceFieldValue("number", ["12"])).toBeNull();
    expect(coerceFieldValue("date", 20260824)).toBeNull();
  });
});

describe("coerceModelOutput", () => {
  const fields = [
    field("total", "currency"),
    field("fecha", "date"),
    field("items", "list"),
  ];

  it("coerces every declared field and clamps confidence to 0..1", () => {
    const values = coerceModelOutput(fields, {
      total: { value: "1,234", confidence: 0.9 },
      fecha: { value: "2026-02-31", confidence: 4 },
      items: { value: ["a"], confidence: -2 },
    });

    expect(values.total).toEqual({ value: null, confidence: 0.9 });
    expect(values.fecha).toEqual({ value: null, confidence: 1 });
    expect(values.items).toEqual({ value: ["a"], confidence: 0 });
  });

  it("answers for a declared field the model omitted, and drops keys it invented", () => {
    const values = coerceModelOutput(fields, {
      total: { value: 10, confidence: 1 },
      inventado: { value: "x", confidence: 1 },
    });

    expect(Object.keys(values).sort()).toEqual(["fecha", "items", "total"]);
    expect(values.fecha).toEqual({ value: null, confidence: 0 });
  });

  it("survives a malformed entry without throwing", () => {
    const values = coerceModelOutput(fields, {
      total: "1234",
      fecha: null,
      items: [],
    });
    expect(values.total).toEqual({ value: null, confidence: 0 });
    expect(values.fecha).toEqual({ value: null, confidence: 0 });
  });
});

describe("coerceReviewValues", () => {
  const fields = [field("total", "currency"), field("fecha", "date")];

  it("runs human input through the same door, at full confidence", () => {
    const values = coerceReviewValues(fields, {
      total: "1500.75",
      fecha: "2026-08-24",
    });
    expect(values.total).toEqual({ value: 1500.75, confidence: 1 });
    expect(values.fecha).toEqual({ value: "2026-08-24", confidence: 1 });
  });

  it("nulls a human value that does not match its declared type", () => {
    // A person typing "1.500,75" gets a null they can see, not 1.5.
    expect(coerceReviewValues(fields, { total: "1.500,75" }).total).toEqual({
      value: null,
      confidence: 1,
    });
  });

  it("throws on a key the workflow never declared instead of dropping it", () => {
    expect(() => coerceReviewValues(fields, { totl: "10" })).toThrow(/totl/);
  });
});

describe("missingRequiredLabels", () => {
  it("names the required fields that came back empty, and only those", () => {
    const fields = [
      field("total", "currency", { label: "Total", required: true }),
      field("fecha", "date", { label: "Fecha", required: true }),
      field("nota", "string", { label: "Nota" }),
    ];
    const values = coerceModelOutput(fields, {
      total: { value: 10, confidence: 1 },
      fecha: { value: "2026-02-31", confidence: 1 },
      nota: { value: null, confidence: 0 },
    });

    expect(missingRequiredLabels(fields, values)).toEqual(["Fecha"]);
  });
});
