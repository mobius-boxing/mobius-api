/**
 * Architecture invariants of the database split, enforced as greps over the
 * source tree rather than as review vigilance.
 *
 * Append-only: one `describe` block per AC, so parallel tracks add blocks
 * instead of editing each other's (plan R13). `rg` is not on PATH in every
 * shell this suite runs in, so the walk is done with `fs`.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "..", "..");
const SELF = "__tests__/unit/architecture.test.ts";

/**
 * The banned spellings, assembled rather than written out, so that running the
 * AC's own `rg` command over the tree returns a literal 0 instead of finding
 * the test that enforces it.
 */
const BANNED = {
  manager: ["Knex", "Connection"].join(""),
  accessor: ["get", "Connection()"].join(""),
  legacyDbVar: ["SQL", "DB", "NAME"].join("_"),
};

const sourceFiles = (): string[] => {
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (entry.name.endsWith(".ts")) acc.push(full);
    }
    return acc;
  };
  return (
    walk(SRC)
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
      // This file assembles the banned spellings at runtime, so it would match
      // itself on the reassembled value.
      .filter((file) => file !== SELF)
      .sort()
  );
};

const read = (relative: string): string =>
  fs.readFileSync(path.join(SRC, relative), "utf8");

const matching = (
  predicate: (contents: string, file: string) => boolean,
): string[] => sourceFiles().filter((file) => predicate(read(file), file));

describe("AC-5 — the zero-argument connection singleton is gone", () => {
  it("has no KnexManager import left anywhere", () => {
    expect(matching((contents) => contents.includes(BANNED.manager))).toEqual(
      [],
    );
  });

  it("has no zero-argument accessor call outside src/database/", () => {
    const offenders = matching(
      (contents, file) =>
        contents.includes(BANNED.accessor) && !file.startsWith("database/"),
    );
    expect(offenders).toEqual([]);
  });

  it("no longer ships the module it lived in", () => {
    expect(
      fs.existsSync(path.join(SRC, "database", `${BANNED.manager}.ts`)),
    ).toBe(false);
  });
});

describe("AC-42 — the env variable is SQL_DATABASE", () => {
  /**
   * Scope: the code and config that actually read the variable — `src/`, the
   * knexfiles and the env files.
   *
   * Explicitly NOT `.claude/`. Agent memory is prose owned by other agents, and
   * an AC whose grep spans the whole directory forces an implementer to edit a
   * reviewer's notes to make a test pass. That is the wrong pressure, and it is
   * why this scope is stated rather than left as "the repo".
   */
  const REPO = path.join(SRC, "..");
  const CONFIG_FILES = ["knexfile.ts", "knexfile.js", ".env", ".env.example"];

  it("has no occurrence of the superseded database env variable in src/", () => {
    expect(
      matching((contents) => contents.includes(BANNED.legacyDbVar)),
    ).toEqual([]);
  });

  it("has no occurrence in the knexfiles or the env files", () => {
    // `.env` is gitignored, so absence is normal on a fresh checkout.
    const present = CONFIG_FILES.filter((file) =>
      fs.existsSync(path.join(REPO, file)),
    );
    const offenders = present.filter((file) =>
      fs
        .readFileSync(path.join(REPO, file), "utf8")
        .includes(BANNED.legacyDbVar),
    );
    expect(offenders).toEqual([]);
    // Guard the guard: if both knexfiles ever vanish, this test silently passes.
    expect(present).toContain("knexfile.ts");
  });
});

