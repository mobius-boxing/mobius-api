import {
  INodeFilesField,
  NODE_FILES_FIELD_TYPES,
  NodeFilesFieldType,
} from "../../../interfaces/node-files/node-files.interfaces";

/**
 * Shared input helpers for the node-files DTOs. Everything here THROWS in
 * Spanish: `inputValidator` only rejects empty objects, so a `build()` that
 * does not throw is validation theater (host rule).
 */

/** A key becomes a JSON property name and a Zod schema key — keep it boring. */
const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

/**
 * Upper bound on a workflow's schema. Not a database CHECK (host rule) — this
 * is the constraint. Every field costs output tokens on every single run, so an
 * accidental 500-field paste is a cost incident, not a validation nicety.
 */
export const NODE_FILES_MAX_FIELDS = 30;

export function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export function requiredText(
  value: unknown,
  max: number,
  label: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} es obligatorio`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new Error(`${label} no puede superar los ${max} caracteres`);
  }
  return trimmed;
}

export function optionalText(
  value: unknown,
  max: number,
  label: string,
): string | null | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new Error(`${label} debe ser texto`);
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    throw new Error(`${label} no puede superar los ${max} caracteres`);
  }
  return trimmed;
}

export function toBoolean(value: unknown, label: string): boolean | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${label} debe ser verdadero o falso`);
}

/**
 * The declared extraction schema, validated field by field.
 *
 * Duplicate keys are refused rather than deduplicated: a schema where two
 * fields silently collapse into one would extract half of what the user asked
 * for and say nothing.
 */
export function parseFields(value: unknown): INodeFilesField[] {
  if (!Array.isArray(value)) {
    throw new Error("Los campos deben ser una lista");
  }
  if (value.length === 0) {
    throw new Error("Definí al menos un campo a extraer");
  }
  if (value.length > NODE_FILES_MAX_FIELDS) {
    throw new Error(`Máximo ${NODE_FILES_MAX_FIELDS} campos por flujo`);
  }

  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`El campo ${index + 1} es inválido`);
    }
    const source = raw as Record<string, unknown>;

    const key = requiredText(source.key, 60, `La clave del campo ${index + 1}`);
    if (!FIELD_KEY_PATTERN.test(key)) {
      throw new Error(
        `Clave inválida "${key}": usá letras, números y guion bajo, empezando por una letra`,
      );
    }
    if (seen.has(key)) throw new Error(`Clave repetida: "${key}"`);
    seen.add(key);

    const type = source.type;
    if (
      typeof type !== "string" ||
      !NODE_FILES_FIELD_TYPES.includes(type as NodeFilesFieldType)
    ) {
      throw new Error(
        `Tipo inválido en "${key}": usá ${NODE_FILES_FIELD_TYPES.join(", ")}`,
      );
    }

    const label = requiredText(
      source.label,
      120,
      `El nombre del campo "${key}"`,
    );
    const description = optionalText(
      source.description,
      300,
      `La descripción del campo "${key}"`,
    );
    const required = toBoolean(source.required, `"Obligatorio" en "${key}"`);

    return {
      key,
      label,
      type: type as NodeFilesFieldType,
      description: description ?? null,
      required: required ?? false,
    };
  });
}
