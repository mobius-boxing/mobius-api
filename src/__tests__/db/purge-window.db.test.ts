/**
 * db-per-company T0 — the local end-to-end rehearsal of state P (AC-80, model
 * D-72 as narrowed by brief D-84), the purge refusals with real per-table
 * counts (AC-78) and every gate failure mode proven red (AC-79 (a)–(e)).
 *
 * The sequence is the production window's, on throwaway companies:
 * `db-snapshot-counts --hold` → `pg_dump --snapshot` to a `file://` dump →
 * `purge-companies` for a and b → `purge-gate`, green with exactly the one
 * attribution tuple the fixture creates (a QA Demo CO customer whose
 * `salesPersonId` is a's user — D-66 in miniature). Company a also owns a
 * node-files workflow, which no cascade reaches (finding F-1).
 *
 * Failure modes that need a mutated database, (a) and (c), mutate inside a
 * transaction with `mobius.audit_skip` on and run the gate's checks on that
 * transaction before rolling it back: the only change the gate can see is the
 * one under test, and nothing is left behind. The CLI refusals (d) and (e) run
 * the real script.
 *
 * The gate compares against every company that exists, so the database must
 * hold no rows of companies that are already gone; `beforeAll` refuses one
 * that does rather than report a red gate for someone else's residue.
 *
 * L-013: teardown deletes every fixture explicitly by uuid or company id under
 * the maintenance door — never through `purgeCompany` or the scripts, the code
 * under test — runs every delete, and only then asserts.
 *
 * Run command, `--runInBand` and the scratch-database requirement: see
 * `purge-snapshot.db.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { spawnSync } from "child_process";
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { CompanyDAO } from "../../dao/company/company.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { RbacService } from "../../services/rbac.service";
import { EXPLICITLY_PURGED_TABLES } from "../../services/company-purge.service";
import {
  PURGE_APPLICATION_NAME,
  PurgeObjectStore,
  defaultCommitSources,
  discoverScopedTables,
  findNonKeeperRows,
  readDumpPairing,
  readSnapshotFile,
  resolveImageCommit,
  runPurgeGate,
  writeSnapshotIdSidecar,
  type GateInputs,
  type PurgeSnapshot,
  type Verdict,
} from "../../services/purge-snapshot.service";
import { runDbSnapshotCounts } from "../../scripts/db-snapshot-counts";
import {
  runPurgeCompanies,
  purgeCompaniesDeps,
} from "../../scripts/purge-companies";
import { runPurgeGateCli } from "../../scripts/purge-gate";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const pgTool = (name: string): string =>
  process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
const pgEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PGHOST: process.env.SQL_HOST,
  PGPORT: process.env.SQL_PORT || "5432",
  PGUSER: process.env.SQL_USER,
  PGPASSWORD: process.env.SQL_PASSWORD,
  PGDATABASE: process.env.SQL_DATABASE,
});

/** Local precondition (brief "Tests: conventions"): skip with a reason, never fail on a machine without it. */
const skipReason = ((): string | null => {
  if (!isLocalDb) return "SQL_HOST is not localhost";
  for (const tool of ["psql", "pg_dump"]) {
    if (spawnSync(pgTool(tool), ["--version"]).status !== 0)
      return `${tool} is not runnable (set PG_BIN)`;
  }
  const probe = spawnSync(
    pgTool("psql"),
    [
      "-AtXc",
      "select rolcreatedb and rolcreaterole from pg_roles where rolname = current_user",
    ],
    { env: pgEnv(), encoding: "utf8" },
  );
  if (probe.status !== 0) return `psql probe failed: ${probe.stderr.trim()}`;
  return probe.stdout.trim() === "t"
    ? null
    : "current_user lacks CREATEDB and CREATEROLE";
})();
const describeIfReady = skipReason ? describe.skip : describe;

const RUN = Date.now().toString(36);

type Row = Record<string, unknown>;
const rows = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> =>
  ((await db("core").raw(sql, bindings)) as { rows: T[] }).rows;

