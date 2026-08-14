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
    // → CoreClient.companyIdByUuid (AC-19). Each holds one `companies` query
    // and no other SQL, so each stops importing the registry entirely in T2b.
    "controllers/box-type/box-type.controller.ts",
    "controllers/color-type/color-type.controller.ts",
    "controllers/color/color.controller.ts",
    "controllers/companies/companies.controller.ts",
    "controllers/complement/complement.controller.ts",
    "controllers/flap-type/flap-type.controller.ts",
    "controllers/fsc-type/fsc-type.controller.ts",
    "controllers/glue-type/glue-type.controller.ts",
    "controllers/invitations/invitations.controller.ts",
    "controllers/product-type/product-type.controller.ts",
    "controllers/store-box/store-box.controller.ts",
    "controllers/store-roll/store-roll.controller.ts",
    "controllers/strapping-type/strapping-type.controller.ts",
    "controllers/trace-type/trace-type.controller.ts",
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
    // Not a connection holder at all: imports connectAll/disconnectAll for the
    // process lifecycle and calls `db()` never. It only appears here because
    // this check is import-based. (It was invisible to the previous, `../`-
    // anchored matcher — a top-level file imports `./database/registry`.)
    "server.ts",
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
    expect(MOVES_TO_CORE_CLIENT_IN_T2B).toHaveLength(15);
    expect(PERMANENT_NON_DAO_HOLDERS).toHaveLength(8);
    // No file may sit in both blocks.
    expect(new Set(NON_DAO_CONNECTION_HOLDERS).size).toBe(
      NON_DAO_CONNECTION_HOLDERS.length,
    );
  });
});
