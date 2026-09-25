/**
 * .NET rounding primitives the Pandora/Procusto formulas depend on (L-010, D-6).
 * Each C# call site keeps its own primitive; never substitute Math.round.
 */

/** C# `(int)x` — truncation toward zero. */
export const castInt = (x: number): number => Math.trunc(x);

/** C# `(int)(x + 0.5)` — half-up for x ≥ 0 (Item.PlanchasProgramadas, Golpes). */
export const roundHalfUpInt = (x: number): number => Math.trunc(x + 0.5);

/** .NET `Math.Round(x, 0)` — banker's rounding (ProgramarCorrugado.cs:198). */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Solver.cs:430 `Math.Truncate(x / step + 0.5) * step`. */
export const roundToStep = (x: number, step: number): number =>
  Math.trunc(x / step + 0.5) * step;
