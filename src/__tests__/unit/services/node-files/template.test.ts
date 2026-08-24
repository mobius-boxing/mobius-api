/**
 * `{{path}}` substitution.
 *
 * The load-bearing decision is that an unknown path THROWS. Rendering "" would
 * turn a typo into an email that reads "Total: " and a run that reports
 * success — the same silent-wrong-answer failure that disqualified an
 * expression evaluator for conditions (brief D-2).
 */
import { describe, expect, it } from "@jest/globals";
import {
  lookupPath,
  renderTemplate,
  templatePaths,
} from "../../../../services/node-files/nodes/template";
import { NodeExecutionError } from "../../../../services/node-files/nodes/node-type";

const SOURCE = {
  document: { name: "factura.pdf" },
  fields: { total: 1500, proveedor: "Acme", nota: null, items: ["a", "b"] },
  nodes: { c1: { result: true } },
};

describe("renderTemplate", () => {
  it("substitutes values of every printable shape", () => {
    expect(
      renderTemplate(
        "{{document.name}} · {{fields.total}} · {{fields.proveedor}} · {{fields.items}} · {{nodes.c1.result}}",
        SOURCE,
      ),
    ).toBe("factura.pdf · 1500 · Acme · a, b · true");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{  fields.total  }}", SOURCE)).toBe("1500");
  });

  it("renders a present-but-null value as empty — that is a real value", () => {
    expect(renderTemplate("[{{fields.nota}}]", SOURCE)).toBe("[]");
  });

  it("throws on a path that does not exist instead of rendering nothing", () => {
    expect(() => renderTemplate("{{fields.totl}}", SOURCE)).toThrow(
      NodeExecutionError,
    );
    expect(() => renderTemplate("{{campos.total}}", SOURCE)).toThrow(
      /No existe el valor referenciado/,
    );
  });

  it("leaves text with no placeholders alone", () => {
    expect(renderTemplate("sin placeholders", SOURCE)).toBe("sin placeholders");
  });
});

describe("lookupPath refuses to walk out of the data", () => {
  it("blocks prototype keys", () => {
    for (const path of [
      "__proto__",
      "fields.__proto__.x",
      "constructor",
      "fields.constructor.name",
    ]) {
      expect(() => lookupPath(SOURCE, path)).toThrow(NodeExecutionError);
    }
  });

  it("blocks segments that are not plain identifiers", () => {
    expect(() => lookupPath(SOURCE, "fields['total']")).toThrow(
      /Referencia inválida/,
    );
    expect(() => lookupPath(SOURCE, "fields..total")).toThrow(
      /Referencia inválida/,
    );
  });

  it("does not read inherited properties", () => {
    // `toString` exists on every object; it is not data and must not resolve.
    expect(() => lookupPath(SOURCE, "fields.toString")).toThrow(
      /No existe el valor referenciado/,
    );
  });
});

describe("templatePaths", () => {
  it("lists every placeholder so a save can check them", () => {
    expect(
      templatePaths(
        "{{fields.total}} y {{ document.name }} y {{fields.total}}",
      ),
    ).toEqual(["fields.total", "document.name", "fields.total"]);
  });
});
