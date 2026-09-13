/**
 * db-per-company T0 — `db-snapshot-counts` and the I-21 refusal against a REAL
 * Postgres: AC-75 (the snapshot file and what it counts), AC-76 (the exported
 * snapshot and `pg_dump --snapshot` see the same rows; a row written during
 * the hold is in neither), AC-77 (each of the three scripts refuses while
 * another backend is connected, before any read or write), and the two
 * schema-level refusals: a company table `purgeCompany` would leave behind
 * (finding F-1), and a kept company's row that `ON DELETE CASCADE` would remove
 * together with a purged company's user.
 *
 * Run from `repos/mobius-api`, against a database no other session uses — the
 * scripts refuse otherwise, which is the point of AC-77:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=<role with CREATEDB+CREATEROLE> SQL_PASSWORD=… \
 *   SQL_DATABASE=mobius_t0_rehearsal PG_BIN=/opt/homebrew/opt/postgresql@16/bin \
 *   npx jest --runInBand src/__tests__/db/company-purge.db.test.ts \
 *     src/__tests__/db/purge-snapshot.db.test.ts src/__tests__/db/purge-window.db.test.ts
 *
 * `--runInBand` is required: the suites count every public table and create
 * throwaway companies, so run in parallel each would see the other's rows.
 *
 * L-013: every fixture is `zz-jest-…-<RUN>`. Teardown deletes each one
 * explicitly by uuid or company id under the maintenance door — never through
 * `purgeCompany` or the scripts, the code under test — runs every delete, and
 * only then asserts every public table's count equals the start and no
 * `zz_jest_%` database remains.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { spawnSync } from "child_process";
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { knex as createKnex, type Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { connectionFor } from "../../database/env";
import { CompanyDAO } from "../../dao/company/company.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { RbacService } from "../../services/rbac.service";
import { EXPLICITLY_PURGED_TABLES } from "../../services/company-purge.service";
import {
  PURGE_APPLICATION_NAME,
  PurgeObjectStore,
  countScoped,
  defaultCommitSources,
  discoverScopedTables,
  readSnapshotFile,
  type PurgeSnapshot,
} from "../../services/purge-snapshot.service";
import {
  runDbSnapshotCounts,
  type SnapshotCliDeps,
} from "../../scripts/db-snapshot-counts";
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
  for (const tool of ["psql", "pg_dump", "pg_restore"]) {
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
const SNAPSHOT_KEYS = [
  "snapshotId",
  "takenAt",
  "imageCommit",
  "keeperIds",
  "counts",
  "attributionTuples",
];

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

const pgClient = (applicationName: string): Client => {
  const c = connectionFor("core");
  return new Client({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    application_name: applicationName,
  });
};

/** A closed client's backend can linger in pg_stat_activity for a moment. */
const waitUntilGone = async (applicationName: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [row] = await rows<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity where application_name = ?`,
      [applicationName],
    );
    if ((row?.n ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`backend '${applicationName}' is still connected`);
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

describeIfReady(
  `P scripts against real Postgres — snapshot and refusals${skipReason ? ` (skipped: ${skipReason})` : ""}`,
  () => {
    let workDir = "";
    let startCounts: Record<string, number> = {};
    let qa: { id: number; uuid: string };
    let throwaway: { id: number; uuid: string } | undefined;
    let throwawayUser: { id: number; uuid: string } | undefined;
    let throwawayEmail = "";
    let keeperUuids: string[] = [];
    let keeperIds: number[] = [];
    const scratchTable = `zz_jest_scoped_${RUN}`;
    const unkeyedTable = `zz_jest_unkeyed_${RUN}`;
    const hop1Table = `zz_jest_hop1_${RUN}`;
    const hop2Table = `zz_jest_hop2_${RUN}`;
    const restrictTable = `zz_jest_restrict_${RUN}`;
    const restoreDb = `zz_jest_purge_restore_${RUN}`;
    const fixtureUuids: string[] = [];
    const customerUuid = randomUUID();
    const markerUuid = randomUUID();
    const groupUuid = randomUUID();
    const memberUuid = randomUUID();
    const tokenUuid = randomUUID();
    const noS3 = new PurgeObjectStore(async () => {
      throw new Error("S3 is not configured locally");
    }, null);

    const snapshotDeps = (
      io: ReturnType<typeof cliIo>["io"],
      waitForRelease: SnapshotCliDeps["waitForRelease"] = async () => undefined,
    ): SnapshotCliDeps => ({
      knex: () => db("core"),
      store: noS3,
      commitSources: defaultCommitSources(
        path.join(workDir, "no-build-info.json"),
      ),
      explicitlyPurgedTables: EXPLICITLY_PURGED_TABLES,
      now: () => new Date(),
      waitForRelease,
      ...io,
    });

    const snapshotIn = (dir: string): PurgeSnapshot => {
      const [name] = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".snapshot.json"));
      const read = readSnapshotFile(path.join(dir, name ?? ""));
      if (!read.ok) throw new Error(read.reason);
      return read.value;
    };

    beforeAll(async () => {
      process.env.PGAPPNAME = PURGE_APPLICATION_NAME;
      await connectAll();
      startCounts = await countAllTables();
      expect(await zzJestDatabases()).toEqual([]);
      workDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `zz_jest_purge_snapshot_${RUN}-`),
      );
      fixtureUuids.push(
        customerUuid,
        markerUuid,
        groupUuid,
        memberUuid,
        tokenUuid,
      );

      const [qaRow] = await rows<{ id: number; uuid: string }>(
        `select id, uuid::text as uuid from companies where slug = 'qa-demo-co'`,
      );
      if (!qaRow)
        throw new Error("local QA Demo CO (slug qa-demo-co) is required");
      qa = qaRow;

      const slug = `zz-jest-purge-snap-${RUN}`;
      await new CompanyDAO().create({ name: slug, slug });
      const [company] = await rows<{ id: number; uuid: string }>(
        `select id, uuid::text as uuid from companies where slug = ?`,
        [slug],
      );
      if (!company) throw new Error("throwaway company was not created");
      throwaway = company;
      await RbacService.seedCompanyRbac(db("core"), company.id);
      throwawayEmail = `${slug}@example.test`;
      await new UserDAO().create({
        email: throwawayEmail,
        password: "not-a-login",
        firstName: "zz",
        lastName: "jest",
        role: "member",
        companyId: company.id,
      });
      const [user] = await rows<{ id: number; uuid: string }>(
        `select id, uuid::text as uuid from users where email = ?`,
        [throwawayEmail],
      );
      if (!user) throw new Error("throwaway user was not created");
      throwawayUser = user;
      fixtureUuids.push(user.uuid);

      await db("core").raw(
        `insert into customers (uuid, "companyId", name, "salesPersonId") values (?, ?, ?, ?)`,
        [customerUuid, qa.id, `zz-jest-purge-snap-customer-${RUN}`, user.id],
      );

      await db("core").raw(
        `create table ?? ("companyId" integer references companies (id) on delete cascade)`,
        [scratchTable],
      );
      await db("core").raw(`insert into ?? ("companyId") values (?)`, [
        scratchTable,
        qa.id,
      ]);

      const keepers = await rows<{ id: number; uuid: string }>(
        `select id, uuid::text as uuid from companies where id <> ? order by id`,
        [company.id],
      );
      keeperUuids = keepers.map((k) => k.uuid);
      keeperIds = keepers.map((k) => k.id);
    });

    afterAll(async () => {
      try {
        const failures = await runAllSteps([
          [
            "two-hop tables",
            () =>
              db("core").raw(`drop table if exists ??, ??`, [
                hop2Table,
                hop1Table,
              ]),
          ],
          [
            "restrict table",
            () => db("core").raw(`drop table if exists ??`, [restrictTable]),
          ],
          [
            "scratch table",
            () => db("core").raw(`drop table if exists ??`, [scratchTable]),
          ],
          [
            "unkeyed table",
            () => db("core").raw(`drop table if exists ??`, [unkeyedTable]),
          ],
          [
            "restore database backends",
            () =>
              db("core").raw(
                `select pg_terminate_backend(pid) from pg_stat_activity where datname = ?`,
                [restoreDb],
              ),
          ],
          [
            "restore database",
            () => db("core").raw(`drop database if exists ??`, [restoreDb]),
          ],
          [
            "customers",
            () =>
              inMaintenance(`delete from customers where uuid = any(?)`, [
                fixtureUuids,
              ]),
          ],
          [
            "countdown_group_members",
            () =>
              inMaintenance(
                `delete from countdown_group_members where uuid = any(?)`,
                [fixtureUuids],
              ),
          ],
          [
            "countdown_groups",
            () =>
              inMaintenance(
                `delete from countdown_groups where uuid = any(?)`,
                [fixtureUuids],
              ),
          ],
          [
            "emailTokens",
            () =>
              inMaintenance(`delete from "emailTokens" where uuid = any(?)`, [
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
                throwaway ? [throwaway.id] : [],
              ]),
          ],
          [
            "audit_logs",
            () =>
              inMaintenance(
                `delete from audit_logs where "companyId" = any(?) or "entityUuid" = any(?)`,
                [throwaway ? [throwaway.id] : [], fixtureUuids],
              ),
          ],
          [
            "work dir",
            async () => fs.rmSync(workDir, { recursive: true, force: true }),
          ],
        ]);

        expect(failures).toEqual([]);
        expect(fs.existsSync(workDir)).toBe(false);
        expect(await zzJestDatabases()).toEqual([]);
        expect(await countAllTables()).toEqual(startCounts);
      } finally {
        await disconnectAll();
      }
    });

    it("AC-75: writes exactly the six keys, with information_schema-discovered counts, NULL counts and attribution tuples", async () => {
      const dir = path.join(workDir, "ac75");
      const { io, err } = cliIo();
      const code = await runDbSnapshotCounts(
        ["--keepers", ...keeperUuids, "--out", dir],
        snapshotDeps(io),
      );
      expect(err).toEqual([]);
      expect(code).toBe(0);

      const [name] = fs.readdirSync(dir);
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, name ?? ""), "utf8"),
      ) as Row;
      expect(Object.keys(raw).sort()).toEqual([...SNAPSHOT_KEYS].sort());
      const snapshot = snapshotIn(dir);

      expect(snapshot.keeperIds).toEqual(keeperIds);
      expect(snapshot.imageCommit).toMatch(/^[0-9a-f]{40}$/);

      const zeros = Object.fromEntries(keeperIds.map((id) => [String(id), 0]));
      expect(snapshot.counts.scoped[scratchTable]).toEqual({
        ...zeros,
        [String(qa.id)]: 1,
      });

      const tables = Object.keys(snapshot.counts.scoped);
      expect(tables).toEqual(
        expect.arrayContaining([
          "customers",
          "warehouses",
          "warehouse_locations",
          "paper_stock",
          "audit_logs",
        ]),
      );
      expect(tables.filter((t) => t.startsWith("audit_logs_"))).toEqual([]);

      const [locations] = await rows<{ n: number }>(
        `select count(*)::int as n from warehouse_locations l join warehouses w on w.id = l.warehouse_id where w.company_id = ?`,
        [qa.id],
      );
      expect(snapshot.counts.scoped.warehouse_locations?.[String(qa.id)]).toBe(
        locations?.n,
      );
      const [customers] = await rows<{ n: number }>(
        `select count(*)::int as n from customers where "companyId" = ?`,
        [qa.id],
      );
      expect(snapshot.counts.scoped.customers?.[String(qa.id)]).toBe(
        customers?.n,
      );

      for (const table of ["users", "invitations", "audit_logs"] as const) {
        const [nulls] = await rows<{ n: number }>(
          `select count(*)::int as n from ?? where "companyId" is null`,
          [table],
        );
        expect(snapshot.counts.nullCompany[table]).toBe(nulls?.n);
      }

      expect(snapshot.attributionTuples).toEqual([
        {
          table: "customers",
          rowUuid: customerUuid,
          column: "salesPersonId",
          userEmail: throwawayEmail,
        },
      ]);
    });

    it("AC-76: a row written during --hold is absent from the paired dump, whose restore matches the snapshot counts", async () => {
      const dir = path.join(workDir, "ac76");
      const dumpFile = path.join(workDir, "ac76.dump");
      const { io, err } = cliIo();
      const code = await runDbSnapshotCounts(
        ["--keepers", ...keeperUuids, "--out", dir, "--hold"],
        snapshotDeps(io, async (held) => {
          const marker = pgClient("zz_jest_marker");
          await marker.connect();
          try {
            await marker.query(
              `insert into customers (uuid, "companyId", name) values ($1, $2, $3)`,
              [markerUuid, qa.id, `zz-jest-purge-marker-${RUN}`],
            );
          } finally {
            await marker.end();
          }
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
        }),
      );
      expect(err).toEqual([]);
      expect(code).toBe(0);
      const snapshot = snapshotIn(dir);

      // The marker really was committed: live QA customers are one more than the snapshot saw.
      const [live] = await rows<{ n: number }>(
        `select count(*)::int as n from customers where "companyId" = ?`,
        [qa.id],
      );
      expect(live?.n).toBe(
        (snapshot.counts.scoped.customers?.[String(qa.id)] ?? 0) + 1,
      );

      await db("core").raw(`create database ??`, [restoreDb]);
      const restore = spawnSync(
        pgTool("pg_restore"),
        ["-d", restoreDb, "--exit-on-error", dumpFile],
        {
          env: pgEnv(),
          encoding: "utf8",
        },
      );
      expect(restore.stderr).toBe("");
      expect(restore.status).toBe(0);

      const restored = createKnex({
        client: "pg",
        connection: { ...connectionFor("core"), database: restoreDb },
      });
      try {
        const tables = await discoverScopedTables(restored);
        expect(await countScoped(restored, tables, snapshot.keeperIds)).toEqual(
          snapshot.counts.scoped,
        );
        const marker = (
          (await restored.raw(
            `select count(*)::int as n from customers where uuid = ?`,
            [markerUuid],
          )) as { rows: { n: number }[] }
        ).rows;
        expect(marker[0]?.n).toBe(0);
      } finally {
        await restored.destroy();
      }
      await db("core").raw(`drop database ??`, [restoreDb]);
    });

    it("AC-77: all three scripts refuse while another backend is connected, before reading anything else", async () => {
      if (!throwaway) throw new Error("fixtures were not created");
      const intruder = pgClient("zz_jest_intruder");
      await intruder.connect();
      const absentSnapshot = path.join(workDir, "absent.snapshot.json");
      const purgeArgs = [
        "--snapshot",
        absentSnapshot,
        "--dump",
        "file:///zz-jest-absent.dump",
        throwaway.uuid,
      ];
      try {
        const snap = cliIo();
        const snapDir = path.join(workDir, "ac77");
        expect(
          await runDbSnapshotCounts(
            ["--keepers", ...keeperUuids, "--out", snapDir],
            snapshotDeps(snap.io),
          ),
        ).toBe(1);
        expect(snap.err.join("\n")).toContain(
          "application_name='zz_jest_intruder'",
        );
        expect(fs.existsSync(snapDir)).toBe(false);

        const purge = cliIo();
        expect(
          await runPurgeCompanies(purgeArgs, {
            ...purgeCompaniesDeps(noS3),
            ...purge.io,
          }),
        ).toBe(1);
        expect(purge.err.join("\n")).toContain(
          "application_name='zz_jest_intruder'",
        );
        expect(purge.err.join("\n")).not.toContain("does not exist");

        const gate = cliIo();
        const gateArgs = [
          "--snapshot",
          absentSnapshot,
          "--dump",
          "file:///zz-jest-absent.dump",
          "--keepers",
          ...keeperUuids,
        ];
        expect(
          await runPurgeGateCli(gateArgs, {
            knex: () => db("core"),
            store: noS3,
            commitSources: defaultCommitSources(
              path.join(workDir, "no-build-info.json"),
            ),
            ...gate.io,
          }),
        ).toBe(1);
        expect(gate.err.join("\n")).toContain(
          "application_name='zz_jest_intruder'",
        );
      } finally {
        await intruder.end();
      }
      const [stillThere] = await rows<{ n: number }>(
        `select count(*)::int as n from companies where id = ?`,
        [throwaway.id],
      );
      expect(stillThere?.n).toBe(1);

      // Same call with the intruder gone gets past the backend check and fails on the next one instead.
      await waitUntilGone("zz_jest_intruder");
      const again = cliIo();
      expect(
        await runPurgeCompanies(purgeArgs, {
          ...purgeCompaniesDeps(noS3),
          ...again.io,
        }),
      ).toBe(1);
      expect(again.err.join("\n")).toContain("does not exist");
      expect(again.err.join("\n")).not.toContain("other backends");
    });

    it("refuses a snapshot while a company table's rows would survive purgeCompany (no cascade, not deleted explicitly)", async () => {
      await db("core").raw(`create table ?? ("companyId" integer)`, [
        unkeyedTable,
      ]);
      const dir = path.join(workDir, "unkeyed");
      try {
        const { io, err } = cliIo();
        const code = await runDbSnapshotCounts(
          ["--keepers", ...keeperUuids, "--out", dir],
          snapshotDeps(io),
        );
        expect(code).toBe(1);
        expect(err.join("\n")).toContain(`${unkeyedTable}.companyId`);
        expect(fs.existsSync(dir)).toBe(false);
      } finally {
        await db("core").raw(`drop table if exists ??`, [unkeyedTable]);
      }
    });

    it("refuses a snapshot while a kept company's row would cascade away with a purged user, and not for rows owned only by that user", async () => {
      if (!throwawayUser) throw new Error("fixtures were not created");
      const [group] = await rows<{ id: number }>(
        `insert into countdown_groups (uuid, "companyId", name) values (?, ?, ?) returning id`,
        [groupUuid, qa.id, `zz-jest-purge-group-${RUN}`],
      );
      await db("core").raw(
        `insert into countdown_group_members (uuid, "groupId", "userId") values (?, ?, ?)`,
        [memberUuid, group?.id ?? null, throwawayUser.id],
      );
      await db("core").raw(
        `insert into "emailTokens" (uuid, "userId", token, type, "expiresAt") values (?, ?, ?, 'password_reset', now() + interval '1 day')`,
        [tokenUuid, throwawayUser.id, `zz-jest-purge-token-${RUN}`],
      );

      const refusedDir = path.join(workDir, "cascade-refused");
      const refused = cliIo();
      expect(
        await runDbSnapshotCounts(
          ["--keepers", ...keeperUuids, "--out", refusedDir],
          snapshotDeps(refused.io),
        ),
      ).toBe(1);
      const reason = refused.err.join("\n");
      expect(reason).toContain("users → countdown_group_members.userId (1)");
      expect(reason).not.toContain("emailTokens");
      expect(fs.existsSync(refusedDir)).toBe(false);

      await inMaintenance(
        `delete from countdown_group_members where uuid = ?`,
        [memberUuid],
      );

      const passedDir = path.join(workDir, "cascade-passed");
      const passed = cliIo();
      expect(
        await runDbSnapshotCounts(
          ["--keepers", ...keeperUuids, "--out", passedDir],
          snapshotDeps(passed.io),
        ),
      ).toBe(0);
      expect(passed.err).toEqual([]);
      expect(
        (
          await rows<{ n: number }>(
            `select count(*)::int as n from "emailTokens" where uuid = ?`,
            [tokenUuid],
          )
        )[0]?.n,
      ).toBe(1);
    });

    it("AC-91: refuses a snapshot while a kept company's row would go through a two-hop cascade from a purged user", async () => {
      if (!throwawayUser) throw new Error("fixtures were not created");
      await db("core").raw(
        `create table ?? (id serial primary key, "userId" integer not null references users (id) on delete cascade)`,
        [hop1Table],
      );
      await db("core").raw(
        `create table ?? (uuid uuid not null default gen_random_uuid(), "hop1Id" integer not null references ?? (id) on delete cascade, "companyId" integer not null references companies (id) on delete cascade)`,
        [hop2Table, hop1Table],
      );
      try {
        const [hop1] = await rows<{ id: number }>(
          `insert into ?? ("userId") values (?) returning id`,
          [hop1Table, throwawayUser.id],
        );
        await db("core").raw(
          `insert into ?? ("hop1Id", "companyId") values (?, ?)`,
          [hop2Table, hop1?.id ?? null, qa.id],
        );
        const dir = path.join(workDir, "two-hop");
        const { io, err } = cliIo();
        expect(
          await runDbSnapshotCounts(
            ["--keepers", ...keeperUuids, "--out", dir],
            snapshotDeps(io),
          ),
        ).toBe(1);
        expect(err.join("\n")).toContain(
          `users → ${hop1Table}.userId → ${hop2Table}.hop1Id (1)`,
        );
        expect(fs.existsSync(dir)).toBe(false);
      } finally {
        await db("core").raw(`drop table if exists ??, ??`, [
          hop2Table,
          hop1Table,
        ]);
      }
    });

    it("T0/D-115: refuses a snapshot while a kept company's row references a purged company's user through RESTRICT or NO ACTION, and passes once it does not", async () => {
      if (!throwawayUser) throw new Error("fixtures were not created");
      const [qaUser] = await rows<{ id: number }>(
        `select id from users where "companyId" = ? order by id limit 1`,
        [qa.id],
      );
      if (!qaUser) throw new Error("local QA Demo CO needs at least one user");
      await db("core").raw(
        `create table ?? (uuid uuid not null default gen_random_uuid(), "companyId" integer not null references companies (id) on delete cascade, "userId" integer not null references users (id) on delete restrict, "reviewerId" integer references users (id))`,
        [restrictTable],
      );
      try {
        const [row] = await rows<{ uuid: string }>(
          `insert into ?? ("companyId", "userId", "reviewerId") values (?, ?, ?) returning uuid::text as uuid`,
          [restrictTable, qa.id, throwawayUser.id, throwawayUser.id],
        );
        const refusedDir = path.join(workDir, "restrict-refused");
        const refused = cliIo();
        expect(
          await runDbSnapshotCounts(
            ["--keepers", ...keeperUuids, "--out", refusedDir],
            snapshotDeps(refused.io),
          ),
        ).toBe(1);
        const reason = refused.err.join("\n");
        expect(reason).toContain(`${restrictTable}.userId → users: ${row?.uuid}`);
        expect(reason).toContain(
          `${restrictTable}.reviewerId → users: ${row?.uuid}`,
        );
        expect(fs.existsSync(refusedDir)).toBe(false);

        await db("core").raw(`update ?? set "userId" = ?, "reviewerId" = ?`, [
          restrictTable,
          qaUser.id,
          qaUser.id,
        ]);
        const passedDir = path.join(workDir, "restrict-passed");
        const passed = cliIo();
        expect(
          await runDbSnapshotCounts(
            ["--keepers", ...keeperUuids, "--out", passedDir],
            snapshotDeps(passed.io),
          ),
        ).toBe(0);
        expect(passed.err).toEqual([]);
      } finally {
        await db("core").raw(`drop table if exists ??`, [restrictTable]);
      }
    });
  },
);
