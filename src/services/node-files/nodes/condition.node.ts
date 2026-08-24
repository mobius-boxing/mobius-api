import {
  NODE_FILES_CONDITION_OPS,
  NodeFilesConditionOp,
  NodeFilesFieldType,
} from "../../../interfaces/node-files/node-files.interfaces";
import {
  configInput,
  INodeRunContext,
  INodeRunResult,
  INodeType,
  INodeValidationContext,
  NodeConfigError,
  NodeExecutionError,
} from "./node-type";

/**
 * The condition node — structured, not an expression (brief D-2).
 *
 * `{ left: <declared field key>, op, right: <literal> }`, compared according to
 * the field's DECLARED type, not according to what the extraction happened to
 * return. Three inputs in the editor, no parser, no `eval`, and no evaluator
 * that can answer "false" for a reason nobody can see. The comparison rules are
 * checked twice: once when the definition is saved (so `gt` on a boolean is a
 * 400 with a sentence explaining it) and once at run time.
 *
 * Ops that do not apply to a type are refused at save time rather than
 * silently degraded to string comparison — `"9" > "10"` is true and that is
 * exactly the kind of quiet wrongness a branch gate must never have.
 */

export interface IConditionConfig {
  left: string;
  op: NodeFilesConditionOp;
  right: string | null;
}

/** Ops that need no right-hand side. */
const UNARY_OPS: NodeFilesConditionOp[] = ["isEmpty", "isNotEmpty"];

/** Ops that order two values, and therefore need an orderable type. */
const ORDERING_OPS: NodeFilesConditionOp[] = ["gt", "gte", "lt", "lte"];

const ORDERABLE_TYPES: NodeFilesFieldType[] = ["number", "currency", "date"];

const CONTAINABLE_TYPES: NodeFilesFieldType[] = ["string", "list"];

const OP_LABELS: Record<NodeFilesConditionOp, string> = {
  eq: "es igual a",
  neq: "es distinto de",
  gt: "es mayor que",
  gte: "es mayor o igual que",
  lt: "es menor que",
  lte: "es menor o igual que",
  contains: "contiene",
  isEmpty: "está vacío",
  isNotEmpty: "no está vacío",
};

const isUnary = (op: NodeFilesConditionOp): boolean => UNARY_OPS.includes(op);