describe("AC-56 — the registry is the only door", () => {
  /**
   * Files outside `src/dao/` and `src/database/` that hold a connection today.
   *
   * The list is the enforcement: anything NOT on it fails, so no new direct
   * caller can appear.
   *
   * Two kinds of entry, kept apart on purpose. The first block empties when T2b
   * routes those callers through `CoreClient` — every one of them holds a
   * `companies` lookup and nothing else. The second does NOT: those files own
   * their own SQL and are not scheduled to become DAOs by any track in this
   * plan, so **AC-56 as written ("no direct `knex(...)` outside a DAO, a
   * CoreClient method or `src/database/`") is unreachable** and needs amending
   * in T2b — either by widening it to "a DAO, a service that owns its SQL, or
   * CoreClient", or by moving these behind DAOs. Until that decision is taken,
   * do not let a permanent exemption ride under a temporary name.
   *
   * Classification is a REVIEW responsibility, not a test guarantee. The
   * block-count test below catches a *new* file added to the wrong block; it
   * cannot catch an *existing* file that is misclassified — which is exactly
   * what happened to `product.controller.ts` and
   * `production-route.controller.ts`, filed as T2b work when their SQL is ERP
   * (a `parts` count and a `SUPPLY_TABLES[…]` lookup), not a `companies`
   * lookup. Before adding an entry, read the SQL, not the file name.
   */
  const MOVES_TO_CORE_CLIENT_IN_T2B = [
    // What T2 left in this block (db-per-company D-101): the ten lookup
    // controllers now resolve through CoreClient and hold no connection. These
    // three are central controllers (AC-10's CENTRAL_PATHS) whose own SQL reads
    // the central plane directly, so they have no CoreClient method to move to.
    // `getStats`: company, active-company and user counts over `companies`/`users`.
    "controllers/companies/companies.controller.ts",
    // `getStats`: invitation counts by status over `invitations`.
    "controllers/invitations/invitations.controller.ts",
    // `getStats`: user counts by role plus recent `invitations`, company-scoped.
    "controllers/users/users.controller.ts",
  ];

  /** Permanent: owns its own SQL — AC-56 needs amending in T2b. */
  const PERMANENT_NON_DAO_HOLDERS = [
    "services/code-generator.service.ts",
    "services/countdown/countdown-documents.service.ts",
    "services/rbac.service.ts",
    "utils/foreignKeyResolver.ts",
    // Atomic multi-entity writes holding ERP SQL of their own: a `parts` count
    // (`product.controller.ts:437`) and a `SUPPLY_TABLES[…]` lookup
    // (`production-route.controller.ts:54`). plan.md:549-554 has T2b replace
    // only the `companies` query in these files, so both keep importing the
    // registry afterwards.
    "controllers/product/product.controller.ts",
    "controllers/production-route/production-route.controller.ts",
    // Developer smoke script, never imported by the app.
    "scripts/review-fix-smoke.ts",
    // The one sanctioned door into an append-only ledger (audit P2 §P2.7): it
    // owns a transaction per key that must set `mobius.audit_maintenance`
    // BEFORE its deletes, which is a transaction, not a query — no DAO method
    // can express it, and nothing else may set that setting.
    "services/company-purge.service.ts",
    // The audit read API's presenter (P3 §R-4): a diff entry for a foreign key
    // must show a label, never the internal number, and the columns come from
    // `AUDIT_FK_TABLE` — 68 columns across 40-odd tables, resolved with one
    // `whereIn` per table per response. That is the same column-to-table
    // lookup `utils/foreignKeyResolver.ts` above does in the opposite
    // direction (uuid -> id), and it belongs to no single entity's DAO.
    "services/audit-presenter.service.ts",
    // Not a connection holder at all: imports connectAll/disconnectAll for the
    // process lifecycle and calls `db()` never. It only appears here because
    // this check is import-based. (It was invisible to the previous, `../`-
    // anchored matcher — a top-level file imports `./database/registry`.)
    "server.ts",
    // The state-P purge scripts (db-per-company T0, D-63/D-65/D-73): one-off
    // processes that open the connection lifecycle themselves and must read
    // pg_stat_activity / information_schema, which no entity DAO owns.
    "scripts/db-snapshot-counts.ts",
    "scripts/purge-companies.ts",
    "scripts/purge-gate.ts",
    // The door itself (db-per-company T2): every read module code makes of
    // `companies`/`users`/`company_modules`/`modules` is a query here.
    "services/core-client.service.ts",
  ];

  const NON_DAO_CONNECTION_HOLDERS = [
    ...MOVES_TO_CORE_CLIENT_IN_T2B,
    ...PERMANENT_NON_DAO_HOLDERS,
  ];

  // Deliberately not anchored on `../`: a file directly under `src/` would
  // import `./database/registry` and must be seen too.
  const holdsAConnection = (contents: string): boolean =>
    contents.includes('database/registry"');

  it("keeps every connection holder inside src/dao, src/database or the allowlist", () => {
    const offenders = matching(
      (contents, file) =>
        holdsAConnection(contents) &&
        !file.startsWith("dao/") &&
        !file.startsWith("database/") &&
        !file.startsWith("__tests__/") &&
        !NON_DAO_CONNECTION_HOLDERS.includes(file),
    );
    expect(offenders).toEqual([]);
  });

  it("has no stale allowlist entry", () => {
    const stale = NON_DAO_CONNECTION_HOLDERS.filter(
      (file) =>
        !fs.existsSync(path.join(SRC, file)) || !holdsAConnection(read(file)),
    );
    expect(stale).toEqual([]);
  });

  it("counts the two blocks, so a permanent exemption cannot hide among the temporary ones", () => {
    expect(MOVES_TO_CORE_CLIENT_IN_T2B).toHaveLength(3);
    expect(PERMANENT_NON_DAO_HOLDERS).toHaveLength(14);
    // No file may sit in both blocks.
    expect(new Set(NON_DAO_CONNECTION_HOLDERS).size).toBe(
      NON_DAO_CONNECTION_HOLDERS.length,
    );
  });
});