const countAllTables = async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const tables = await rows<{ t: string }>(
    `select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  for (const { t } of tables) {
    counts[t] =
      (await rows<{ n: number }>(`select count(*)::int as n from ??`, [t]))[0]
        ?.n ?? 0;
  }
  return counts;
};

const zzJestDatabases = async (): Promise<string[]> =>
  (
    await rows<{ datname: string }>(
      `select datname from pg_database where datname like 'zz\\_jest\\_%' order by 1`,
    )
  ).map((r) => r.datname);

const inMaintenance = (
  sql: string,
  bindings: readonly Knex.RawBinding[],
): Promise<void> =>
  db("core").transaction(async (trx) => {
    await trx.raw("select set_config('mobius.audit_maintenance', 'on', true)");
    await trx.raw("select set_config('mobius.audit_skip', 'on', true)");
    await trx.raw(sql, bindings);
  });

/** Runs every step even after one fails, and returns every failure. */
const runAllSteps = async (
  steps: [string, () => Promise<unknown>][],
): Promise<string[]> => {
  const failures: string[] = [];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(`${label}: ${String(error)}`);
    }
  }
  return failures;
};

const cliIo = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line: string) => {
        out.push(line);
        console.log(line);
      },
      err: (line: string) => {
        err.push(line);
        console.log(line);
      },
    },
  };
};

type Company = { id: number; uuid: string };

describeIfReady(
  `State P local rehearsal — snapshot, purge, gate${skipReason ? ` (skipped: ${skipReason})` : ""}`,
  () => {
    let workDir = "";
    let startCounts: Record<string, number> = {};
    let qa: Company;
    let a: Company | undefined;
    let b: Company | undefined;
    let aUserEmail = "";
    let keeperUuids: string[] = [];
    let snapshotFile = "";
    let dumpFile = "";
    let unpairedDump = "";
    let staleDump = "";
    let wrongCommitSnapshot = "";
    const fixtureUuids: string[] = [];
    const attributedCustomer = randomUUID();
    const keeperCustomer = randomUUID();
    const unkeyedTable = `zz_jest_unkeyed_${RUN}`;
    const noS3 = new PurgeObjectStore(async () => {
      throw new Error("S3 is not configured locally");
    }, null);
    const commitSources = () =>
      defaultCommitSources(path.join(workDir, "no-build-info.json"));

    const purgeDeps = (io: ReturnType<typeof cliIo>["io"]) => ({
      ...purgeCompaniesDeps(noS3),
      ...io,
    });
    const gateDeps = (io: ReturnType<typeof cliIo>["io"]) => ({
      knex: () => db("core"),
      store: noS3,
      commitSources: commitSources(),
      ...io,
    });
    const fileUrl = (file: string): string => pathToFileURL(file).href;
    const targets = (): [string, string] => {
      if (!a || !b) throw new Error("fixtures were not created");
      return [a.uuid, b.uuid];
    };

    const createCompany = async (slug: string): Promise<Company> => {
      await new CompanyDAO().create({ name: slug, slug });
      const [company] = await rows<Company>(
        `select id, uuid::text as uuid from companies where slug = ?`,
        [slug],
      );
      if (!company) throw new Error(`${slug} was not created`);
      await RbacService.seedCompanyRbac(db("core"), company.id);
      return company;
    };

    const readSnapshot = (file: string): PurgeSnapshot => {
      const read = readSnapshotFile(file);
      if (!read.ok) throw new Error(read.reason);
      return read.value;
    };

    const gateInputs = async (
      overrides: Partial<GateInputs> = {},
    ): Promise<GateInputs> => {
      const pairing = await readDumpPairing(fileUrl(dumpFile), noS3);
      const commit = resolveImageCommit(commitSources());
      if (!pairing.ok || !commit.ok)
        throw new Error("gate inputs are not resolvable");
      return {
        snapshot: readSnapshot(snapshotFile),
        keeperUuids,
        mode: "null",
        pairing: pairing.value,
        imageCommit: commit.value,
        store: noS3,
        archiveRoot: null,
        production: false,
        ...overrides,
      };
    };

    /** The gate's checks on a transaction holding `mutate`, rolled back afterwards. */
    const gateOnMutation = async (
      mutate: (trx: Knex.Transaction) => Promise<unknown>,
      overrides: Partial<GateInputs> = {},
    ): Promise<Verdict> => {
      const inputs = await gateInputs(overrides);
      const trx = await db("core").transaction();
      try {
        await trx.raw("select set_config('mobius.audit_skip', 'on', true)");
        await mutate(trx);
        return await runPurgeGate(trx, inputs);
      } finally {
        await trx.rollback();
      }
    };

    beforeAll(async () => {
      process.env.PGAPPNAME = PURGE_APPLICATION_NAME;
      await connectAll();
      startCounts = await countAllTables();
      expect(await zzJestDatabases()).toEqual([]);

      const existing = (
        await rows<{ id: number }>(`select id from companies`)
      ).map((c) => c.id);
      const residue = await findNonKeeperRows(
        db("core"),
        await discoverScopedTables(db("core")),
        existing,
      );
      if (residue.length > 0) {
        throw new Error(
          `this database already holds rows of companies that no longer exist (${residue
            .map((r) => `${r.table} ${r.rows}`)
            .join(
              ", ",
            )}); run against a scratch copy with that residue removed (db-restore-rehearsal.md §3.1)`,
        );
      }

      workDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `zz_jest_purge_window_${RUN}-`),
      );

      const [qaRow] = await rows<Company>(
        `select id, uuid::text as uuid from companies where slug = 'qa-demo-co'`,
      );
      if (!qaRow)
        throw new Error("local QA Demo CO (slug qa-demo-co) is required");
      qa = qaRow;
      const [qaUser] = await rows<{ id: number }>(
        `select id from users where "companyId" = ? order by id limit 1`,
        [qa.id],
      );
      if (!qaUser) throw new Error("local QA Demo CO needs at least one user");

      a = await createCompany(`zz-jest-purge-a-${RUN}`);
      b = await createCompany(`zz-jest-purge-b-${RUN}`);

      aUserEmail = `zz-jest-purge-a-${RUN}@example.test`;
      await new UserDAO().create({
        email: aUserEmail,
        password: "not-a-login",
        firstName: "zz",
        lastName: "jest",
        role: "member",
        companyId: a.id,
      });
      const [aUser] = await rows<{ id: number; uuid: string }>(
        `select id, uuid::text as uuid from users where email = ?`,
        [aUserEmail],
      );
      if (!aUser) throw new Error("a's user was not created");

      const warehouseUuid = randomUUID();
      const locationUuid = randomUUID();
      const workflowUuid = randomUUID();
      fixtureUuids.push(
        aUser.uuid,
        warehouseUuid,
        locationUuid,
        workflowUuid,
        attributedCustomer,
        keeperCustomer,
      );
      const [warehouse] = await rows<{ id: number }>(
        `insert into warehouses (uuid, name, company_id, grid_rows, grid_cols) values (?, ?, ?, 1, 1) returning id`,
        [warehouseUuid, `zz-jest-purge-a-wh-${RUN}`, a.id],
      );
      await db("core").raw(
        `insert into warehouse_locations (uuid, warehouse_id, row, col) values (?, ?, 1, 1)`,
        [locationUuid, warehouse?.id ?? null],
      );
      await db("core").raw(
        `insert into nf_workflows (uuid, "companyId", name) values (?, ?, ?)`,
        [workflowUuid, a.id, `zz-jest-purge-a-wf-${RUN}`],
      );
      await db("core").raw(
        `insert into customers (uuid, "companyId", name, "salesPersonId") values (?, ?, ?, ?)`,
        [
          attributedCustomer,
          qa.id,
          `zz-jest-purge-attributed-${RUN}`,
          aUser.id,
        ],
      );
      // A keeper row with a keeper-attributed SET NULL value, for failure modes (a) and (c).
      await db("core").raw(
        `insert into customers (uuid, "companyId", name, "salesPersonId") values (?, ?, ?, ?)`,
        [keeperCustomer, qa.id, `zz-jest-purge-keeper-${RUN}`, qaUser.id],
      );

      keeperUuids = (
        await rows<{ uuid: string }>(
          `select uuid::text as uuid from companies where id <> all(?) order by id`,
          [[a.id, b.id]],
        )
      ).map((k) => k.uuid);
    });

    afterAll(async () => {
      const companyIds = [a?.id, b?.id].filter(
        (id): id is number => id !== undefined,
      );
      try {
        const failures = await runAllSteps([
          [
            "customers",
            () =>
              inMaintenance(`delete from customers where uuid = any(?)`, [
                [attributedCustomer, keeperCustomer],
              ]),
          ],
          [
            "nf_workflows",
            () =>
              inMaintenance(`delete from nf_workflows where uuid = any(?)`, [
                fixtureUuids,
              ]),
          ],
          [
            "warehouse_locations",
            () =>
              inMaintenance(
                `delete from warehouse_locations where uuid = any(?)`,
                [fixtureUuids],
              ),
          ],
          [
            "warehouses",
            () =>
              inMaintenance(`delete from warehouses where uuid = any(?)`, [
                fixtureUuids,
              ]),
          ],
          [
            "users",
            () =>
              inMaintenance(`delete from users where uuid = any(?)`, [
                fixtureUuids,
              ]),
          ],
          [
            "companies (their RBAC catalogue goes by the schema's cascade)",
            () =>
              inMaintenance(`delete from companies where id = any(?)`, [
                companyIds,
              ]),
          ],
          [
            "audit_logs",
            () =>
              inMaintenance(
                `delete from audit_logs where "companyId" = any(?) or "entityUuid" = any(?)`,
                [companyIds, fixtureUuids],
              ),
          ],
          [
            "unkeyed table",
            () => db("core").raw(`drop table if exists ??`, [unkeyedTable]),
          ],
          [
            "work dir",
            async () => fs.rmSync(workDir, { recursive: true, force: true }),
          ],
        ]);

        expect(failures).toEqual([]);
        expect(fs.existsSync(snapshotFile)).toBe(false);
        expect(fs.existsSync(dumpFile)).toBe(false);
        expect(await zzJestDatabases()).toEqual([]);
        expect(await countAllTables()).toEqual(startCounts);
      } finally {
        await disconnectAll();
      }
    });

    it("AC-80 step 1: db-snapshot-counts --hold, with the paired dump taken by pg_dump --snapshot", async () => {
      const outDir = path.join(workDir, "snapshot");
      dumpFile = path.join(workDir, "traffic.pre-purge.dump");
      const { io, err } = cliIo();
      const code = await runDbSnapshotCounts(
        ["--keepers", ...keeperUuids, "--out", outDir, "--hold"],
        {
          knex: () => db("core"),
          store: noS3,
          commitSources: commitSources(),
          explicitlyPurgedTables: EXPLICITLY_PURGED_TABLES,
          now: () => new Date(),
          waitForRelease: async (held) => {
            const dump = spawnSync(
              pgTool("pg_dump"),
              ["-Fc", `--snapshot=${held.snapshotId}`, "-f", dumpFile],
              {
                env: pgEnv(),
                encoding: "utf8",
              },
            );
            if (dump.status !== 0)
              throw new Error(`pg_dump failed: ${dump.stderr}`);
          },
          ...io,
        },
      );
      expect(err).toEqual([]);
      expect(code).toBe(0);
      const [name] = fs.readdirSync(outDir);
      snapshotFile = path.join(outDir, name ?? "");
      const snapshot = readSnapshot(snapshotFile);
      writeSnapshotIdSidecar(dumpFile, snapshot.snapshotId);

      expect(snapshot.attributionTuples).toEqual([
        {
          table: "customers",
          rowUuid: attributedCustomer,
          column: "salesPersonId",
          userEmail: aUserEmail,
        },
      ]);
      expect(snapshot.counts.companies.map((c) => c.id)).toEqual(
        expect.arrayContaining([a?.id, b?.id]),
      );

      unpairedDump = path.join(workDir, "unpaired.dump");
      fs.copyFileSync(dumpFile, unpairedDump);
      writeSnapshotIdSidecar(unpairedDump, "00000000-00000000-1");
      staleDump = path.join(workDir, "stale.dump");
      fs.copyFileSync(dumpFile, staleDump);
      const beforeSnapshot = new Date(
        new Date(snapshot.takenAt).getTime() - 3600_000,
      );
      fs.utimesSync(staleDump, beforeSnapshot, beforeSnapshot);
      wrongCommitSnapshot = path.join(workDir, "wrong-commit.snapshot.json");
      fs.writeFileSync(
        wrongCommitSnapshot,
        JSON.stringify({ ...snapshot, imageCommit: "0".repeat(40) }),
      );
    });

    it("AC-79 (b): before the purge the gate is red on the targets' surviving rows, direct and via warehouse", async () => {
      const { io, err } = cliIo();
      const code = await runPurgeGateCli(
        [
          "--snapshot",
          snapshotFile,
          "--dump",
          fileUrl(dumpFile),
          "--keepers",
          ...keeperUuids,
        ],
        gateDeps(io),
      );
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("non-keeper rows survive");

      const snapshot = readSnapshot(snapshotFile);
      const survivors = await findNonKeeperRows(
        db("core"),
        await discoverScopedTables(db("core")),
        snapshot.keeperIds,
      );
      expect(survivors).toEqual(
        expect.arrayContaining([
          { table: "warehouse_locations", via: "warehouse", rows: 1 },
          { table: "nf_workflows", via: "company", rows: 1 },
        ]),
      );
    });

    it("AC-78: purge-companies refuses every unsafe invocation and changes 0 rows", async () => {
      const [aUuid, bUuid] = targets();
      const before = await countAllTables();
      const cases: [string, string[], string][] = [
        [
          "missing snapshot",
          [
            "--snapshot",
            path.join(workDir, "absent.json"),
            "--dump",
            fileUrl(dumpFile),
            aUuid,
            bUuid,
          ],
          "does not exist",
        ],
        [
          "unpaired dump",
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(unpairedDump),
            aUuid,
            bUuid,
          ],
          "unpaired",
        ],
        [
          "stale fallback dump",
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(staleDump),
            aUuid,
            bUuid,
          ],
          "stale",
        ],
        [
          "wrong image commit",
          [
            "--snapshot",
            wrongCommitSnapshot,
            "--dump",
            fileUrl(dumpFile),
            aUuid,
            bUuid,
          ],
          "wrong image",
        ],
        [
          "a keeper among the targets",
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(dumpFile),
            aUuid,
            bUuid,
            keeperUuids[0] ?? "",
          ],
          "is a keeper",
        ],
        [
          "a snapshot company neither kept nor purged",
          ["--snapshot", snapshotFile, "--dump", fileUrl(dumpFile), aUuid],
          "neither",
        ],
      ];
      for (const [label, args, reason] of cases) {
        const { io, err } = cliIo();
        const code = await runPurgeCompanies(args, purgeDeps(io));
        expect({ label, code }).toEqual({ label, code: 1 });
        expect({ label, err: err.join("\n") }).toEqual({
          label,
          err: expect.stringContaining(reason),
        });
      }

      // A table whose company rows purgeCompany would leave behind makes an
      // otherwise valid invocation refuse.
      await db("core").raw(`create table ?? ("companyId" integer)`, [
        unkeyedTable,
      ]);
      try {
        const { io, err } = cliIo();
        const code = await runPurgeCompanies(
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(dumpFile),
            aUuid,
            bUuid,
          ],
          purgeDeps(io),
        );
        expect(code).toBe(1);
        expect(err.join("\n")).toContain(`${unkeyedTable}.companyId`);
      } finally {
        await db("core").raw(`drop table if exists ??`, [unkeyedTable]);
      }
      expect(await countAllTables()).toEqual(before);
    });

    it("AC-80 step 3: purge-companies purges a then b with purgeCompany", async () => {
      const [aUuid, bUuid] = targets();
      const { io, out, err } = cliIo();
      const code = await runPurgeCompanies(
        ["--snapshot", snapshotFile, "--dump", fileUrl(dumpFile), aUuid, bUuid],
        purgeDeps(io),
      );
      expect(err).toEqual([]);
      expect(code).toBe(0);
      const results = out.map((line) => JSON.parse(line) as Row);
      expect(results.map((r) => [r.companyId, r.companyDeleted])).toEqual([
        [a?.id, true],
        [b?.id, true],
      ]);
    });

    it("AC-80 step 4: purge-gate is GREEN with exactly one attribution tuple", async () => {
      const { io, out, err } = cliIo();
      const code = await runPurgeGateCli(
        [
          "--snapshot",
          snapshotFile,
          "--dump",
          fileUrl(dumpFile),
          "--keepers",
          ...keeperUuids,
        ],
        gateDeps(io),
      );
      expect(err).toEqual([]);
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("1 attribution tuple(s)");
      const [attributed] = await rows<{ sales: number | null }>(
        `select "salesPersonId" as sales from customers where uuid = ?`,
        [attributedCustomer],
      );
      expect(attributed?.sales).toBeNull();
    });

    it("the mutation harness itself is green, so every red below is the mutation's", async () => {
      expect(await gateOnMutation(async () => undefined)).toEqual({ ok: true });
    });

    it("AC-79 (a): a keeper row deleted after the snapshot turns the gate red", async () => {
      const verdict = await gateOnMutation((trx) =>
        trx.raw(`delete from customers where uuid = ?`, [keeperCustomer]),
      );
      expect(verdict).toEqual({
        ok: false,
        reason: expect.stringContaining(
          `keeper count: customers for company ${qa.id}`,
        ),
      });
    });

    it("AC-79 (c): a newly NULL SET NULL value that is not an attribution tuple turns the gate red", async () => {
      const verdict = await gateOnMutation((trx) =>
        trx.raw(`update customers set "salesPersonId" = null where uuid = ?`, [
          keeperCustomer,
        ]),
      );
      expect(verdict).toEqual({
        ok: false,
        reason: expect.stringContaining("customers.salesPersonId"),
      });
      expect(!verdict.ok && verdict.reason).toContain("newly NULL");
    });

    it("AC-79 (d): the gate refuses an unpaired, stale or wrong-commit snapshot and a keeper mismatch", async () => {
      const [aUuid] = targets();
      const cases: [string, string[], string][] = [
        [
          "unpaired",
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(unpairedDump),
            "--keepers",
            ...keeperUuids,
          ],
          "unpaired",
        ],
        [
          "stale",
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(staleDump),
            "--keepers",
            ...keeperUuids,
          ],
          "stale",
        ],
        [
          "wrong commit",
          [
            "--snapshot",
            wrongCommitSnapshot,
            "--dump",
            fileUrl(dumpFile),
            "--keepers",
            ...keeperUuids,
          ],
          "wrong image",
        ],
        [
          "keeper mismatch",
          [
            "--snapshot",
            snapshotFile,
            "--dump",
            fileUrl(dumpFile),
            "--keepers",
            ...keeperUuids,
            aUuid,
          ],
          "keeper mismatch",
        ],
      ];
      for (const [label, args, reason] of cases) {
        const { io, err } = cliIo();
        const code = await runPurgeGateCli(args, gateDeps(io));
        expect({ label, code }).toEqual({ label, code: 1 });
        expect({ label, err: err.join("\n") }).toEqual({
          label,
          err: expect.stringContaining(reason),
        });
      }
    });

    it("AC-79 (e): under --attribution-mode reassigned a tuple still NULL is red, and a reassigned one is green", async () => {
      const { io, err } = cliIo();
      const code = await runPurgeGateCli(
        [
          "--snapshot",
          snapshotFile,
          "--dump",
          fileUrl(dumpFile),
          "--keepers",
          ...keeperUuids,
          "--attribution-mode",
          "reassigned",
        ],
        gateDeps(io),
      );
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("still NULL");

      const [qaUser] = await rows<{ id: number }>(
        `select id from users where "companyId" = ? order by id limit 1`,
        [qa.id],
      );
      const reassigned = await gateOnMutation(
        (trx) =>
          trx.raw(`update customers set "salesPersonId" = ? where uuid = ?`, [
            qaUser?.id ?? null,
            attributedCustomer,
          ]),
        { mode: "reassigned" },
      );
      expect(reassigned).toEqual({ ok: true });
    });
  },
);
