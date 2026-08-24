import { NodeExecutionError } from "./node-type";

/**
 * `{{path.to.value}}` substitution over the run context — value substitution
 * and nothing else (brief non-goal: "templating beyond `{{path}}` value
 * substitution").
 *
 * There is no expression language here, no filters, no conditionals and no
 * function calls, and that is the design: the only thing a template can do is
 * read a value that already exists in the context and print it.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 *  - **An unknown path throws.** The tempting alternative — render an empty
 *    string — is the same silent-wrong-answer failure that disqualified the
 *    expression evaluator for conditions (brief D-2): an email that says
 *    "Total: " because someone typed `{{fields.totl}}` is worse than an email
 *    that was never sent. A path that EXISTS and holds `null` renders empty,
 *    because that is a real value.
 *  - **Prototype keys are not paths.** `__proto__`, `constructor` and
 *    `prototype` are refused as segments, so a template can never walk out of
 *    the data and into JavaScript.
 */

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** Path segments must be plain identifiers or array indices. */
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export type TemplateSource = Record<string, unknown>;

/** Reads one dotted path out of the context. Throws if the path is not there. */
export function lookupPath(source: TemplateSource, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = source;

  for (const segment of segments) {
    if (segment === "" || !SEGMENT_PATTERN.test(segment)) {
      throw new NodeExecutionError(`Referencia inválida: {{${path}}}`);
    }
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new NodeExecutionError(`Referencia inválida: {{${path}}}`);
    }
    if (current === null || typeof current !== "object") {
      throw new NodeExecutionError(
        `No existe el valor referenciado: {{${path}}}`,
      );
    }
    const container = current as Record<string, unknown>;
    // `in` on an own-property check only: an inherited key is not data.
    if (!Object.prototype.hasOwnProperty.call(container, segment)) {
      throw new NodeExecutionError(
        `No existe el valor referenciado: {{${path}}}`,
      );
    }
    current = container[segment];
  }
  return current;
}

/** How a value prints inside a template. */
export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(renderValue).join(", ");
  return JSON.stringify(value);
}

/** Substitute every `{{path}}` in `text`. */
export function renderTemplate(text: string, source: TemplateSource): string {
  return text.replace(PLACEHOLDER, (_match, path: string) =>
    renderValue(lookupPath(source, path.trim())),
  );
}

/**
 * Every placeholder a template mentions. Used at SAVE time to reject a template
 * that references a field the workflow does not declare — the same failure the
 * run would hit, moved to where a human is looking at the screen.
 */
export function templatePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    paths.push((match[1] as string).trim());
  }
  return paths;
}
