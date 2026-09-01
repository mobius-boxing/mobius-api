/**
 * AC-13, AC-14 — the ambient request transaction against a REAL Postgres.
 *
 * **This is the only test in P1 that can fail for the right reason.** Every
 * other test of this phase mocks knex, so a facade that binds `transacting` to
 * the wrong handle, a `commit()` that silently no-ops, or a `set_config` that
 * leaks past the transaction stays green everywhere except here (brief §8,
 * "Rollback that does not roll back"). Seven claims are proven, all of them
 * from a SECOND connection so that "the row is not there" means the row is not
 * in the database, rather than "the query I used to look for it is inside the
 * same transaction that wrote it":
 *
 *   1. a failed context rolls back everything it wrote (AC-13);
 *   2. a successful one commits it;
 *   3. `current_setting('mobius.audit', true)` inside the transaction is the
 *      exact Appendix A key set P2's trigger will read (AC-14);
 *   4. that setting is transaction-LOCAL — a different pooled connection sees
 *      nothing (`set_config(..., true)` is the reason; this proves it);
 *   5. a DAO that opens its own transaction becomes a SAVEPOINT: an inner
 *      rollback leaves the outer transaction alive and its earlier writes
 *      intact (proven both on the raw mechanism and on the real
 *      `CorrugationDAO.replaceLayers`, one of the three P1b DAOs that kept
 *      their own transaction);
 *   6. two database keys open two transactions, on two backends, each with its
 *      own setting, and a failure rolls back both;
 *   7. a query awaited AFTER `finishAuditRequest` runs on the pool, not on a
 *      closed transaction (`registry.ts` reads `state.finished` at await time
 *      precisely for this).
 *
 * The ambient path is driven through `withAuditContext` rather than HTTP on
 * purpose: HTTP proves the wiring (that is `repos/tests/api/request-id.test.ts`)
 * while this proves the transaction semantics, with no middleware, no router
 * and no rate limiter between the assertion and the server.
 *
 * Needs a database, and there is none by default (`.env` points at the deployed
 * host), so it is guarded to `localhost` and skips everywhere else — the same
 * guard as `schema/ownership.schema.test.ts:18-20`. Run it with, from
 * `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production \
 *   npx jest src/__tests__/db/ambient-transaction.db.test.ts
 *
 * L-013: every row is marked with the `RUN` suffix so a leftover is findable,
 * and `afterAll` asserts the four touched tables are back at the counts the
 * suite started with — the assertion, not just the DELETEs, is what makes the
 * claim true.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { connectAll, disconnectAll, db } from "../../database/registry";
import {
  withAuditContext,
  withoutAudit,
  finishAuditRequest,
  getAuditState,
} from "../../database/audit-context";
import { CorrugationDAO } from "../../dao/corrugation/corrugation.dao";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** Marks every row this run creates, so a leftover is greppable (L-013). */
const RUN = Date.now().toString(36).toUpperCase();
const mark = (suffix: string): string => `P1T5-${RUN}-${suffix}`;

/** The tables this suite can write to. Counted before and after (L-013). */
const COUNTED_TABLES = [
  "companies",
  "warehouses",
  "corrugations",
  "corrugation_layers",
] as const;

/** The Appendix A contract. P2's trigger reads exactly these keys. */
const SETTING_KEYS = [
  "requestId",
  "source",
  "route",
  "action",
  "userId",
  "username",
  "role",
  "companyId",
  "actorCompanyId",
  "context",
];
const CONTEXT_KEYS = ["ip", "ua", "route"];

type CountRow = { count: string };
type SettingRow = { v: string | null };
type PidRow = { pid: number };