/** A number for comparison, or `null` when the value cannot be one. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Epoch milliseconds for comparison, or `null` when the value is not a date. */
function toEpoch(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/** Emptiness, defined once: null, empty string, empty list. */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Evaluate one condition. `type` is the field's DECLARED type — the comparison
 * follows the schema the user wrote, not the shape of today's extraction.
 *
 * A missing value answers `false` for every ordering and equality op (except
 * `neq`, where "no value" genuinely is different from a literal), and the
 * emptiness ops are the way to ask about it deliberately.
 */
export function evaluateCondition(
  config: IConditionConfig,
  value: unknown,
  type: NodeFilesFieldType,
): boolean {
  switch (config.op) {
    case "isEmpty":
      return isEmptyValue(value);
    case "isNotEmpty":
      return !isEmptyValue(value);
    case "contains": {
      const needle = (config.right ?? "").toLowerCase();
      if (Array.isArray(value)) {
        return value.some(
          (entry) => String(entry).toLowerCase() === needle.trim(),
        );
      }
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(needle);
    }
    case "eq":
    case "neq": {
      const equal = valuesEqual(value, config.right, type);
      return config.op === "eq" ? equal : !equal;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const compared = compareValues(value, config.right, type);
      if (compared === null) return false;
      if (config.op === "gt") return compared > 0;
      if (config.op === "gte") return compared >= 0;
      if (config.op === "lt") return compared < 0;
      return compared <= 0;
    }
    default: {
      // Exhaustive by construction: a new operator that forgets a branch is a
      // compile error here, never a silent `false` at run time.
      const unreachable: never = config.op;
      throw new NodeExecutionError(
        `Operador no soportado: ${String(unreachable)}`,
      );
    }
  }
}

function valuesEqual(
  value: unknown,
  right: string | null,
  type: NodeFilesFieldType,
): boolean {
  if (isEmptyValue(value)) return right === null || right.trim() === "";
  switch (type) {
    case "number":
    case "currency": {
      const left = toNumber(value);
      const other = toNumber(right);
      return left !== null && other !== null && left === other;
    }
    case "date": {
      const left = toEpoch(value);
      const other = toEpoch(right);
      return left !== null && other !== null && left === other;
    }
    case "boolean": {
      const left = toBoolean(value);
      const other = toBoolean(right);
      return left !== null && other !== null && left === other;
    }
    case "list": {
      const left = Array.isArray(value) ? value.map(String) : [String(value)];
      return left.join(", ") === (right ?? "");
    }
    case "string":
      return String(value).trim() === (right ?? "").trim();
    default: {
      const unreachable: never = type;
      throw new NodeExecutionError(`Tipo no soportado: ${String(unreachable)}`);
    }
  }
}

/** -1 / 0 / 1, or `null` when either side is not comparable. */
function compareValues(
  value: unknown,
  right: string | null,
  type: NodeFilesFieldType,
): number | null {
  const [left, other] =
    type === "date"
      ? [toEpoch(value), toEpoch(right)]
      : [toNumber(value), toNumber(right)];
  if (left === null || other === null) return null;
  if (left === other) return 0;
  return left < other ? -1 : 1;
}

export const conditionNode: INodeType = {
  type: "condition",
  label: "Condición",
  description:
    "Compara un campo extraído con un valor y sigue la rama verdadera o falsa.",
  handles: ["true", "false"],
  acceptsInput: true,
  configSchema: [
    configInput({
      key: "left",
      label: "Campo",
      input: "fieldKey",
      required: true,
      help: "Uno de los campos declarados en el flujo.",
    }),
    configInput({
      key: "op",
      label: "Operador",
      input: "select",
      required: true,
      options: NODE_FILES_CONDITION_OPS.map((op) => ({
        value: op,
        label: OP_LABELS[op],
      })),
      defaultValue: "eq",
    }),
    configInput({
      key: "right",
      label: "Valor",
      input: "text",
      required: false,
      placeholder: "1000",
      help: '"Está vacío" y "no está vacío" no usan este valor.',
    }),
  ],

  validate(config: Record<string, unknown>, ctx: INodeValidationContext): void {
    const left = config.left;
    if (typeof left !== "string" || left.trim() === "") {
      throw new NodeConfigError("Elegí el campo a comparar");
    }
    const field = ctx.fields.find((entry) => entry.key === left.trim());
    if (!field) {
      throw new NodeConfigError(
        `El campo "${left}" no está declarado en el flujo`,
      );
    }

    const op = config.op;
    if (
      typeof op !== "string" ||
      !NODE_FILES_CONDITION_OPS.includes(op as NodeFilesConditionOp)
    ) {
      throw new NodeConfigError(
        `Operador inválido: usá ${NODE_FILES_CONDITION_OPS.join(", ")}`,
      );
    }
    const operator = op as NodeFilesConditionOp;

    if (
      ORDERING_OPS.includes(operator) &&
      !ORDERABLE_TYPES.includes(field.type)
    ) {
      throw new NodeConfigError(
        `"${OP_LABELS[operator]}" no se puede usar con un campo de tipo ${field.type}`,
      );
    }
    if (operator === "contains" && !CONTAINABLE_TYPES.includes(field.type)) {
      throw new NodeConfigError(
        `"contiene" solo se puede usar con campos de texto o lista`,
      );
    }

    const right = config.right;
    if (isUnary(operator)) return;
    if (typeof right !== "string" || right.trim() === "") {
      throw new NodeConfigError(
        `El operador "${OP_LABELS[operator]}" necesita un valor de comparación`,
      );
    }
    // Typed against the DECLARED type, at save time: a date compared with
    // "mañana" is a 400 now instead of a branch that never fires later.
    if (
      (field.type === "number" || field.type === "currency") &&
      toNumber(right) === null
    ) {
      throw new NodeConfigError(`"${right}" no es un número válido`);
    }
    if (field.type === "date" && toEpoch(right) === null) {
      throw new NodeConfigError(
        `"${right}" no es una fecha válida (usá AAAA-MM-DD)`,
      );
    }
    if (field.type === "boolean" && toBoolean(right) === null) {
      throw new NodeConfigError(`"${right}" debe ser verdadero o falso`);
    }
  },

  credentialRefs(): string[] {
    return [];
  },

  run(
    ctx: INodeRunContext,
    config: Record<string, unknown>,
  ): Promise<INodeRunResult> {
    const parsed: IConditionConfig = {
      left: String(config.left ?? "").trim(),
      op: config.op as NodeFilesConditionOp,
      right: typeof config.right === "string" ? config.right : null,
    };
    const declaredType = (ctx.fieldTypes[parsed.left] ??
      "string") as NodeFilesFieldType;
    const value = ctx.fields[parsed.left] ?? null;
    const result = evaluateCondition(parsed, value, declaredType);

    ctx.log(
      `${parsed.left} (${JSON.stringify(value)}) ${OP_LABELS[parsed.op]} ` +
        `${JSON.stringify(parsed.right)} → ${String(result)}`,
    );

    return Promise.resolve({
      output: { result, left: value, op: parsed.op, right: parsed.right },
      handle: result ? "true" : "false",
    });
  },
};
