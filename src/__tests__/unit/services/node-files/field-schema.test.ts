/**
 * The field → Zod schema builder (AC-9).
 *
 * What is being protected: the schema the model is forced to answer in must
 * mirror the workflow's declared fields exactly, and every value must be
 * nullable — "not found" has to be expressible, or the model invents one.
 */
import { describe, it, expect } from "@jest/globals";
import {
  buildExtractionJsonSchema,
  buildExtractionSchema,
} from "../../../../services/node-files/extraction/field-schema";
import {
  INodeFilesField,
  NODE_FILES_FIELD_TYPES,
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

/**
 * The two builders describe the SAME contract to two different providers, and
 * nothing in the type system ties them together — one can be edited without
 * the other and everything still compiles. These cases are that tie: if the
 * Zod schema and the JSON Schema ever disagree about which keys exist, what a
 * value's base type is, or whether it may be null, a workflow means one thing
 * on Claude and another on OpenAI.
 *
 * The loop is over `NODE_FILES_FIELD_TYPES`, and the sample table is a
 * `Record` over it, so adding a seventh field type without teaching both
 * builders about it is a compile error rather than a silent gap.
 */
type JsonProperty = { type: string[]; description?: string };
type JsonEntry = {
  type: string;
  description?: string;
  properties: { value: JsonProperty; confidence: JsonProperty };
  required: string[];
  additionalProperties: boolean;
};
type JsonRoot = {
  type: string;
  properties: Record<string, JsonEntry>;
  required: string[];
  additionalProperties: boolean;
};

const SAMPLE: Record<NodeFilesFieldType, { value: unknown; jsonType: string }> =
  {
    string: { value: "Acme", jsonType: "string" },
    number: { value: 12.5, jsonType: "number" },
    currency: { value: 12.5, jsonType: "number" },
    date: { value: "2026-08-25", jsonType: "string" },
    boolean: { value: true, jsonType: "boolean" },
    list: { value: ["a", "b"], jsonType: "array" },
  };

describe("buildExtractionJsonSchema ⇄ buildExtractionSchema", () => {
  const fields = NODE_FILES_FIELD_TYPES.map((type) => field(`f_${type}`, type));

  it("agrees on the key set", () => {
    const zodKeys = Object.keys(buildExtractionSchema(fields).shape).sort();
    const json = buildExtractionJsonSchema(fields) as JsonRoot;

    expect(Object.keys(json.properties).sort()).toEqual(zodKeys);
    // strict mode: every property is required, none may be added.
    expect([...json.required].sort()).toEqual(zodKeys);
    expect(json.additionalProperties).toBe(false);
  });

  it.each(NODE_FILES_FIELD_TYPES)(
    "agrees on the base type and on nullability for %s",
    (type) => {
      const one = [field("campo", type)];
      const zod = buildExtractionSchema(one);
      const json = (buildExtractionJsonSchema(one) as JsonRoot).properties
        .campo;
      const sample = SAMPLE[type];

      // Both accept the declared type...
      expect(
        zod.safeParse({ campo: { value: sample.value, confidence: 1 } })
          .success,
      ).toBe(true);
      expect(json.properties.value.type).toContain(sample.jsonType);

      // ...and both accept "I could not find it".
      expect(
        zod.safeParse({ campo: { value: null, confidence: 0 } }).success,
      ).toBe(true);
      expect(json.properties.value.type).toContain("null");

      expect([...json.required].sort()).toEqual(["confidence", "value"]);
      expect(json.additionalProperties).toBe(false);
    },
  );

  it("carries the same description into both schemas", () => {
    const one = [
      field("total", "currency", {
        label: "Total",
        description: "el total con IVA",
      }),
    ];
    const zodDescription = (
      buildExtractionSchema(one).shape.total as { description?: string }
    ).description;
    const json = (buildExtractionJsonSchema(one) as JsonRoot).properties.total;

    expect(json.description).toBe(zodDescription);
  });

  it("refuses a workflow that declares no fields at all", () => {
    expect(() => buildExtractionJsonSchema([])).toThrow(/ningún campo/);
  });
});
