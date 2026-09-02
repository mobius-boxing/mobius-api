/**
 * RFC 4180 CSV serialisation — the whole of it, in one file, with no dependency.
 *
 * There is no CSV helper anywhere else in the repo and there may not be a new
 * npm package: the API's Docker build sits close to node:22-alpine's ~471 MB
 * ceiling, and a dependency with a large type surface OOMs the deploy while
 * building perfectly well on a laptop. Twenty lines of quoting is the cheaper
 * side of that trade.
 *
 * Deliberately pure: no knex, no registry, no express, no I/O. The one caller
 * today is `GET /audit-logs/export.csv`, which streams the result through
 * `res.send` — i.e. **outside** `sanitizeResponse`. Whatever a caller puts in a
 * cell reaches the client verbatim; this module quotes it, it does not vet it.
 */

/** Everything a cell may hold. Anything else is the caller's to stringify. */
export type CsvValue = string | number | boolean | null | undefined;

/**
 * The UTF-8 byte-order mark, emitted at the top of every {@link toCsv} result.
 *
 * Excel — which is what a Spanish-language product's users open a `.csv` with —
 * decodes a BOM-less file as the system's ANSI codepage, so "Modificación"
 * arrives as "ModificaciÃ³n" and every accented description in the export is
 * mangled. The BOM costs three bytes and is ignored by every other reader we
 * care about (LibreOffice, `csv` in Python, `papaparse`).
 */
export const CSV_BOM = "\uFEFF";

/** RFC 4180 §2.1: records are separated by CRLF, not by the platform's newline. */
const CRLF = "\r\n";

/** A field must be quoted if it contains a comma, a quote, CR or LF (§2.6-2.7). */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One field, quoted only when it has to be (§2.5-2.7).
 *
 * `null`/`undefined` become an empty field — a CSV has no null, and `"null"` in
 * a spreadsheet cell is a lie. Numbers and booleans are stringified with
 * `String()`; a caller that wants a locale-formatted number formats it first.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  if (!NEEDS_QUOTING.test(text)) return text;
  // §2.7: a double quote inside a quoted field is escaped by doubling it.
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A table of rows into one CSV document: BOM, then CRLF-separated records, then
 * a trailing CRLF (§2.1 allows the last record to end with one; text files that
 * end mid-line trip line-oriented tools).
 *
 * The caller owns the header row — it is simply `rows[0]`. This function has no
 * opinion about columns, so the export's column set lives with the export.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  if (rows.length === 0) return CSV_BOM;
  const body = rows.map((row) => row.map(csvCell).join(",")).join(CRLF);
  return `${CSV_BOM}${body}${CRLF}`;
}
