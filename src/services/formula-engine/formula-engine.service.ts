/**
 * Formula engine public surface — module 08, `formula-engine.md` §5/§6.
 *
 * `evaluate` mirrors `Formula.Evaluar`: null/empty/whitespace → 0; ANY error
 * (parse, unknown name, arity, type mixing) → silent 0, no throw, no log.
 * Non-finite results (`±Infinity`, `NaN`) are returned as computed — never
 * guarded (parity, L-010).
 *
 * `validate` mirrors `Formula.Testear`: evaluates against `TESTEAR_FIXTURE`
 * and surfaces the raw error message at design time.
 *
 * Pipe-`|` lists (trazadores) split at the FIELD level, before evaluation —
 * a raw pipe string handed to `evaluate` would parse `|` as bitwise OR and
 * corrupt the score lines. Empty segments follow the empty-formula rule.
 */
import { Scope, TESTEAR_FIXTURE } from "./parameters";
import { parseAndEvaluate } from "./parser";

export type ValidationResult = {
  ok: boolean;
  error?: string;
  value?: number;
};

export type SegmentValidationResult = {
  index: number;
  ok: boolean;
  error?: string;
  value?: number;
};

export type ListValidationResult = {
  ok: boolean;
  segments: SegmentValidationResult[];
};

/** `Formula.Evaluar`: silent 0 on any error; empty → 0; ÷0 → Infinity. */
export function evaluate(
  formula: string | null | undefined,
  scope: Scope,
): number {
  if (formula == null || formula.trim().length === 0) return 0;
  try {
    return parseAndEvaluate(formula, scope);
  } catch {
    // Silent-0 (Formula.cs L50–58): malformed formula, unknown variable or
    // type error all yield 0 with no signal — errors only surface via
    // validate() at design time.
    return 0;
  }
}

/** Split a pipe-`|` list and evaluate each trimmed segment independently. */
export function evaluateList(
  text: string | null | undefined,
  scope: Scope,
): number[] {
  if (text == null || text.length === 0) return [];
  return text.split("|").map((segment) => evaluate(segment.trim(), scope));
}

/** `Formula.Testear`: empty is valid; errors carry the raw engine message. */
export function validate(formula: string | null | undefined): ValidationResult {
  if (formula == null || formula.trim().length === 0) return { ok: true };
  try {
    const value = parseAndEvaluate(formula, TESTEAR_FIXTURE);
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Per-segment validation of a pipe-`|` list; empty segments are valid. */
export function validateList(
  text: string | null | undefined,
): ListValidationResult {
  if (text == null || text.length === 0) return { ok: true, segments: [] };
  const segments = text.split("|").map(
    (segment, index): SegmentValidationResult => ({
      index,
      ...validate(segment.trim()),
    }),
  );
  return { ok: segments.every((segment) => segment.ok), segments };
}
