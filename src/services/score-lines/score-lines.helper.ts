/**
 * Score lines (Trazadores) helpers — specs/parts/07-score-lines.md.
 *
 * Storage is VERBATIM text (semicolon-separated numbers, European decimal
 * commas and spaces allowed) — exactly what Procusto persists. All
 * interpretation lives HERE and nowhere else.
 *
 * QA-VERIFY(Q-S1): whether the values are ABSOLUTE positions from the sheet
 * edge or GAP distances between consecutive scores is unverified on the live
 * app. Per the decompile-derived reading (07-score-lines.md: Modelo formulas
 * like "[Aleta inferior] | [Aleta inferior]+[Largo] | ..." produce cumulative
 * positions), the default interpretation is ABSOLUTE positions; the
 * `symmetricScoreLines` ("señalado a señalado") flag switches the *consumer*
 * to mark-to-mark gaps without changing storage. If QA refutes this, only
 * `interpretScoreLines` changes — storage and parsing stay put.
 */

export const SCORE_LINES_PATTERN = /^[0-9.,; ]*$/;

/**
 * Parse the verbatim text into numbers (comma decimals normalized — ALL
 * commas, not just the first). Tokens that don't parse to a finite
 * NON-NEGATIVE number are dropped, matching the input mask (which admits no
 * '-'): parser and validator agree that negatives are invalid.
 */
export function parseScoreLines(s: string | null | undefined): number[] {
  if (!s?.trim()) return [];
  return s
    .split(";")
    .map((t) => t.trim().replace(/,/g, "."))
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** Serialize numbers back to the Procusto storage format ("; "-joined). */
export function formatScoreLines(values: number[]): string {
  return values.join("; ");
}

/** True when the raw text only contains the characters Procusto's mask allows. */
export function isValidScoreLinesText(s: string | null | undefined): boolean {
  if (s == null || s === "") return true;
  return SCORE_LINES_PATTERN.test(s);
}

/**
 * Sum of the score spans. Under the default ABSOLUTE interpretation the last
 * value is the total span; under gaps it is the sum. Used only for the
 * non-blocking "does it match the sheet dimension" warning (07 §Validation —
 * Procusto silently saves inconsistent sets; we warn, never block).
 */
// QA-VERIFY(Q-S1)
export function interpretScoreLines(
  raw: string | null | undefined,
  symmetric: boolean,
): { positions: number[]; totalSpan: number | null } {
  const values = parseScoreLines(raw);
  if (!values.length) return { positions: [], totalSpan: null };
  if (symmetric) {
    // Mark-to-mark: values are gaps; positions are the running sum.
    const positions: number[] = [];
    let acc = 0;
    for (const v of values) {
      acc += v;
      positions.push(acc);
    }
    return { positions, totalSpan: acc };
  }
  // Default: values are absolute positions; span = last value.
  return { positions: values, totalSpan: values[values.length - 1] };
}
