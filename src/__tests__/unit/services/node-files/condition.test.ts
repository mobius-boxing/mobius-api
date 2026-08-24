/**
 * The condition node (brief D-2): structured comparison, typed against the
 * field's DECLARED type.
 *
 * The rules worth pinning are the ones whose failure mode is silence. A branch
 * gate that answers `false` because `"9" > "10"` in string-land, or because an
 * operator was applied to a type it does not order, sends the run down the
 * wrong path and reports nothing at all — which is exactly why this node is not
 * an expression evaluator.
 */
import { describe, expect, it } from "@jest/globals";
import {
  conditionNode,
  evaluateCondition,
} from "../../../../services/node-files/nodes/condition.node";
import { NodeConfigError } from "../../../../services/node-files/nodes/node-type";
import { INodeFilesField } from "../../../../interfaces/node-files/node-files.interfaces";

const field = (
  key: string,
  type: INodeFilesField["type"],
): INodeFilesField => ({
  key,
  label: key,
  type,
  description: null,
  required: false,
});

const FIELDS: INodeFilesField[] = [
  field("total", "currency"),
  field("cantidad", "number"),
  field("fecha", "date"),
  field("proveedor", "string"),
  field("pagado", "boolean"),
  field("items", "list"),
];

const validate = (config: Record<string, unknown>): void =>
  conditionNode.validate(config, { fields: FIELDS });

describe("evaluateCondition — numbers are compared as numbers", () => {
  it("orders numerically, not lexicographically", () => {
    // The whole reason for the declared type: as strings, "9" > "10".
    expect(
      evaluateCondition(
        { left: "total", op: "gt", right: "10" },
        "9",
        "currency",
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { left: "total", op: "lt", right: "10" },
        "9",
        "currency",
      ),
    ).toBe(true);
  });

  it("handles the boundary the same way in both directions", () => {
    const at = (op: "gt" | "gte" | "lt" | "lte"): boolean =>
      evaluateCondition({ left: "total", op, right: "100" }, 100, "currency");
    expect([at("gt"), at("gte"), at("lt"), at("lte")]).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("answers false when the value is not comparable, and says nothing else", () => {
    expect(
      evaluateCondition(
        { left: "total", op: "gt", right: "10" },
        "no es un número",
        "currency",
      ),
    ).toBe(false);
  });
});

describe("evaluateCondition — the other types", () => {
  it("compares dates as dates", () => {
    expect(
      evaluateCondition(
        { left: "fecha", op: "gt", right: "2026-01-01" },
        "2026-08-24",
        "date",
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: "fecha", op: "lt", right: "2026-01-01" },
        "2026-08-24",
        "date",
      ),
    ).toBe(false);
  });

  it("compares strings trimmed and exactly", () => {
    expect(
      evaluateCondition(
        { left: "proveedor", op: "eq", right: "Acme" },
        " Acme ",
        "string",
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: "proveedor", op: "eq", right: "acme" },
        "Acme",
        "string",
      ),
    ).toBe(false);
  });

  it("contains is a substring for text and a membership test for lists", () => {
    expect(
      evaluateCondition(
        { left: "proveedor", op: "contains", right: "cm" },
        "Acme SA",
        "string",
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: "items", op: "contains", right: "tornillos" },
        ["clavos", "tornillos"],
        "list",
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: "items", op: "contains", right: "tuercas" },
        ["clavos", "tornillos"],
        "list",
      ),
    ).toBe(false);
  });

  it("treats null, empty string and empty list as empty", () => {
    for (const value of [null, "", "   ", []]) {
      expect(
        evaluateCondition(
          { left: "total", op: "isEmpty", right: null },
          value,
          "string",
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          { left: "total", op: "isNotEmpty", right: null },
          value,
          "string",
        ),
      ).toBe(false);
    }
    expect(
      evaluateCondition(
        { left: "total", op: "isNotEmpty", right: null },
        0,
        "number",
      ),
    ).toBe(true);
  });

  it("does not confuse a missing value with a non-matching one", () => {
    expect(
      evaluateCondition(
        { left: "proveedor", op: "eq", right: "Acme" },
        null,
        "string",
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { left: "proveedor", op: "neq", right: "Acme" },
        null,
        "string",
      ),
    ).toBe(true);
  });
});

describe("validate — the config is refused at SAVE time, not at run time", () => {
  it("accepts a well-formed condition", () => {
    expect(() =>
      validate({ left: "total", op: "gte", right: "1000" }),
    ).not.toThrow();
  });

  it("refuses a field the workflow does not declare", () => {
    expect(() => validate({ left: "totl", op: "eq", right: "1" })).toThrow(
      NodeConfigError,
    );
  });

  it("refuses an ordering operator on a type that has no order", () => {
    expect(() => validate({ left: "pagado", op: "gt", right: "true" })).toThrow(
      /no se puede usar con un campo de tipo boolean/,
    );
    expect(() => validate({ left: "items", op: "lt", right: "3" })).toThrow(
      NodeConfigError,
    );
  });

  it("refuses `contains` on a number", () => {
    expect(() =>
      validate({ left: "cantidad", op: "contains", right: "3" }),
    ).toThrow(/texto o lista/);
  });

  it("refuses a right-hand side that is not of the field's type", () => {
    expect(() => validate({ left: "total", op: "gt", right: "mucho" })).toThrow(
      /no es un número válido/,
    );
    expect(() =>
      validate({ left: "fecha", op: "gt", right: "mañana" }),
    ).toThrow(/no es una fecha válida/);
  });

  it("requires a comparison value except for the emptiness operators", () => {
    expect(() => validate({ left: "total", op: "eq", right: "" })).toThrow(
      /necesita un valor/,
    );
    expect(() => validate({ left: "total", op: "isEmpty" })).not.toThrow();
  });

  it("refuses an unknown operator instead of defaulting to one", () => {
    expect(() =>
      validate({ left: "total", op: "matches", right: "x" }),
    ).toThrow(/Operador inválido/);
  });
});

describe("run — the handle follows the result", () => {
  const ctx = (fields: Record<string, unknown>) => ({
    document: { name: "f.pdf", contentType: "application/pdf" },
    fields,
    fieldTypes: { total: "currency" },
    nodes: {},
    credentials: new Map(),
    log: (): void => undefined,
  });

  it("takes the true branch when the comparison holds", async () => {
    const result = await conditionNode.run(ctx({ total: 5000 }), {
      left: "total",
      op: "gt",
      right: "1000",
    });
    expect(result.handle).toBe("true");
    expect(result.output.result).toBe(true);
  });

  it("takes the false branch when it does not", async () => {
    const result = await conditionNode.run(ctx({ total: 10 }), {
      left: "total",
      op: "gt",
      right: "1000",
    });
    expect(result.handle).toBe("false");
    expect(result.output.result).toBe(false);
  });
});
