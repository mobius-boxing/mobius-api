import { z } from "zod";
import {
  INodeFilesExtractedValue,
  INodeFilesField,
  NodeFilesExtractedValues,
  NodeFilesFieldType,
} from "../../../interfaces/node-files/node-files.interfaces";

/**
 * The declared-field ⇄ typed-value boundary: one place builds the schema the
 * model must answer in, and the same place decides what an answer is worth.
 *
 * Nothing the model returns is trusted. `parse()` already rejects the wrong
 * JSON shape, but a schema-valid answer can still be a nonsense date or a
 * number spelled as text, and the review endpoint feeds human input through the
 * very same door. Every value is therefore coerced and validated against its
 * declared type before it is persisted — and a value that does not survive that
 * becomes `null`, never a plausible-looking guess.
 */

/** ISO calendar date, `YYYY-MM-DD`, that actually exists. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A decimal number with NO thousands separator, and no comma decimal mark.
 *
 * Rejecting `"1,234"` outright is the point: read as a European decimal it is
 * 1.234, read as an American group it is 1234 — a thousandfold error that no
 * later validation can catch. An unparseable amount becomes `null`, which is
 * visible; a silently misread one is not.
 */
const PLAIN_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** `2026-02-31` is schema-valid and does not exist. `new Date` would roll it. */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** The Zod type one declared field's `value` may take, before `.nullable()`. */
function valueSchemaFor(type: NodeFilesFieldType): z.ZodType {
  switch (type) {
    case "number":
    case "currency":
      return z.number();
    case "boolean":
      return z.boolean();
    case "list":
      return z.array(z.string());
    // A date crosses the wire as an ISO string and is validated after parsing,
    // so the model is never refused for a formatting slip it could explain.
    case "date":
    case "string":
    default:
      return z.string();
  }
}

/**
 * The schema the model is forced to answer in: one key per declared field,
 * each `{ value, confidence }`.
 *
 * Every `value` is `.nullable()` on purpose — "I could not find it" has to be
 * expressible, or the model invents something rather than return nothing.
 */
export function buildExtractionSchema(
  fields: INodeFilesField[],
): z.ZodObject<z.ZodRawShape> {
  if (fields.length === 0) {
    throw new Error("El flujo no declara ningún campo a extraer");
  }
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const description = field.description
      ? `${field.label} — ${field.description}`
      : field.label;
    shape[field.key] = z
      .object({
        value: valueSchemaFor(field.type)
          .nullable()
          .describe(`${description}. null si no aparece en el documento.`),
        confidence: z
          .number()
          .describe("Confianza de 0 a 1 en el valor extraído."),
      })
      .describe(description);
  }
  return z.object(shape);
}

/**
 * One value, coerced to its declared type or discarded.
 *
 * The contract, which the unit tests pin down: a value that does not match its
 * declared type comes back `null`. JavaScript's own coercions — truthiness for
 * booleans, `parseFloat` eating a trailing suffix, `new Date` rolling an
 * impossible day into the next month — are exactly what must NOT happen here.
 */
export function coerceFieldValue(
  type: NodeFilesFieldType,
  raw: unknown,
): INodeFilesExtractedValue["value"] {
  if (raw === null || raw === undefined) return null;

  switch (type) {
    case "string": {
      if (typeof raw === "number" || typeof raw === "boolean") {
        return String(raw);
      }
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      return trimmed === "" ? null : trimmed;
    }

    case "number":
    case "currency": {
      if (typeof raw === "number") {
        return Number.isFinite(raw) ? raw : null;
      }
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (!PLAIN_NUMBER_PATTERN.test(trimmed)) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }

    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (typeof raw !== "string") return null;
      const normalized = raw.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      return null;
    }

    case "date": {
      if (typeof raw !== "string") return null;
      // An ISO datetime is accepted by taking its calendar day; anything else
      // must already be a calendar date.
      const candidate = raw.trim().slice(0, 10);
      return isCalendarDate(candidate) ? candidate : null;
    }

    case "list": {
      if (!Array.isArray(raw)) return null;
      const items = raw
        .filter(
          (item): item is string | number =>
            typeof item === "string" || typeof item === "number",
        )
        .map((item) => String(item).trim())
        .filter((item) => item !== "");
      return items;
    }

    default:
      return null;
  }
}

/** 0..1, clamped. Anything that is not a number is "no idea". */
function coerceConfidence(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

/**
 * The model's answer, reduced to the declared fields.
 *
 * Keys the workflow did not declare are dropped: the model is not allowed to
 * widen the schema, and an undeclared key would never be shown anywhere.
 */
export function coerceModelOutput(
  fields: INodeFilesField[],
  parsed: Record<string, unknown>,
): NodeFilesExtractedValues {
  const values: NodeFilesExtractedValues = {};
  for (const field of fields) {
    const entry = parsed[field.key];
    const source =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    values[field.key] = {
      value: coerceFieldValue(field.type, source.value),
      confidence: coerceConfidence(source.confidence),
    };
  }
  return values;
}

/**
 * A human's confirmed values, through the same door.
 *
 * Confidence is 1: a person looked at it. An undeclared key THROWS here rather
 * than being dropped — silently discarding what someone typed is how "I saved
 * it and it wasn't there" bugs are made.
 */
export function coerceReviewValues(
  fields: INodeFilesField[],
  input: Record<string, unknown>,
): NodeFilesExtractedValues {
  const declared = new Map(fields.map((field) => [field.key, field]));
  for (const key of Object.keys(input)) {
    if (!declared.has(key)) {
      throw new Error(`El campo "${key}" no existe en este flujo`);
    }
  }

  const values: NodeFilesExtractedValues = {};
  for (const field of fields) {
    values[field.key] = {
      value: coerceFieldValue(field.type, input[field.key]),
      confidence: 1,
    };
  }
  return values;
}

/** Labels of the required fields that came back empty. */
export function missingRequiredLabels(
  fields: INodeFilesField[],
  values: NodeFilesExtractedValues,
): string[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = values[field.key]?.value;
      return value === null || value === undefined;
    })
    .map((field) => field.label);
}
