/**
 * The CSV export (audit P3, track T6; AC-8) — the quoting and the columns.
 *
 * Two things are being protected here, and only one of them is about CSV.
 *
 * 1. **RFC 4180 quoting.** A cell holding a comma, a quote or a newline is the
 *    difference between a file Excel opens and a file that silently shifts
 *    every column to the right of an `entityDescription` containing "Caja
 *    500x300, marrón". There is no library doing this for us — a new
 *    dependency OOMs the Docker build — so the rules are asserted, not assumed.
 *
 * 2. **No numeric id ever reaches the file.** Every other endpoint answers
 *    through `res.json`, where `sanitizeResponse` strips `id` and every numeric
 *    `*Id` on the way out. The export answers through `res.send` and has no
 *    such net (§0.3, last row): the cells must be id-free *by construction*.
 *    `auditCsvTable` is therefore built from `AuditRowView`, whose type has no
 *    numeric id in it, and the test below inspects both the header row and the
 *    data cells — a column added with an empty value would slip past a
 *    value-only check, and a column named in Spanish would slip past a
 *    header-only one.
 *
 * Mutation-checked per L-018: dropping the `""` -> `""""` replacement in
 * `csvCell` flips "doubles an embedded double quote" red, and adding a
 * `{ header: "userId", cell: () => 42 }` column to `AUDIT_CSV_COLUMNS` flips
 * "emits no numeric id column" red on both of its assertions.
 */
import { describe, expect, it } from "@jest/globals";
import { auditCsvTable } from "../../../controllers/audit-log/audit-log.controller";
import { AuditRowView } from "../../../interfaces/audit-log/audit-log.interfaces";
import { CSV_BOM, csvCell, toCsv } from "../../../utils/csv";

const CRLF = "\r\n";

/** A realistic ledger row as the presenter hands it over. */
const view = (overrides: Partial<AuditRowView> = {}): AuditRowView => ({
  uuid: "aaaaaaaa-1111-4111-8111-000000000001",
  occurredAt: "2026-09-02T14:03:11.482Z",
  entityName: "parts",
  entityUuid: "bbbbbbbb-2222-4222-8222-000000000002",
  entityCode: "P-1042",
  entityDescription: "Caja 500x300, marrón",
  operation: "Modificacion",
  action: "parts.update",
  source: "api",
  transactionRef: "884213",
  requestId: "cccccccc-3333-4333-8333-000000000003",
  rootEntity: null,
  rootUuid: null,
  actor: {
    username: "ana@acme.com",
    role: "admin",
    isSupport: false,
    attributed: true,
  },
  changedKeys: ["description", "width", "height"],
  ...overrides,
});

/** The header row of the export, as `auditCsvTable` builds it. */
const headers = (): string[] => auditCsvTable([])[0] as string[];

/** Every data row of the export for `views`, header excluded. */
const dataRows = (views: AuditRowView[]): unknown[][] =>
  auditCsvTable(views).slice(1);

/** The file as a client receives it, split into records. */
const lines = (csv: string): string[] => {
  expect(csv.endsWith(CRLF)).toBe(true);
  return csv.slice(CSV_BOM.length, -CRLF.length).split(CRLF);
};

