/**
 * The audit read API against a real database — audit P3, track T7.
 *
 * `repos/tests/api/audit-read.test.ts` proves the other half: that a real
 * authenticated HTTP request returns a correct, correctly-scoped,
 * sanitizer-safe response. This file proves the claims that **only Postgres
 * can answer**, and that T3 verified once by hand in a scratch script. Ad-hoc
 * verification is not a regression test: the first person to rewrite the
 * history query as an `OR` should get a red test here, not a query that takes
 * minutes in production six months from now.
 *
 * Five claims:
 *
 * 1. **The history plan uses both index legs and seq-scans no partition.**
 *    §4a is the entire justification for the `UNION ALL`: written as
 *    `WHERE entityUuid = :u OR rootUuid = :u` neither
 *    `("companyId","entityName","entityUuid","occurredAt")` nor
 *    `("companyId","rootEntity","rootUuid","occurredAt")` has a usable prefix
 *    and Postgres may fall back to a parallel seq scan *per partition* — 15
 *    partitions today, 12 more every year. A unit test against generated SQL
 *    text cannot see a plan.
 * 2. **The list query prunes partitions** when it carries `companyId` + `from`,
 *    which is what makes §4c's 90-day default window worth having.
 * 3. **`changedKeys @> ARRAY[?]` is a real filter**, not a no-op: the DAO's
 *    result is compared against a hand-written query. The transform that wraps
 *    the value in an array (`audit-log.dao.ts`) is the one binding shape that
 *    can silently degrade — a bare string either errors or matches nothing.
 * 4. **A cascade-deleted child keeps its `txId` and loses its `rootUuid`**
 *    (§0.4). This is a *documented gap*, not a bug, and it is asserted from
 *    both sides: the child does NOT come back inside the parent's history
 *    entry, and it DOES come back through `?transactionRef=`. A future reader
 *    who changes either half gets a red test instead of a surprise.
 * 5. **`paper_class_papers` and `role_permissions` rows really do carry a NULL
 *    `entityUuid`** — the premise of R-5, i.e. of the 400 the history endpoint
 *    returns for them. If that ever stopped being true the 400 would be
 *    hiding reachable history.
 *
 * Needs a database, and there is none by default (`.env` points at the deployed
 * host), so it is guarded to `localhost` and skips everywhere else — the same
 * guard as `schema/ownership.schema.test.ts:18-20`. Run it with, from
 * `repos/mobius-api`:
 *
 *   set -a; . ./.env; set +a; SQL_HOST=localhost \
 *     npx jest src/__tests__/db/audit-read.db.test.ts
 *
 * L-013 under an append-only ledger: `audit_logs` rows cannot be deleted
 * normally, so `afterAll` removes this run's rows the way `purgeCompany` does —
 * inside one transaction with `mobius.audit_maintenance='on'` (the protection
 * trigger stands aside) and `mobius.audit_skip='on'` (the cascade's own `Baja`
 * rows are never written in the first place). The ledger count is snapshotted
 * before the fixtures and asserted equal afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Request } from "express";
import { Client, QueryResult } from "pg";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { AuditLogDAO } from "../../dao/audit-log/audit-log.dao";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** Marks every row this run creates, so a leftover is greppable (L-013). */
const RUN = Date.now().toString(36).toUpperCase();
const mark = (suffix: string): string => `P3T7-${RUN}-${suffix}`;

type CountRow = { count: string };
type IdRow = { id: number };
type UuidRow = { uuid: string };
type PlanRow = { "QUERY PLAN": string };

/** One statement the DAO issued, as knex reports it on the `query` event. */
type Captured = { sql: string; bindings: readonly unknown[] };

/** The name a partition-local copy of `audit_logs_entity_idx` carries. */
const ENTITY_LEG = /_companyId_entityName_entityUuid_/;
/** …and of `audit_logs_root_idx`. */
const ROOT_LEG = /_companyId_rootEntity_rootUuid_/;

/**
 * A request as the read layer sees one. `parseQueryParams` takes the company
 * from `req.user` and never from input (L-009), so a scoped read is a user
 * with a `companyId` — which in the JWT is the company's **uuid** string.
 */
