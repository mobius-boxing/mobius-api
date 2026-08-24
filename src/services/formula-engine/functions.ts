/**
 * NCalc 1.3.8.0 function set — module 08, `formula-engine.md` §2.
 *
 * PARITY (L-010): exactly these 20 functions, case-SENSITIVE, exact arity,
 * no aliases. `Ln` does not exist. `Round` is 2-arg banker's rounding.
 * `Truncate` rounds toward zero. `Abs` returns a *decimal*-kind value (the
 * reason `Abs(-7) + Sqrt(16)` throws → silent 0). Any deviation silently
 * produces wrong boxes — every quirk here is pinned by a named golden case.
 */

/**
 * NCalc value kinds. `int` = integer literals, `double` = bound parameters,
 * decimal literals and most function results, `decimal` = the result of
 * `Abs` only, `bool` = comparisons/logicals. The numeric payload is always
 * an IEEE-754 JS number (L-010) — the kind only drives coercion rules.
 */
export type EngineValue =
  | { kind: "int" | "double" | "decimal"; value: number }
  | { kind: "bool"; value: boolean };

export const intValue = (value: number): EngineValue => ({
  kind: "int",
  value,
});
export const doubleValue = (value: number): EngineValue => ({
  kind: "double",
  value,
});
export const decimalValue = (value: number): EngineValue => ({
  kind: "decimal",
  value,
});
export const boolValue = (value: boolean): EngineValue => ({
  kind: "bool",
  value,
});

/** .NET `Convert.ToDouble` over the supported kinds (bool → 1/0). */
export function toDouble(v: EngineValue): number {
  if (v.kind === "bool") return v.value ? 1 : 0;
  return v.value;
}

/** .NET `Convert.ToBoolean`: numbers are true when non-zero. */
export function toBool(v: EngineValue): boolean {
  if (v.kind === "bool") return v.value;
  if (Number.isNaN(v.value)) {
    throw new Error("Cannot convert NaN to Boolean");
  }
  return v.value !== 0;
}

/**
 * .NET `Math.Round(value, digits, MidpointRounding.ToEven)` — banker's
 * rounding (NCalc `Round` rule; `formula-engine.md` §2). Exact halves go to
 * the even neighbour: Round(2.5,0)=2, Round(0.5,0)=0, Round(3.5,0)=4.
 */
export function bankersRound(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const scale = Math.pow(10, digits);
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) {
    rounded = floor + 1;
  } else if (diff < 0.5) {
    rounded = floor;
  } else {
    // Exact half: choose the even neighbour (MidpointRounding.ToEven).
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }
  return rounded / scale;
}

/**
 * .NET `Math.Truncate` — drops the fractional part TOWARD ZERO (NCalc
 * `Truncate` rule; `formula-engine.md` §2): Truncate(209.76)=209,
 * Truncate(-1.9)=-1. NOT `Math.floor`, which differs for negatives.
 */
export function truncateTowardZero(value: number): number {
  return Math.trunc(value);
}

/**
 * .NET `Convert.ToUInt16` — bitwise operands (`& | ^`) rule
 * (`formula-engine.md` §2): round half-to-even to an integer, range
 * 0..65535; negative/out-of-range/non-finite throws (→ silent 0 upstream).
 */
export function toUInt16(v: EngineValue): number {
  if (v.kind === "bool") return v.value ? 1 : 0;
  const rounded = bankersRound(v.value, 0);
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 65535) {
    throw new Error("Value was either too large or too small for a UInt16");
  }
  return rounded;
}

/** .NET `Convert.ToInt16` (Round's digits argument): half-to-even + range. */
function toInt16(v: EngineValue): number {
  if (v.kind === "bool") return v.value ? 1 : 0;
  const rounded = bankersRound(v.value, 0);
  if (!Number.isFinite(rounded) || rounded < -32768 || rounded > 32767) {
    throw new Error("Value was either too large or too small for an Int16");
  }
  return rounded;
}

type EngineFunction = {
  /** Exact argument count — any other arity throws (→ silent 0). */
  arity: number;
  apply(args: EngineValue[]): EngineValue;
};

/**
 * The exactly-20 NCalc 1.3.8.0 functions, case-sensitive. `if`/`in` are
 * lowercase grammar keywords handled by the parser, not entries here — so
 * `If(...)`/`In(...)` fall through to "unknown function" and throw.
 */