describe("csvCell — RFC 4180 field quoting", () => {
  it("leaves an ordinary value unquoted", () => {
    expect(csvCell("parts")).toBe("parts");
    expect(csvCell("2026-09-02T14:03:11.482Z")).toBe(
      "2026-09-02T14:03:11.482Z",
    );
  });

  it("quotes a value containing a comma", () => {
    expect(csvCell("Caja 500x300, marrón")).toBe('"Caja 500x300, marrón"');
  });

  it("doubles an embedded double quote and quotes the field", () => {
    expect(csvCell('Perfil "L" reforzado')).toBe('"Perfil ""L"" reforzado"');
    // A field that is nothing but a quote is the degenerate case of the same
    // rule: two quotes of content inside two quotes of delimiter.
    expect(csvCell('"')).toBe('""""');
  });

  it("quotes newlines without escaping them, so the value survives", () => {
    expect(csvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(csvCell("línea 1\r\nlínea 2")).toBe('"línea 1\r\nlínea 2"');
    expect(csvCell("solo cr\rlínea 2")).toBe('"solo cr\rlínea 2"');
  });

  it("writes null and undefined as an empty field, never as text", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("stringifies numbers and booleans, including the falsy ones", () => {
    expect(csvCell(0)).toBe("0");
    expect(csvCell(884213)).toBe("884213");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(true)).toBe("true");
  });

  it("passes non-ASCII through verbatim — the BOM is what makes it readable", () => {
    expect(csvCell("Modificación de artículo — ñandú")).toBe(
      "Modificación de artículo — ñandú",
    );
  });
});

describe("toCsv — the document", () => {
  it("starts with a UTF-8 BOM so Excel reads the accents", () => {
    // Deliberate: Excel decodes a BOM-less file as the system codepage and
    // "Modificación" arrives as "ModificaciÃ³n". This is a Spanish-language
    // product; three bytes buy every accented description in the export.
    const csv = toCsv([["Operación"], ["Modificación"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}Operación${CRLF}Modificación${CRLF}`);
  });

  it("separates records with CRLF and terminates the last one", () => {
    expect(toCsv([["a", "b"], ["c"]])).toBe(`${CSV_BOM}a,b${CRLF}c${CRLF}`);
  });

  it("emits the BOM alone for an empty table", () => {
    expect(toCsv([])).toBe(CSV_BOM);
  });

  it("keeps a record on one line when a cell holds a newline", () => {
    const csv = toCsv([
      ["nota", "autor"],
      ["dos\r\nrenglones", "ana"],
    ]);
    // Three CRLFs in the file: one inside the quoted cell, one ending each
    // record. Splitting naively is the caller's problem, not the writer's —
    // what matters is that the quotes are there to make it parseable.
    expect(csv).toBe(
      `${CSV_BOM}nota,autor${CRLF}"dos${CRLF}renglones",ana${CRLF}`,
    );
  });
});

describe("auditCsvTable — the export's columns", () => {
  it("emits a header row and exactly one row per ledger entry", () => {
    const table = auditCsvTable([view(), view({ uuid: "other" })]);
    expect(table).toHaveLength(3);
    expect(table[1]).toHaveLength(headers().length);
    expect(headers()).toContain("Fecha");
  });

  /**
   * The assertion this file exists for. `res.send` bypasses `sanitizeResponse`,
   * so nothing downstream will remove an id that is written here.
   */
  it("emits no numeric id column for a realistic row set", () => {
    const forbidden = new Set([
      "id",
      "userid",
      "companyid",
      "entityid",
      "actorcompanyid",
      "entitylegacyid",
      "legacyid",
    ]);

    for (const header of headers()) {
      expect(forbidden.has(header.toLowerCase())).toBe(false);
      // Any bare `somethingId` identifier as a column name, whether or not it
      // is one of the seven known ones.
      expect(header).not.toMatch(/^[A-Za-z]*[Ii]d$/);
    }

    // `transactionRef` is the one legitimately all-digit cell (it is
    // `String(txId)`, a correlation handle, not an internal id). Every other
    // cell holding a bare integer is an id that escaped.
    const refColumn = headers().indexOf("Transacción");
    expect(refColumn).toBeGreaterThanOrEqual(0);

    const rows = dataRows([
      view(),
      view({
        actor: {
          username: null,
          role: null,
          isSupport: true,
          attributed: false,
        },
        entityCode: null,
        entityDescription: null,
        action: null,
        requestId: null,
        rootEntity: "production_routes",
        rootUuid: "dddddddd-4444-4444-8444-000000000004",
        changedKeys: [],
      }),
    ]);

    for (const row of rows) {
      row.forEach((cell, column) => {
        if (column === refColumn) return;
        expect(typeof cell === "number").toBe(false);
        expect(String(cell ?? "")).not.toMatch(/^\d+$/);
      });
    }
  });

  it("renders changedKeys as one comma-joined cell, quoted in the file", () => {
    const csv = toCsv(auditCsvTable([view()]));
    expect(lines(csv)[1]).toContain('"description, width, height"');
  });

  it("names the unattributed actor instead of leaving the cell blank", () => {
    const [row] = dataRows([
      view({
        actor: {
          username: null,
          role: null,
          isSupport: false,
          attributed: false,
        },
      }),
    ]);
    const user = headers().indexOf("Usuario");
    expect(row[user]).toBe("Sin atribuir");
  });

  it("survives a description carrying both a comma and a quote", () => {
    const csv = toCsv([
      auditCsvTable([])[0],
      auditCsvTable([
        view({ entityDescription: 'Caja 500x300, tipo "americana"' }),
      ])[1],
    ]);
    expect(lines(csv)[1]).toContain('"Caja 500x300, tipo ""americana"""');
    // One record on one line: the quoting kept the comma out of the delimiters.
    expect(lines(csv)).toHaveLength(2);
  });
});