const requestFor = (
  companyUuid: string,
  query: Record<string, unknown> = {},
): Request =>
  ({
    query,
    user: { userId: mark("user"), companyId: companyUuid, role: "admin" },
  }) as unknown as Request;

describeIfLocalDb("Audit read against the database (P3, track T7)", () => {
  /**
   * The only connection this suite uses for direct SQL. Outside every pool the
   * registry owns, so "the row is there" means committed.
   */
  let outside: Client;
  const dao = new AuditLogDAO();

  let companyId = 0;
  let companyUuid = "";
  let machineTypeUuid = "";
  let corrugationId = 0;
  let corrugationUuid = "";
  let layerUuids: string[] = [];
  let roleUuid = "";
  let paperClassUuid = "";

  let startAuditCount = 0;

  const tableCount = async (table: string): Promise<number> => {
    const result = await outside.query<CountRow>(
      `SELECT count(*) FROM ${table}`,
    );
    return Number(result.rows[0].count);
  };

  /**
   * Run something through the DAO and hand back every statement it issued.
   *
   * The point of capturing rather than re-typing the SQL: what gets `EXPLAIN`ed
   * below is *exactly* what the DAO ran, bindings included. A copy of the query
   * pasted into the test would keep passing after the DAO changed, which is the
   * failure mode this whole file exists to prevent.
   */
  const capture = async (run: () => Promise<unknown>): Promise<Captured[]> => {
    const knex = db("erp");
    const captured: Captured[] = [];
    const listener = (query: { sql: string; bindings: readonly unknown[] }) => {
      captured.push({ sql: query.sql, bindings: query.bindings });
    };
    knex.on("query", listener);
    try {
      await run();
    } finally {
      knex.removeListener("query", listener);
    }
    return captured;
  };

  /**
   * `EXPLAIN` of one captured statement, as plain text.
   *
   * Run on the raw pg client rather than through knex: what knex reports on the
   * `query` event is the **driver's** SQL, with `$1`-style placeholders already
   * substituted for its own `?`. Handing that back to `knex.raw` raises
   * "Expected n bindings, saw 0" — it finds no `?` to fill. `pg` speaks `$n`
   * natively, so the plan is taken for exactly the statement that ran.
   */
  const explain = async (statement: Captured): Promise<string> => {
    const result = await outside.query<PlanRow>(
      `EXPLAIN ${statement.sql}`,
      statement.bindings as unknown[],
    );
    return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
  };

  /** Every `audit_logs` partition named anywhere in a plan. */
  const partitionsIn = (plan: string): string[] => [
    ...new Set(plan.match(/audit_logs_(?:y\d{4}m\d{2}|default)\b/g) ?? []),
  ];

  /**
   * Fixture writes, inside a transaction that carries an audit context — one
   * call is one "request".
   *
   * Two reasons it is not a bare `outside.query`. First, `companyId`: the
   * trigger takes it from the row's own `companyId`/`company_id` column and
   * falls back to `ctx ->> 'companyId'`, so a child table that has no company
   * column at all (`corrugation_layers`, `paper_class_papers`) writes a NULL
   * `companyId` without a context — and every company-scoped read then cannot
   * see it. Through the API the context is always there, so a fixture without
   * one would be testing a shape production never produces. Second, `txId`:
   * one transaction is one entry in a history, so the fixtures are split
   * across transactions exactly as separate requests would be.
   */
  const withAudit = async (
    statements: Array<[string, unknown[]]>,
  ): Promise<QueryResult[]> => {
    await outside.query("BEGIN");
    try {
      await outside.query("SELECT set_config('mobius.audit', $1, true)", [
        JSON.stringify({
          companyId,
          source: "script",
          username: mark("fixture"),
        }),
      ]);
      const results: QueryResult[] = [];
      for (const [sql, params] of statements) {
        results.push(await outside.query(sql, params));
      }
      await outside.query("COMMIT");
      return results;
    } catch (error) {
      await outside.query("ROLLBACK");
      throw error;
    }
  };

  /**
   * The purge door, held open for the teardown. Both settings are
   * `set_config(..., true)` — transaction-local — so neither can survive onto
   * the next user of this connection.
   */
  const inMaintenance = async (
    statements: Array<[string, unknown[]]>,
  ): Promise<void> => {
    await outside.query("BEGIN");
    try {
      await outside.query(
        "SELECT set_config('mobius.audit_maintenance', 'on', true)",
      );
      await outside.query("SELECT set_config('mobius.audit_skip', 'on', true)");
      for (const [sql, params] of statements) {
        await outside.query(sql, params);
      }
      await outside.query("COMMIT");
    } catch (error) {
      await outside.query("ROLLBACK");
      throw error;
    }
  };

  beforeAll(async () => {
    outside = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await outside.connect();
    // Snapshot BEFORE the fixtures, so the equality check covers them too.
    startAuditCount = await tableCount("audit_logs");
    await connectAll();

    // Every fixture below is written with capture ON: the ledger rows they
    // produce are the subject of the suite, so the triggers have to fire. The
    // company goes in without a context — R-A attributes a company's own row
    // to itself — and everything after it through `withAudit`.
    const company = await outside.query<IdRow & UuidRow>(
      `INSERT INTO companies (uuid, name, slug) VALUES (gen_random_uuid(), $1, $2)
         RETURNING id, uuid`,
      [mark("CO"), mark("co").toLowerCase()],
    );
    companyId = company.rows[0].id;
    companyUuid = company.rows[0].uuid;

    // One record with a two-transaction history: the `Alta`, then a
    // `Modificacion` whose `changedKeys` is exactly `{attribute}` — claim 3's
    // needle, and the target of the history plan.
    const machineType = (
      await withAudit([
        [
          `INSERT INTO machine_types (uuid, name, attribute, "companyId")
           VALUES (gen_random_uuid(), $1, 'alpha', $2) RETURNING uuid`,
          [mark("MT"), companyId],
        ],
      ])
    )[0] as QueryResult<UuidRow>;
    machineTypeUuid = machineType.rows[0].uuid;
    await withAudit([
      [
        `UPDATE machine_types SET attribute = 'beta' WHERE uuid = $1`,
        [machineTypeUuid],
      ],
    ]);

    // Claim 4's cascade fixture: a parent with two children on
    // ON DELETE CASCADE, deleted in the test itself.
    const corrugation = (
      await withAudit([
        [
          `INSERT INTO corrugations (uuid, code, description, "companyId")
           VALUES (gen_random_uuid(), $1, 'P3 T7 cascade fixture', $2)
           RETURNING id, uuid`,
          [mark("CORR"), companyId],
        ],
      ])
    )[0] as QueryResult<IdRow & UuidRow>;
    corrugationId = corrugation.rows[0].id;
    corrugationUuid = corrugation.rows[0].uuid;
    const layers = (
      await withAudit([
        [
          `INSERT INTO corrugation_layers (uuid, "corrugationId", position, "isLiner")
           VALUES (gen_random_uuid(), $1, 1, true), (gen_random_uuid(), $1, 2, false)
           RETURNING uuid`,
          [corrugationId],
        ],
      ])
    )[0] as QueryResult<UuidRow>;
    layerUuids = layers.rows.map((row) => row.uuid);

    // Claim 5's two id-less children, each written through its parent. The
    // permission is any existing one: `role_permissions` has a foreign key to
    // it, and nothing here reads what it grants.
    const role = (
      await withAudit([
        [
          `INSERT INTO roles (uuid, "companyId", name) VALUES (gen_random_uuid(), $1, $2)
           RETURNING id, uuid`,
          [companyId, mark("ROLE")],
        ],
      ])
    )[0] as QueryResult<IdRow & UuidRow>;
    roleUuid = role.rows[0].uuid;
    await withAudit([
      [
        `INSERT INTO role_permissions ("roleId", "permissionId", "companyId")
           SELECT $1, id, $2 FROM permissions ORDER BY id LIMIT 1`,
        [role.rows[0].id, companyId],
      ],
    ]);

    const paperClass = (
      await withAudit([
        [
          `INSERT INTO paper_classes (uuid, code, name, "companyId")
           VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id, uuid`,
          [mark("PC"), mark("PC"), companyId],
        ],
      ])
    )[0] as QueryResult<IdRow & UuidRow>;
    paperClassUuid = paperClass.rows[0].uuid;
    await withAudit([
      [
        `INSERT INTO paper_class_papers ("paperClassId", "paperSupplyId")
           SELECT $1, id FROM paper_supplies ORDER BY id LIMIT 1`,
        [paperClass.rows[0].id],
      ],
    ]);
  }, 120000);

  afterAll(async () => {
    try {
      // Entities first, ledger second (§0.3-5): with `audit_skip` on neither
      // writes a row, but the order is the purge path's and there is no reason
      // to differ from it.
      await inMaintenance([
        [`DELETE FROM corrugations WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM machine_types WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM paper_classes WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM role_permissions WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM roles WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM companies WHERE id = $1`, [companyId]],
        // Two scopes because they do not overlap: rows for tables with a
        // company column carry `companyId`, while `corrugation_layers` has
        // none and is reached only by the uuids this run generated.
        [`DELETE FROM audit_logs WHERE "companyId" = $1`, [companyId]],
        [
          `DELETE FROM audit_logs WHERE "entityUuid" = ANY($1::uuid[])
             OR "rootUuid" = ANY($1::uuid[])`,
          [
            [
              ...layerUuids,
              corrugationUuid,
              machineTypeUuid,
              roleUuid,
              paperClassUuid,
            ],
          ],
        ],
      ]);

      const endAuditCount = await tableCount("audit_logs");
      // eslint-disable-next-line no-console
      console.info(
        "[L-013] audit_logs count before/after:",
        JSON.stringify({ before: startAuditCount, after: endAuditCount }),
      );
      expect(endAuditCount).toBe(startAuditCount);
    } finally {
      await outside.end();
      await disconnectAll();
    }
  }, 120000);

  // ============ §4a — the plan the UNION exists for ========================

  describe("the history query plan (§4a)", () => {
    it("uses both index legs and seq-scans no audit_logs partition", async () => {
      const statements = await capture(() =>
        dao.getHistory(
          "machine_types",
          machineTypeUuid,
          1,
          20,
          requestFor(companyUuid),
        ),
      );
      // The page of txIds, their count, and their rows (§4b): the third only
      // runs when the first found something, so its presence is also the proof
      // that the fixture has history.
      expect(statements).toHaveLength(3);

      const plans = await Promise.all(statements.map(explain));
      // eslint-disable-next-line no-console
      console.info(
        "[§4a] EXPLAIN of the history statements:\n" +
          statements
            .map((s, i) => `--- statement ${i + 1} ---\n${s.sql}\n${plans[i]}`)
            .join("\n\n"),
      );

      for (const [index, plan] of plans.entries()) {
        // Leg 1 (`entityName`/`entityUuid`) and leg 2 (`rootEntity`/`rootUuid`)
        // each reach their own index. Partitions holding no rows at all fall
        // back to whichever index is cheapest to scan, which is a size
        // artifact of a laptop database, not a plan defect — hence "at least
        // one partition uses each leg" rather than "every partition does".
        expect({ index, entityLeg: ENTITY_LEG.test(plan) }).toEqual({
          index,
          entityLeg: true,
        });
        expect({ index, rootLeg: ROOT_LEG.test(plan) }).toEqual({
          index,
          rootLeg: true,
        });
        // The thing the UNION buys: no partition is read end to end. An `OR`
        // over the two columns is what puts a Seq Scan here.
        expect({ index, seqScan: /Seq Scan on audit_logs/.test(plan) }).toEqual(
          {
            index,
            seqScan: false,
          },
        );
      }
    }, 60000);

    it("returns the record's rows, so the plan is not a plan for nothing", async () => {
      const history = await dao.getHistory(
        "machine_types",
        machineTypeUuid,
        1,
        20,
        requestFor(companyUuid),
      );
      expect(history.totalCount).toBe(2); // the Alta and the Modificacion
      const rows = history.data.flatMap((group) => group.rows);
      expect(rows.map((row) => row.operation).sort()).toEqual([
        "Alta",
        "Modificacion",
      ]);
    });
  });

  // ============ §4c — the list query prunes partitions =====================

  describe("the list query plan (§4c)", () => {
    it("prunes partitions once the window excludes one", async () => {
      const total = Number(
        (
          await outside.query<CountRow>(
            `SELECT count(*) FROM pg_inherits WHERE inhparent = 'audit_logs'::regclass`,
          )
        ).rows[0].count,
      );
      expect(total).toBeGreaterThan(1);

      const plansFor = async (query: Record<string, unknown>) => {
        const statements = await capture(() =>
          dao.getAllWithFilters(requestFor(companyUuid, query)),
        );
        expect(statements).toHaveLength(2); // the page and its count
        return Promise.all(statements.map(explain));
      };

      // A read with a company but no date bound reaches every partition there
      // is — precisely the read §4c narrows to 90 days by default.
      const unbounded = await plansFor({});
      for (const plan of unbounded) {
        expect(partitionsIn(plan)).toHaveLength(total);
      }

      // The same read inside a window drops every month the window cannot
      // contain. **Both** bounds, deliberately: today the oldest partition IS
      // the current month — the ledger was created this month — so a lower
      // bound alone excludes nothing, and §4c's `from = now - 90 days` starts
      // pruning only once months older than the window exist. The upper bound
      // proves the mechanism now, and the assertion keeps holding then.
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const windowed = await plansFor({
        from: monthStart.toISOString(),
        to: new Date().toISOString(),
      });

      console.info(
        "[§4c] partitions per statement:",
        JSON.stringify({
          total,
          unbounded: unbounded.map((plan) => partitionsIn(plan).length),
          windowed: windowed.map(partitionsIn),
        }),
      );

      for (const plan of windowed) {
        const scanned = partitionsIn(plan);
        expect(scanned.length).toBeGreaterThan(0);
        expect(scanned.length).toBeLessThan(total);
        // The month the fixtures were written in is the one that survives.
        expect(
          scanned.some((name) => /^audit_logs_y\d{4}m\d{2}$/.test(name)),
        ).toBe(true);
      }
    }, 60000);
  });

  // ============ §4 — changedKey is a filter, not a no-op ===================

  describe("the changedKey filter", () => {
    it("returns exactly what a hand-written @> query returns", async () => {
      const page = await dao.getAllWithFilters(
        requestFor(companyUuid, { changedKey: "attribute", limit: "100" }),
      );
      const fromApi = page.data.map((row) => row.uuid).sort();

      const handWritten = await outside.query<UuidRow>(
        `SELECT l.uuid FROM audit_logs l
           JOIN companies c ON c.id = l."companyId"
          WHERE c.uuid = $1 AND l."changedKeys" @> ARRAY['attribute']::text[]
          ORDER BY l.uuid`,
        [companyUuid],
      );
      const fromSql = handWritten.rows.map((row) => row.uuid).sort();

      // Non-empty on purpose: two identical empty lists would agree about
      // nothing. The `Modificacion` of the fixture is the row both must find.
      expect(fromSql.length).toBe(1);
      expect(fromApi).toEqual(fromSql);
    });

    it("is a real predicate — a key nothing changed returns nothing", async () => {
      const page = await dao.getAllWithFilters(
        requestFor(companyUuid, { changedKey: "notAColumnAnywhere" }),
      );
      // A filter that had degraded into a no-op would return the company's
      // whole ledger here, which is what makes this the L-007 canary.
      expect(page.totalCount).toBe(0);
    });
  });

  // ============ §0.4 — the cascade gap, from both sides ====================

  describe("a cascade-deleted child (§0.4)", () => {
    it("keeps the parent's txId and loses its rootUuid", async () => {
      await withAudit([
        [`DELETE FROM corrugations WHERE id = $1`, [corrugationId]],
      ]);

      const parent = await outside.query<{ txId: string }>(
        `SELECT "txId"::text AS "txId" FROM audit_logs
          WHERE "entityName" = 'corrugations' AND "entityUuid" = $1
            AND operation = 'Baja'`,
        [corrugationUuid],
      );
      expect(parent.rows).toHaveLength(1);
      const parentTx = parent.rows[0].txId;

      const children = await outside.query<{
        rootUuid: string | null;
        txId: string;
      }>(
        `SELECT "rootUuid"::text AS "rootUuid", "txId"::text AS "txId"
           FROM audit_logs
          WHERE "entityName" = 'corrugation_layers'
            AND "entityUuid" = ANY($1::uuid[]) AND operation = 'Baja'`,
        [layerUuids],
      );
      expect(children.rows).toHaveLength(2);
      for (const child of children.rows) {
        // The `AFTER DELETE` trigger runs after the parent row is gone, so the
        // parent's uuid can no longer be looked up. Stated, not fixed.
        expect(child.rootUuid).toBeNull();
        // …but the transaction is the same one, which is the handle that keeps
        // the two halves of the deletion together.
        expect(child.txId).toBe(parentTx);
      }
    }, 60000);

    it("is therefore absent from the parent's history entry, and present by transactionRef", async () => {
      const history = await dao.getHistory(
        "corrugations",
        corrugationUuid,
        1,
        20,
        requestFor(companyUuid),
      );
      const deletion = history.data.find((group) =>
        group.rows.some((row) => row.operation === "Baja"),
      );
      expect(deletion).toBeDefined();
      // The documented gap: the `rootUuid` leg cannot see a child whose
      // `rootUuid` is NULL, so the entry carries the parent's row alone.
      expect((deletion?.rows ?? []).map((row) => row.entityName)).toEqual([
        "corrugations",
      ]);

      // And the compensating route, which is why the gap is acceptable: the
      // transaction reference groups the whole deletion.
      const byTx = await dao.getAllWithFilters(
        requestFor(companyUuid, {
          transactionRef: deletion?.txId,
          limit: "100",
        }),
      );
      const layerRows = byTx.data.filter(
        (row) => row.entityName === "corrugation_layers",
      );
      expect(layerRows).toHaveLength(2);
    }, 60000);
  });

  // ============ R-5 — the premise of the 400 ==============================

  describe("the id-less tables (R-5)", () => {
    it("writes NULL entityUuid for paper_class_papers and role_permissions", async () => {
      const rows = await outside.query<{
        entityName: string;
        entityUuid: string | null;
        rootEntity: string | null;
        rootUuid: string | null;
      }>(
        `SELECT "entityName", "entityUuid"::text AS "entityUuid",
                "rootEntity", "rootUuid"::text AS "rootUuid"
           FROM audit_logs
          WHERE "companyId" = $1
            AND "entityName" IN ('paper_class_papers', 'role_permissions')`,
        [companyId],
      );
      // One of each, from `beforeAll` — an empty result would make every
      // assertion below vacuously true.
      expect(rows.rows).toHaveLength(2);
      for (const row of rows.rows) {
        // The premise of R-5: `GET /history/<table>/:uuid` can never match one
        // of these, so the endpoint answers 400 naming the parent instead of
        // an always-empty 200.
        expect(row.entityUuid).toBeNull();
        // …and the reason no data is unreachable: the parent's history shows
        // them through `rootUuid`.
        expect(row.rootUuid).not.toBeNull();
      }
      expect(
        rows.rows.map((row) => `${row.entityName}->${row.rootEntity}`).sort(),
      ).toEqual([
        "paper_class_papers->paper_classes",
        "role_permissions->roles",
      ]);
    });

    it("makes those rows visible in the parent's history", async () => {
      const history = await dao.getHistory(
        "roles",
        roleUuid,
        1,
        20,
        requestFor(companyUuid),
      );
      const rows = history.data.flatMap((group) => group.rows);
      expect(rows.some((row) => row.entityName === "role_permissions")).toBe(
        true,
      );
    }, 60000);
  });
});