export const FUNCTION_TABLE: Readonly<Record<string, EngineFunction>> = {
  // NCalc `Abs` = Math.Abs(Convert.ToDecimal(x)) → DECIMAL result kind
  // (`formula-engine.md` §2: decimal ⊗ double arithmetic throws → 0).
  Abs: { arity: 1, apply: ([x]) => decimalValue(Math.abs(toDouble(x))) },
  Acos: { arity: 1, apply: ([x]) => doubleValue(Math.acos(toDouble(x))) },
  Asin: { arity: 1, apply: ([x]) => doubleValue(Math.asin(toDouble(x))) },
  Atan: { arity: 1, apply: ([x]) => doubleValue(Math.atan(toDouble(x))) },
  Ceiling: { arity: 1, apply: ([x]) => doubleValue(Math.ceil(toDouble(x))) },
  Cos: { arity: 1, apply: ([x]) => doubleValue(Math.cos(toDouble(x))) },
  Exp: { arity: 1, apply: ([x]) => doubleValue(Math.exp(toDouble(x))) },
  Floor: { arity: 1, apply: ([x]) => doubleValue(Math.floor(toDouble(x))) },
  // .NET Math.IEEERemainder(x, y) = x - (y * Math.Round(x / y)) with
  // half-to-even rounding.
  IEEERemainder: {
    arity: 2,
    apply: ([x, y]) => {
      const a = toDouble(x);
      const b = toDouble(y);
      return doubleValue(a - b * bankersRound(a / b, 0));
    },
  },
  // NCalc `Log` is 2-arg ONLY (`Log(x, base)`); single-arg throws → 0.
  Log: {
    arity: 2,
    apply: ([x, base]) =>
      doubleValue(Math.log(toDouble(x)) / Math.log(toDouble(base))),
  },
  Log10: { arity: 1, apply: ([x]) => doubleValue(Math.log10(toDouble(x))) },
  Max: {
    arity: 2,
    apply: ([a, b]) => doubleValue(Math.max(toDouble(a), toDouble(b))),
  },
  Min: {
    arity: 2,
    apply: ([a, b]) => doubleValue(Math.min(toDouble(a), toDouble(b))),
  },
  Pow: {
    arity: 2,
    apply: ([x, y]) => doubleValue(Math.pow(toDouble(x), toDouble(y))),
  },
  // NCalc `Round` is 2-arg ONLY, MidpointRounding.ToEven (banker's).
  // Single-arg `Round(x)` has no overload: arity check throws → silent 0.
  Round: {
    arity: 2,
    apply: ([x, digits]) =>
      doubleValue(bankersRound(toDouble(x), toInt16(digits))),
  },
  // .NET Math.Sign returns an int.
  Sign: { arity: 1, apply: ([x]) => intValue(Math.sign(toDouble(x))) },
  Sin: { arity: 1, apply: ([x]) => doubleValue(Math.sin(toDouble(x))) },
  Sqrt: { arity: 1, apply: ([x]) => doubleValue(Math.sqrt(toDouble(x))) },
  Tan: { arity: 1, apply: ([x]) => doubleValue(Math.tan(toDouble(x))) },
  Truncate: {
    arity: 1,
    apply: ([x]) => doubleValue(truncateTowardZero(toDouble(x))),
  },
};

export type FormulaFunctionReference = {
  name: string;
  signature: string;
  description: string;
};

/** Reference metadata for the "Campos y funciones" popup (display data, es). */
export const FORMULA_FUNCTIONS: ReadonlyArray<FormulaFunctionReference> =
  Object.freeze([
    { name: "Abs", signature: "Abs(x)", description: "Valor absoluto" },
    { name: "Acos", signature: "Acos(x)", description: "Arcocoseno (rad)" },
    { name: "Asin", signature: "Asin(x)", description: "Arcoseno (rad)" },
    { name: "Atan", signature: "Atan(x)", description: "Arcotangente (rad)" },
    {
      name: "Ceiling",
      signature: "Ceiling(x)",
      description: "Redondea hacia arriba al entero siguiente",
    },
    { name: "Cos", signature: "Cos(x)", description: "Coseno (rad)" },
    { name: "Exp", signature: "Exp(x)", description: "e elevado a x" },
    {
      name: "Floor",
      signature: "Floor(x)",
      description: "Redondea hacia abajo al entero anterior",
    },
    {
      name: "IEEERemainder",
      signature: "IEEERemainder(x, y)",
      description: "Resto IEEE-754 de x/y",
    },
    {
      name: "Log",
      signature: "Log(x, base)",
      description: "Logaritmo de x en la base indicada (2 argumentos)",
    },
    {
      name: "Log10",
      signature: "Log10(x)",
      description: "Logaritmo en base 10",
    },
    { name: "Max", signature: "Max(a, b)", description: "Máximo de a y b" },
    { name: "Min", signature: "Min(a, b)", description: "Mínimo de a y b" },
    { name: "Pow", signature: "Pow(x, y)", description: "x elevado a y" },
    {
      name: "Round",
      signature: "Round(x, n)",
      description:
        "Redondeo bancario a n decimales (2 argumentos obligatorios)",
    },
    {
      name: "Sign",
      signature: "Sign(x)",
      description: "Signo de x (-1, 0 o 1)",
    },
    { name: "Sin", signature: "Sin(x)", description: "Seno (rad)" },
    { name: "Sqrt", signature: "Sqrt(x)", description: "Raíz cuadrada" },
    { name: "Tan", signature: "Tan(x)", description: "Tangente (rad)" },
    {
      name: "Truncate",
      signature: "Truncate(x)",
      description: "Elimina los decimales (hacia cero)",
    },
  ]);

export type FormulaOperatorReference = {
  symbol: string;
  description: string;
};

/** Operator reference for the popup (display data, es). `^` is XOR — parity. */
export const FORMULA_OPERATORS: ReadonlyArray<FormulaOperatorReference> =
  Object.freeze([
    { symbol: "+ - * / %", description: "Aritmética (÷ siempre decimal)" },
    { symbol: "( )", description: "Paréntesis" },
    {
      symbol: "^",
      description: "XOR bit a bit — NO es potencia; use Pow(x, y)",
    },
    { symbol: "& |", description: "AND / OR bit a bit" },
    { symbol: "== != < > <= >=", description: "Comparación" },
    { symbol: "&& || !", description: "Lógicos (también and / or / not)" },
    {
      symbol: "if(cond, a, b)",
      description: "Condicional: a si cond es verdadera, si no b (minúscula)",
    },
    {
      symbol: "in(x, a, b, …)",
      description: "Pertenencia: x es alguno de los valores (minúscula)",
    },
    {
      symbol: "[Nombre]",
      description:
        "Parámetro entre corchetes (obligatorio si el nombre tiene espacios)",
    },
  ]);
