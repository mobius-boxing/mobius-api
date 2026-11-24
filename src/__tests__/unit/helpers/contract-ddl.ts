/**
 * The contract-DDL detector shared by the tenant and core migration tests: a
 * migration that drops, renames, retypes or newly NOT-NULLs something must name
 * the earlier expand migration it contracts (`// contract: <name>`).
 */
export type MigrationSource = { name: string; source: string };

/** Keywords that follow DROP / ALTER without naming a column. */
const NOT_A_COLUMN =
  "(?:TABLE|INDEX|CONSTRAINT|TRIGGER|NOT|DEFAULT|IDENTITY|EXPRESSION)\\b";

const CONTRACT_DDL: readonly { label: string; pattern: RegExp }[] = [
  // `COLUMN` is optional in `ALTER TABLE … DROP [COLUMN] [IF EXISTS] name`.
  {
    label: "DROP [COLUMN] <column>",
    pattern: new RegExp(
      `\\bDROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(?!${NOT_A_COLUMN})"?[A-Za-z_]`,
      "i",
    ),
  },
  { label: "RENAME", pattern: /\bRENAME\b/i },
  {
    label: "ALTER COLUMN … TYPE",
    pattern: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i,
  },
  // …and in `ALTER [COLUMN] name [SET DATA] TYPE`.
  {
    label: "ALTER [COLUMN] <column> [SET DATA] TYPE",
    pattern:
      /\bALTER\s+(?:COLUMN\s+)?(?!TABLE\b)"?[A-Za-z_][A-Za-z0-9_]*"?\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  },
  { label: "SET NOT NULL", pattern: /\bSET\s+NOT\s+NULL\b/i },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  // The knex schema builder spells the same operations without SQL keywords.
  { label: "dropColumn", pattern: /\.dropColumns?\s*\(/ },
  {
    label: "renameColumn/renameTable",
    pattern: /\.rename(?:Column|Table)\s*\(/,
  },
  { label: "dropTable", pattern: /\.dropTable(?:IfExists)?\s*\(/ },
  { label: "alter()", pattern: /\.alter\s*\(/ },
  { label: "dropNullable", pattern: /\.dropNullable\s*\(/ },
];

const CONTRACT_MARKER = /\/\/\s*contract:\s*(\S+)/;

const withoutExtension = (name: string): string => name.replace(/\.ts$/, "");

// The DDL patterns are case-insensitive and `DROP <name>` reads like English,
// so prose in a JS or SQL comment ("drop legacy rows later") would flag an
// expand-only migration — comments are stripped before matching. The marker
// is read from the unstripped source.
//
// Quote-aware, with two different quote roles rather than one: a `'…'` or
// `"…"` region is an opaque VALUE (a JS string, or one complete SQL literal)
// — nothing inside it, comment marker or nested quote, is ever examined,
// so a literal like "a//b" or '--' sitting next to real DDL cannot comment
// the DDL out. A backtick region is transparent CODE — it is where a
// migration's raw, possibly multi-line SQL lives (as pg_dump emits it), so a
// genuine `--` comment inside one is still stripped, and a nested `'…'`/`"…"`
// SQL literal inside it is still opaque. A doubled quote (the SQL `''`
// escape, which also covers a doubled JS quote) or a backslash-escaped one
// keeps a string open. This is not a real lexer — nested template `${…}`
// interpolation is not re-entered as code — but every fixture here, and
// every real migration, keeps its SQL as one unbroken string.
type Quote = "'" | '"' | "`";
const isQuote = (ch: string | undefined): ch is Quote =>
  ch === "'" || ch === '"' || ch === "`";

function scanRegion(
  source: string,
  start: number,
  terminator: Quote | null,
): { text: string; next: number } {
  // Only a single/double quote is opaque to comments and nested quotes; a
  // backtick keeps scanning as code (see the note above the caller).
  const opaque = terminator === "'" || terminator === '"';
  let out = "";
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (terminator !== null && ch === terminator) {
      if (source[i + 1] === terminator) {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      return { text: out + ch, next: i + 1 };
    }
    if (ch === "\\" && terminator !== null) {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (!opaque && isQuote(ch)) {
      const inner = scanRegion(source, i + 1, ch);
      out += ch + inner.text;
      i = inner.next;
      continue;
    }
    if (!opaque) {
      const two = source.slice(i, i + 2);
      if (two === "/*") {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (two === "//" || two === "--") {
        const end = source.indexOf("\n", i);
        i = end === -1 ? source.length : end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return { text: out, next: i };
}

const withoutComments = (source: string): string =>
  scanRegion(source, 0, null).text;

export function contractViolations(
  files: readonly MigrationSource[],
  options: {
    set: "tenant" | "core";
    skip?: string;
    /** Ignore files whose 14-digit timestamp prefix is not newer than this. */
    after?: string;
  },
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.name === options.skip) continue;
    if (options.after && file.name.slice(0, 14) <= options.after) continue;
    const code = withoutComments(file.source);
    const found = CONTRACT_DDL.filter(({ pattern }) => pattern.test(code)).map(
      ({ label }) => label,
    );
    if (found.length === 0) continue;
    const marker = CONTRACT_MARKER.exec(file.source)?.[1];
    const expand = files.find(
      (candidate) =>
        marker !== undefined &&
        withoutExtension(candidate.name) === withoutExtension(marker),
    );
    if (expand === undefined || expand.name >= file.name) {
      violations.push(
        `${file.name}: ${found.join(", ")} without a "// contract: <expand-migration>" marker naming an earlier ${options.set} migration`,
      );
    }
  }
  return violations;
}