describe("AC-7 (db-per-company T1) — company scoping is a local predicate", () => {
  /** Assembled for the same reason as `BANNED`: the AC's own rg must return 0. */
  const RETIRED_SCOPE_HELPER = ["applyCompany", "UuidScope"].join("");

  it("has no definition or caller of the uuid-join scope helper left", () => {
    expect(
      matching((contents) => contents.includes(RETIRED_SCOPE_HELPER)),
    ).toEqual([]);
  });

  it("scopes by the company column without joining companies", () => {
    expect(read("utils/daoScope.ts")).not.toMatch(/join\(\s*"companies"/);
  });
});

describe("AC-10 (db-per-company T2) — central tables are read only by the central plane", () => {
  const CENTRAL_TABLE =
    "(?:companies|users|roles|permissions|role_permissions|company_modules|modules|invitations|emailTokens)";

  /**
   * A call whose FIRST string argument is a central table, alias included:
   * `knex("users as u")`, `.leftJoin("users u", …)`, `db("core")("companies")`,
   * each with or without a type argument (`knex<IRow>("users")`). The join
   * family (`join`/`leftJoin`/`from`/`into`/`table`…) is the same shape with a
   * method name, so one pattern covers both. A table passed as the resolver's
   * SECOND argument (`getIdByUuid(uuid, "companies")`) cannot match: the
   * resolver routes those through CoreClient (AC-11).
   */
  const TABLE_CALL = new RegExp(
    `(?:\\b\\w+|\\))(?:<[^()]*>)?\\s*\\(\\s*["'\`]${CENTRAL_TABLE}(?:\\s+(?:as\\s+)?\\w+)?["'\`]`,
  );
  /** A constant whose value is exactly the table: `const USERS_TABLE = "users"`. */
  const TABLE_CONSTANT = new RegExp(`=\\s*["'\`]${CENTRAL_TABLE}["'\`]`);
  /** Raw SQL inside a string literal: `knex.raw("… join users u …")`. */
  const RAW_SQL = new RegExp(
    `\\b(?:from|join)\\s+"?${CENTRAL_TABLE}"?\\b`,
    "i",
  );
  const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[\s\S])*\1/g;

  // Prose mentions a table in backticks all the time; only code counts.
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const readsCentralTable = (source: string): boolean => {
    const code = withoutComments(source);
    return (
      TABLE_CALL.test(code) ||
      TABLE_CONSTANT.test(code) ||
      (code.match(STRING_LITERAL) ?? []).some((literal) =>
        RAW_SQL.test(literal),
      )
    );
  };

  const CENTRAL_PATHS: readonly RegExp[] = [
    /^dao\/(company|user|company-module|invitation|role|permission|module|email-token)\//,
    /^services\/(core-client|rbac|auth[^/]*|company-purge)\.service\.ts$/,
    /^middlewares\/(auth|audit-context)\.middleware\.ts$/,
    /^controllers\/(auth|companies|users|invitations|modules|public)\//,
    /^database\//,
  ];

  /** Permanent: each reason is why this file may never go through CoreClient. */
  const CORE_TABLE_READER_EXEMPTIONS: readonly string[] = [
    // P code (T0, D-74): reads the monolith whole at state P — the snapshot and
    // gate compare every table, `users` included, before any plane exists.
    "services/purge-snapshot.service.ts",
    // P script (T0, D-74): its refusal message names the `companies` cascade it
    // checks, which is the raw-SQL shape; it reads the monolith at state P.
    "scripts/purge-companies.ts",
    // Developer smoke script, never imported by the app: it seeds and removes
    // its own company, role and users directly.
    "scripts/review-fix-smoke.ts",
  ];

  const isCentral = (file: string): boolean =>
    CENTRAL_PATHS.some((pattern) => pattern.test(file));

  it("finds central-table access only in CENTRAL_PATHS or the exemptions", () => {
    const offenders = matching(
      (contents, file) =>
        !file.startsWith("__tests__/") &&
        !isCentral(file) &&
        !CORE_TABLE_READER_EXEMPTIONS.includes(file) &&
        readsCentralTable(contents),
    );
    expect(offenders).toEqual([]);
  });

  it("has no stale exemption", () => {
    const stale = CORE_TABLE_READER_EXEMPTIONS.filter(
      (file) =>
        !fs.existsSync(path.join(SRC, file)) || !readsCentralTable(read(file)),
    );
    expect(stale).toEqual([]);
  });

  it("recognises every access shape, and nothing the resolver routes", () => {
    const hits = [
      `knex("users")`,
      `db("core")("companies")`,
      `.leftJoin("users as u", "u.id", "d.userId")`,
      `.join("company_modules cm", "cm.moduleId", "m.id")`,
      `.from('roles')`,
      "trx(`emailTokens`)",
      `const USERS_TABLE = "users";`,
      `knex<{ id: number }>("users")`,
      `db("core")<ICompanyRow>("companies as c")`,
      `knex.raw("select id from users where uuid = ?")`,
      'knex.raw(`select d.id from countdown_documents d join users u on u.id = d."uploadedBy"`)',
      `knex.raw('select 1 from "company_modules" cm')`,
    ];
    const misses = [
      `getIdByUuid(uuid, "companies")`,
      `resolveUuidToId(value, { tableName: "users" })`,
      `.where("users.companyId", 7)`,
      `knex("users_archive")`,
      `// knex("users")`,
      `import { UserDAO } from "../dao/users";`,
      `knex.raw("select id from users_archive")`,
      `const message = "join us from the dashboard";`,
    ];
    expect(hits.filter((line) => !readsCentralTable(line))).toEqual([]);
    expect(misses.filter(readsCentralTable)).toEqual([]);
  });
});