describeIfLocalDb("Ambient audit transaction against the database", () => {
  /**
   * The second connection. Everything asserted about durability is asserted
   * from here: it is outside every pool the registry owns, so it can only ever
   * see committed data.
   */
  let outside: Client;
  let companyId = 0;
  let corrugationId = 0;
  const startCounts: Record<string, number> = {};

  const countOutside = async (sql: string, params: unknown[] = []) => {
    const result = await outside.query<CountRow>(sql, params);
    return Number(result.rows[0].count);
  };

  const warehousesNamed = (name: string): Promise<number> =>
    countOutside(`SELECT count(*) FROM warehouses WHERE name = $1`, [name]);

  const corrugationsCoded = (code: string): Promise<number> =>
    countOutside(`SELECT count(*) FROM corrugations WHERE code = $1`, [code]);

  const tableCount = (table: string): Promise<number> =>
    countOutside(`SELECT count(*) FROM ${table}`);

  /** An insert through the ambient facade, in the shape a DAO would issue it. */
  const insertWarehouse = async (name: string): Promise<void> => {
    await db("erp")("warehouses").insert({
      uuid: randomUUID(),
      name,
      company_id: companyId,
      grid_rows: 1,
      grid_cols: 1,
    });
  };

  /** The same read, but issued INSIDE the ambient transaction. */
  const warehousesNamedInside = async (name: string): Promise<number> => {
    const rows = await db("erp")<{ id: number }>("warehouses").where(
      "name",
      name,
    );
    return rows.length;
  };

  const settingInside = async (
    key: "core" | "erp",
  ): Promise<Record<string, unknown> | null> => {
    const result = (await db(key).raw(
      "select current_setting('mobius.audit', true) as v",
    )) as { rows: SettingRow[] };
    const raw = result.rows[0].v;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  const backendPidInside = async (key: "core" | "erp"): Promise<number> => {
    const result = (await db(key).raw("select pg_backend_pid() as pid")) as {
      rows: PidRow[];
    };
    return result.rows[0].pid;
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
    // Snapshot BEFORE the fixtures, so afterAll's equality check covers the
    // fixtures too (L-013).
    for (const table of COUNTED_TABLES) {
      startCounts[table] = await tableCount(table);
    }
    await connectAll();

    // A committed scratch company: the warehouses written inside the ambient
    // transactions reference it, so no test ever depends on a FK pointing at a
    // row another (uncommitted) transaction holds.
    const company = await outside.query<{ id: number }>(
      `INSERT INTO companies (uuid, name, slug)
         VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [mark("CO"), mark("co").toLowerCase()],
    );
    companyId = company.rows[0].id;

    // A committed corrugation with a two-layer stack, for the savepoint test
    // against the real `replaceLayers`.
    const corrugation = await outside.query<{ id: number }>(
      `INSERT INTO corrugations (uuid, code, description, "companyId")
         VALUES (gen_random_uuid(), $1, 'P1 T5 fixture', $2) RETURNING id`,
      [mark("CORRFIX"), companyId],
    );
    corrugationId = corrugation.rows[0].id;
    await outside.query(
      `INSERT INTO corrugation_layers (uuid, "corrugationId", position, "isLiner")
         VALUES (gen_random_uuid(), $1, 1, true), (gen_random_uuid(), $1, 2, false)`,
      [corrugationId],
    );
  }, 60000);

  afterAll(async () => {
    try {
      // Anything a test forgot, plus everything a passing run leaves behind.
      await outside.query(`DELETE FROM warehouses WHERE name LIKE $1`, [
        `P1T5-${RUN}-%`,
      ]);
      await outside.query(`DELETE FROM corrugations WHERE code LIKE $1`, [
        `P1T5-${RUN}-%`,
      ]);
      // Cascades warehouses/corrugations that still point at it.
      await outside.query(`DELETE FROM companies WHERE name LIKE $1`, [
        `P1T5-${RUN}-%`,
      ]);

      // L-013, asserted rather than assumed: the four tables are back where
      // they started.
      const endCounts: Record<string, number> = {};
      for (const table of COUNTED_TABLES) {
        endCounts[table] = await tableCount(table);
      }
      // eslint-disable-next-line no-console
      console.info(
        "[L-013] table counts before/after:",
        JSON.stringify({ before: startCounts, after: endCounts }),
      );
      expect(endCounts).toEqual(startCounts);
    } finally {
      await outside.end();
      await disconnectAll();
    }
  }, 60000);

  describe("AC-13 — a failed request rolls back everything it wrote", () => {
    it("leaves no row from either table when the context throws", async () => {
      const warehouse = mark("ROLLBACK-WH");
      const corrugation = mark("ROLLBACK-CORR");

      await expect(
        withAuditContext({ source: "script", username: "test" }, async () => {
          await insertWarehouse(warehouse);
          await db("erp")("corrugations").insert({
            uuid: randomUUID(),
            code: corrugation,
            description: "rolled back",
            companyId,
          });

          // The writes really happened — inside the transaction they are
          // visible, outside it they are not. Without this pair the test would
          // also pass if the inserts had silently done nothing, which is the
          // exact failure a mock cannot distinguish.
          expect(await warehousesNamedInside(warehouse)).toBe(1);
          expect(await warehousesNamed(warehouse)).toBe(0);
          expect(await corrugationsCoded(corrugation)).toBe(0);

          throw new Error("request failed after writing");
        }),
      ).rejects.toThrow("request failed after writing");

      // The proof, from the separate connection.
      expect(await warehousesNamed(warehouse)).toBe(0);
      expect(await corrugationsCoded(corrugation)).toBe(0);
    });

    it("commits both rows when the context succeeds", async () => {
      const warehouse = mark("COMMIT-WH");
      const corrugation = mark("COMMIT-CORR");

      await withAuditContext(
        { source: "script", username: "test" },
        async () => {
          await insertWarehouse(warehouse);
          await db("erp")("corrugations").insert({
            uuid: randomUUID(),
            code: corrugation,
            description: "committed",
            companyId,
          });
          // Still invisible outside — the commit has not happened yet.
          expect(await warehousesNamed(warehouse)).toBe(0);
        },
      );

      expect(await warehousesNamed(warehouse)).toBe(1);
      expect(await corrugationsCoded(corrugation)).toBe(1);

      await outside.query(`DELETE FROM warehouses WHERE name = $1`, [
        warehouse,
      ]);
      await outside.query(`DELETE FROM corrugations WHERE code = $1`, [
        corrugation,
      ]);
    });
  });

  describe("AC-14 — the audit setting inside the transaction", () => {
    it("is the exact Appendix A key set, transaction-locally", async () => {
      let setting: Record<string, unknown> | null = null;
      let insideOtherConnection: Record<string, unknown> | null = null;

      await withAuditContext(
        { source: "script", username: "test", companyId: 42 },
        async () => {
          // Open the transaction first, so the setting is applied.
          await warehousesNamedInside(mark("NOBODY"));
          setting = await settingInside("erp");
          // A plain query on the SAME pool takes a DIFFERENT connection (the
          // transaction is holding its own), so it must see nothing: this is
          // what `set_config(..., true)` buys, proven rather than trusted.
          insideOtherConnection = await withoutAudit(() =>
            settingInside("erp"),
          );
        },
      );

      expect(setting).not.toBeNull();
      const value = setting as unknown as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.info("[AC-14] mobius.audit =", JSON.stringify(value));

      expect(Object.keys(value).sort()).toEqual([...SETTING_KEYS].sort());
      expect(
        Object.keys(value.context as Record<string, unknown>).sort(),
      ).toEqual([...CONTEXT_KEYS].sort());
      expect(value.source).toBe("script");
      expect(value.username).toBe("test");
      expect(value.companyId).toBe(42);
      expect(value.actorCompanyId).toBeNull();
      expect(value.userId).toBeNull();
      expect(value.action).toBeNull();
      expect(typeof value.requestId).toBe("string");

      expect(insideOtherConnection).toBeNull();
      // And from a connection this process does not pool at all.
      const outsideSetting = await outside.query<SettingRow>(
        "select current_setting('mobius.audit', true) as v",
      );
      expect(
        outsideSetting.rows[0].v === null || outsideSetting.rows[0].v === "",
      ).toBe(true);

      // The COMMIT discarded it. Without the `true` in `set_config` the value
      // would be session-level and would ride the connection back into the
      // pool, so the next unrelated request on that connection would inherit a
      // stranger's actor — the reason the third argument is not optional.
      // Sampled across the pool because which connection comes back is the
      // pool's business, not ours.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect(await withoutAudit(() => settingInside("erp"))).toBeNull();
      }
    });
  });

  describe("nested transactions become savepoints", () => {
    it("an inner rollback leaves the outer transaction alive and its writes intact", async () => {
      const before = mark("SP-BEFORE");
      const inner = mark("SP-INNER");
      const after = mark("SP-AFTER");

      await withAuditContext(
        { source: "script", username: "test" },
        async () => {
          await insertWarehouse(before);

          // `db(k).transaction(cb)` under an armed request is `trx.transaction`
          // — a SAVEPOINT. Its rollback is `ROLLBACK TO SAVEPOINT`, so the
          // outer transaction survives it.
          await expect(
            db("erp").transaction(async (trx) => {
              await trx("warehouses").insert({
                uuid: randomUUID(),
                name: inner,
                company_id: companyId,
                grid_rows: 1,
                grid_cols: 1,
              });
              throw new Error("inner failed");
            }),
          ).rejects.toThrow("inner failed");

          // The outer transaction is still usable — on an aborted transaction
          // every one of these would raise 25P02 instead.
          expect(await warehousesNamedInside(before)).toBe(1);
          expect(await warehousesNamedInside(inner)).toBe(0);
          await insertWarehouse(after);
        },
      );

      expect(await warehousesNamed(before)).toBe(1);
      expect(await warehousesNamed(inner)).toBe(0);
      expect(await warehousesNamed(after)).toBe(1);

      await outside.query(`DELETE FROM warehouses WHERE name IN ($1, $2)`, [
        before,
        after,
      ]);
    });

    /**
     * The previous case passes just as happily if the inner `transaction()`
     * escaped to a top-level transaction of its own — an independent
     * transaction that throws also rolls itself back and also leaves the outer
     * one alive. Mutation-checked (L-018): replacing the savepoint with an
     * independent transaction left it green. Only these two assertions tell the
     * two apart — the inner handle can READ the outer's uncommitted row (same
     * transaction), and its `commit()` is a RELEASE SAVEPOINT that a later
     * failure of the request still undoes.
     */
    it("treats an inner commit as a savepoint release, so it still dies with the request", async () => {
      const outer = mark("SPC-OUTER");
      const innerCommitted = mark("SPC-INNER");

      await expect(
        withAuditContext({ source: "script", username: "test" }, async () => {
          await insertWarehouse(outer);

          await db("erp").transaction(async (trx) => {
            // An independent transaction could not see this row: it is
            // uncommitted work of the request's transaction.
            const seen = await trx<{ id: number }>("warehouses").where(
              "name",
              outer,
            );
            expect(seen).toHaveLength(1);
            await trx("warehouses").insert({
              uuid: randomUUID(),
              name: innerCommitted,
              company_id: companyId,
              grid_rows: 1,
              grid_cols: 1,
            });
          });

          // The inner transaction "committed" — and is still invisible outside.
          expect(await warehousesNamedInside(innerCommitted)).toBe(1);
          expect(await warehousesNamed(innerCommitted)).toBe(0);

          throw new Error("request failed after the inner commit");
        }),
      ).rejects.toThrow("request failed after the inner commit");

      expect(await warehousesNamed(outer)).toBe(0);
      expect(await warehousesNamed(innerCommitted)).toBe(0);
    });

    it("rolls a real DAO's own transaction back with the request (CorrugationDAO.replaceLayers)", async () => {
      const dao = new CorrugationDAO();
      const layersOutside = async (): Promise<number[]> => {
        const rows = await outside.query<{ position: number }>(
          `SELECT position FROM corrugation_layers WHERE "corrugationId" = $1 ORDER BY position`,
          [corrugationId],
        );
        return rows.rows.map((row) => row.position);
      };

      expect(await layersOutside()).toEqual([1, 2]);

      await expect(
        withAuditContext({ source: "script", username: "test" }, async () => {
          // `replaceLayers` opens `db("erp").transaction(...)` itself — under
          // the ambient transaction that is a savepoint, so its writes are the
          // request's writes and die with it.
          await dao.replaceLayers(corrugationId, [
            {
              position: 1,
              isLiner: false,
              paperClassId: null,
              fluteTypeId: null,
            },
          ]);
          // Committed state is untouched while the request is in flight.
          expect(await layersOutside()).toEqual([1, 2]);
          throw new Error("request failed after replaceLayers");
        }),
      ).rejects.toThrow("request failed after replaceLayers");

      // Before P1 this stack would have been rewritten to a single layer and
      // left that way. This assertion is the bug fix §P1.6 promises.
      expect(await layersOutside()).toEqual([1, 2]);
    });
  });

  describe("two database keys", () => {
    it("open two transactions on two backends and both roll back", async () => {
      const company = mark("MULTI-CO");
      const warehouse = mark("MULTI-WH");
      let corePid = 0;
      let erpPid = 0;
      let openKeys: string[] = [];

      await expect(
        withAuditContext({ source: "script", username: "test" }, async () => {
          await db("core")("companies").insert({
            uuid: randomUUID(),
            name: company,
            slug: company.toLowerCase(),
          });
          await insertWarehouse(warehouse);

          corePid = await backendPidInside("core");
          erpPid = await backendPidInside("erp");
          openKeys = [...(getAuditState()?.trx.keys() ?? [])];

          // Each transaction carries its own copy of the setting.
          expect((await settingInside("core"))?.source).toBe("script");
          expect((await settingInside("erp"))?.source).toBe("script");

          throw new Error("two-key request failed");
        }),
      ).rejects.toThrow("two-key request failed");

      expect(openKeys.sort()).toEqual(["core", "erp"]);
      // Two distinct backends ⇒ two connections ⇒ two transactions.
      expect(corePid).not.toBe(erpPid);

      expect(
        await countOutside(`SELECT count(*) FROM companies WHERE name = $1`, [
          company,
        ]),
      ).toBe(0);
      expect(await warehousesNamed(warehouse)).toBe(0);
    });
  });

  describe("the `finished` guard", () => {
    /**
     * Two different guards share the word "finished", and only one of them is
     * `registry.ts`'s reason for reading `state.finished` at AWAIT time.
     *
     * - A builder *created* after the finish never reaches `bindLazily` at all:
     *   `db()` asks `isAmbientAuditActive`, which is already false, and hands
     *   out the plain facade.
     * - A builder created BEFORE the finish and awaited AFTER it — the exact
     *   shape of a `void`ed audit insert overtaken by `res.end` — is the case
     *   `bindLazily`'s check exists for. Mutation-checked (L-018): deleting the
     *   check leaves the first case green and turns this one red.
     */
    it("runs a query awaited after finishAuditRequest on the pool, not the closed transaction", async () => {
      const inTrx = mark("FIN-INTRX");
      const late = mark("FIN-LATE");
      const afterFinish = mark("FIN-AFTER");

      await withAuditContext(
        { source: "script", username: "test" },
        async () => {
          await insertWarehouse(inTrx);

          // Built now, awaited after the finish. Knex builders are lazy, so
          // nothing has run and no transaction has been bound yet.
          const pendingWrite = db("erp")("warehouses").insert({
            uuid: randomUUID(),
            name: late,
            company_id: companyId,
            grid_rows: 1,
            grid_cols: 1,
          });

          // The response has ended and the transaction was rolled back.
          await finishAuditRequest(false);

          // On the rolled-back transaction this would throw "Transaction query
          // already complete"; on the pool it simply autocommits.
          await pendingWrite;
          expect(await warehousesNamed(late)).toBe(1);

          // And a builder created after the finish takes the plain facade too.
          await insertWarehouse(afterFinish);
          expect(await warehousesNamed(afterFinish)).toBe(1);
          expect(await warehousesNamed(inTrx)).toBe(0);
        },
      );

      expect(await warehousesNamed(late)).toBe(1);
      await outside.query(`DELETE FROM warehouses WHERE name = $1`, [late]);

      // withAuditContext's own finishAuditRequest(true) was a no-op.
      expect(await warehousesNamed(inTrx)).toBe(0);
      expect(await warehousesNamed(afterFinish)).toBe(1);

      await outside.query(`DELETE FROM warehouses WHERE name = $1`, [
        afterFinish,
      ]);
    });
  });
});
