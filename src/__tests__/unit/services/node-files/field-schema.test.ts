/**
 * The field → Zod schema builder (AC-9).
 *
 * What is being protected: the schema the model is forced to answer in must
 * mirror the workflow's declared fields exactly, and every value must be
 * nullable — "not found" has to be expressible, or the model invents one.
 */
import { describe, it, expect } from "@jest/globals";
import { buildExtractionSchema } from "../../../../services/node-files/extraction/field-schema";
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

describe("buildExtractionSchema", () => {
  it("builds one { value, confidence } entry per declared field", () => {
    const schema = buildExtractionSchema([
      field("total", "currency"),
      field("fecha", "date"),
      field("proveedor", "string"),
    ]);

    const parsed = schema.parse({
      total: { value: 1234.5, confidence: 0.9 },
      fecha: { value: "2026-08-24", confidence: 0.8 },
      proveedor: { value: "Acme", confidence: 1 },
    });

    expect(Object.keys(parsed).sort()).toEqual(["fecha", "proveedor", "total"]);
    expect(parsed.total).toEqual({ value: 1234.5, confidence: 0.9 });
  });

  it("accepts null for every value, whatever the declared type", () => {
    const schema = buildExtractionSchema([
      field("texto", "string"),
      field("numero", "number"),
      field("monto", "currency"),
      field("fecha", "date"),
      field("bandera", "boolean"),
      field("items", "list"),
    ]);

    const nulls = Object.fromEntries(
      ["texto", "numero", "monto", "fecha", "bandera", "items"].map((key) => [
        key,
        { value: null, confidence: 0 },
      ]),
    );

    expect(() => schema.parse(nulls)).not.toThrow();
  });

  it("maps each declared type to the JSON type it must come back as", () => {
    const schema = buildExtractionSchema([
      field("numero", "number"),
      field("bandera", "boolean"),
      field("items", "list"),
    ]);

    // A number spelled as text, a boolean spelled as text and a bare string
    // where a list was declared are all rejected at the schema, before any
    // coercion gets a chance to be lenient about them.
    expect(() =>
      schema.parse({
        numero: { value: "12", confidence: 1 },
        bandera: { value: true, confidence: 1 },
        items: { value: ["a"], confidence: 1 },
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        numero: { value: 12, confidence: 1 },
        bandera: { value: "true", confidence: 1 },
        items: { value: ["a"], confidence: 1 },
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        numero: { value: 12, confidence: 1 },
        bandera: { value: true, confidence: 1 },
        items: { value: "a", confidence: 1 },
      }),
    ).toThrow();
  });

  it("requires every declared field to be answered, if only with null", () => {
    const schema = buildExtractionSchema([
      field("a", "string"),
      field("b", "string"),
    ]);
    expect(() => schema.parse({ a: { value: "x", confidence: 1 } })).toThrow();
  });

  it("refuses a workflow that declares no fields at all", () => {
    // A run with nothing to extract would still cost a call to the model.
    expect(() => buildExtractionSchema([])).toThrow(/ningún campo/);
  });

  it("carries the label and description into the schema description", () => {
    const schema = buildExtractionSchema([
      field("total", "currency", {
        label: "Total",
        description: "el total con IVA",
      }),
    ]);
    const shape = schema.shape.total as { description?: string };
    expect(shape.description).toContain("Total");
    expect(shape.description).toContain("el total con IVA");
  });
});
