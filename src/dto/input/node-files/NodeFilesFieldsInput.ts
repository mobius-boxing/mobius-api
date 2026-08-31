import {
  INodeFilesField,
  NODE_FILES_FIELD_TYPES,
  NodeFilesFieldType,
} from "../../../interfaces/node-files/node-files.interfaces";

import {
  optionalText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";

/**
 * node-files-specific input parsing. The generic text/boolean helpers this file
 * used to own now live in `../shared/fieldValidators` (identical signatures and
 * identical Spanish messages) so every DTO in the codebase validates through
 * one implementation; they are re-exported here for the existing importers.
 */
export {
  emptyToUndefined,
  optionalText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";

/** A key becomes a JSON property name and a Zod schema key — keep it boring. */
const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

/**
 * Upper bound on a workflow's schema. Not a database CHECK (host rule) — this
 * is the constraint. Every field costs output tokens on every single run, so an
 * accidental 500-field paste is a cost incident, not a validation nicety.
 */
export const NODE_FILES_MAX_FIELDS = 30;

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
