/**
 * db-per-company T4 against a REAL Postgres: `purgeUser` per delete rule
 * (AC-21), `db-check-integrity` (AC-20) and its `--pre-c1` clauses (AC-84),
 * and `purgeCompany` through the module hooks at shared placement (AC-22).
 *
 * Run from `repos/mobius-api` against a scratch copy of local
 * `traffic_production`, as a superuser: the foreign-key orphan fixture needs
 * `session_replication_role = replica`, and a role without it FAILS the suite
 * (set SQL_ADMIN_USER / SQL_ADMIN_PASSWORD to one that has it):
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=mobius_t4_rehearsal \
 *   npx jest --runInBand src/__tests__/db/purge.db.test.ts
 *
 * The `--pre-c1` checks compare every company that exists with the snapshot's
 * keepers, so the copy must hold no ledger rows of companies already gone
 * (rehearsal doc §3.1 residue cleanup).
 *
 * L-013: every fixture carries the `RUN` marker or a recorded uuid; teardown
 * deletes them explicitly under the maintenance door — never through the code
 * under test — runs every delete, and then asserts every public table's count
 * equals the start.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "pg";
import type { Knex } from "knex";
import {
  connectAll,
  disconnectAll,
  db,
  rawCoreInstance,
  withTenantTarget,
} from "../../database/registry";
import { connectionFor } from "../../database/env";
import { CompanyDAO } from "../../dao/company/company.dao";
import {
  UserPurgeRefusedError,
  purgeCompany,
  purgeUser,
} from "../../services/company-purge.service";
import { discoverScopedTables } from "../../services/purge-snapshot.service";
import {
  findOrphans,
  runDbCheckIntegrity,
} from "../../scripts/db-check-integrity";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);
const MISSING_USER_ID = 2147483000;
const MISSING_COMPANY_ID = 2147483002;

type Row = Record<string, unknown>;
type Ref = { id: number; uuid: string };

const rows = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> =>
  ((await db("core").raw(sql, bindings)) as { rows: T[] }).rows;

const one = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T> => {
  const [row] = await rows<T>(sql, bindings);
  if (!row) throw new Error(`no row: ${sql}`);
  return row;
};

const countAllTables = async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const tables = await rows<{ t: string }>(
    `select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  for (const { t } of tables) {
    counts[t] = (
      await one<{ n: number }>(`select count(*)::int as n from ??`, [t])
    ).n;
  }
  return counts;
};

const inMaintenance = (
  sql: string,
  bindings: readonly Knex.RawBinding[],
): Promise<void> =>
  db("core").transaction(async (trx) => {
    await trx.raw("select set_config('mobius.audit_maintenance', 'on', true)");
    await trx.raw("select set_config('mobius.audit_skip', 'on', true)");
    await trx.raw(sql, bindings);
  });

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

describeIfLocalDb(
  "T4 purge, integrity and pre-C1 against real Postgres",
  () => {
    let startCounts: Record<string, number> = {};
    let admin: Client | undefined;
    const companyIds: number[] = [];
    const superAdminIds: number[] = [];
    const uuids: string[] = [];
    let snapshotFile = "";

    const track = <T extends Ref>(ref: T): T => {
      uuids.push(ref.uuid);
      return ref;
    };

    const createCompany = async (label: string): Promise<Ref> => {
      const slug = `zz-jest-t4-${label}-${RUN}`;
      await new CompanyDAO().create({ name: slug, slug });
      const company = track(
        await one<Ref>(
          `select id, uuid::text as uuid from companies where slug = ?`,
          [slug],
        ),
      );
      companyIds.push(company.id);
      return company;
    };

    const createUser = async (
      label: string,
      companyId: number | null,
    ): Promise<Ref> => {
      const user = track(
        await one<Ref>(
          `insert into users (email, password, "firstName", "lastName", "companyId", role)
         values (?, 'x', 'zz', 'jest', ?, ?) returning id, uuid::text as uuid`,
          [
            `zz-jest-t4-${label}-${RUN}@example.test`,
            companyId,
            companyId === null ? "superAdmin" : "member",
          ],
        ),
      );
      if (companyId === null) superAdminIds.push(user.id);
      return user;
    };

    const insert = async (
      sql: string,
      bindings: Knex.RawBinding[],
    ): Promise<Ref> =>
      track(
        await one<Ref>(`${sql} returning id, uuid::text as uuid`, bindings),
      );

    const file = (companyId: number, uploadedBy: number | null): Promise<Ref> =>
      insert(
        `insert into files ("companyId", "originalName", "storageKey", "uploadedBy") values (?, 'zz-jest.pdf', ?, ?)`,
        [companyId, `zz-jest/t4/${RUN}/${randomUUID()}`, uploadedBy],
      );

    const workflow = (
      companyId: number,
      createdBy: number | null,
    ): Promise<Ref> =>
      insert(
        `insert into nf_workflows (uuid, "companyId", name, "createdByUserId") values (?, ?, ?, ?)`,
        [
          randomUUID(),
          companyId,
          `zz-jest-t4-wf-${RUN}-${randomUUID()}`,
          createdBy,
        ],
      );

    const group = (companyId: number): Promise<Ref> =>
      insert(`insert into countdown_groups ("companyId", name) values (?, ?)`, [
        companyId,
        `zz-jest-t4-group-${RUN}`,
      ]);

    const member = (groupId: number, userId: number): Promise<Ref> =>
      insert(
        `insert into countdown_group_members ("groupId", "userId") values (?, ?)`,
        [groupId, userId],
      );

    const document = (companyId: number, uploadedBy: number): Promise<Ref> =>
      insert(
        `insert into countdown_documents ("companyId", title, "dueDate", "uploadedBy") values (?, ?, current_date, ?)`,
        [companyId, `zz-jest-t4-doc-${RUN}`, uploadedBy],
      );

    const assignment = (documentId: number, userId: number): Promise<Ref> =>
      insert(
        `insert into countdown_document_assignments ("documentId", "userId", kind) values (?, ?, 'user')`,
        [documentId, userId],
      );

    const valueOf = async (
      table: string,
      column: string,
      ref: Ref,
    ): Promise<unknown> =>
      (
        await rows<Row>(`select ?? as v from ?? where uuid = ?`, [
          column,
          table,
          ref.uuid,
        ])
      )[0]?.v;

    const exists = async (table: string, ref: Ref): Promise<boolean> =>
      (await rows(`select 1 from ?? where uuid = ?`, [table, ref.uuid]))
        .length > 0;

    /** Superuser session with foreign-key triggers off: the only way to plant an orphan an FK would reject. */
    const withoutForeignKeys = async (
      sql: string,
      bindings: unknown[],
    ): Promise<void> => {
      if (!admin) throw new Error("admin client not connected");
      await admin.query("begin");
      await admin.query("set local session_replication_role = replica");
      await admin.query(sql, bindings);
      await admin.query("commit");
    };

    /**
     * db-per-company (T8, AC-49): `db("tenant")` outside a request now
     * requires an explicit scope. `purgeCompany`/`db-check-integrity` still
     * assume the pre-T7 shared instance, so every test reaching one of them
     * needs this; none opens a competing scope of its own. `purgeUser`
     * (T12a) no longer needs it — it resolves its own targets — but the
     * wrapper is harmless for it too.
     */
    const runAsCoreTenant = <T>(fn: () => Promise<T>): Promise<T> =>
      withTenantTarget(
        { physicalKey: "core", instance: rawCoreInstance() },
        fn,
      );

    const integrity = async (argv: string[] = []) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runDbCheckIntegrity(argv, {
        core: () => db("core"),
        tenant: () => db("tenant"),
        now: () => new Date(),
        // No tenant_databases rows in this suite's fixture (T4 predates T9's
        // dedicated tenants) — the pre-T9 shared-target check above already
        // covers this suite's whole scenario.
        listDedicatedTenants: async () => [],
        resolveCompany: async () => null,
        openTenant: async () => db("tenant"),
        closeTenant: async () => undefined,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      });
      return { code, out, err };
    };

    beforeAll(async () => {
      await connectAll();
      const c = connectionFor("core");
      const adminUser = process.env.SQL_ADMIN_USER ?? process.env.SQL_USER;
      admin = new Client({
        host: c.host,
        port: c.port,
        database: c.database,
        user: adminUser,
        password: process.env.SQL_ADMIN_USER
          ? process.env.SQL_ADMIN_PASSWORD
          : c.password,
      });
      await admin.connect();
      const { rows: privilege } = await admin.query(
        "select rolsuper from pg_roles where rolname = current_user",
      );
      if (privilege[0]?.rolsuper !== true) {
        throw new Error(
          `role ${adminUser} is not a superuser — the foreign-key orphan fixture needs session_replication_role; set SQL_ADMIN_USER/SQL_ADMIN_PASSWORD`,
        );
      }
      const residue = await one<{ n: number }>(
        `select count(*)::int as n from audit_logs a
        where a."companyId" is not null
          and not exists (select 1 from companies c where c.id = a."companyId")`,
      );
      if (residue.n > 0) {
        throw new Error(
          `${residue.n} audit_logs rows belong to companies that no longer exist; clean the scratch copy first (rehearsal doc §3.1)`,
        );
      }
      startCounts = await countAllTables();
    });

    afterAll(async () => {
      try {
        const failures = await runAllSteps([
          // By uuid first: a test that fails before restoring a planted orphan
          // leaves a row whose company or user column no longer finds it by id.
          [
            "planted files",
            () =>
              inMaintenance(`delete from files where uuid = any(?)`, [uuids]),
          ],
          [
            "planted nf_workflows",
            () =>
              inMaintenance(`delete from nf_workflows where uuid = any(?)`, [
                uuids,
              ]),
          ],
          [
            "nf_workflows",
            () =>
              inMaintenance(
                `delete from nf_workflows where "companyId" = any(?)`,
                [[...companyIds, MISSING_COMPANY_ID]],
              ),
          ],
          [
            "companies",
            () =>
              inMaintenance(`delete from companies where id = any(?)`, [
                companyIds,
              ]),
          ],
          [
            "superAdmins",
            () =>
              inMaintenance(`delete from users where id = any(?)`, [
                superAdminIds,
              ]),
          ],
          [
            "audit_logs",
            () =>
              inMaintenance(
                `delete from audit_logs where "companyId" = any(?) or "entityUuid" = any(?)`,
                [[...companyIds, MISSING_COMPANY_ID], uuids],
              ),
          ],
          [
            "snapshot file",
            async () =>
              snapshotFile && fs.rmSync(snapshotFile, { force: true }),
          ],
        ]);
        expect(failures).toEqual([]);
        expect(await countAllTables()).toEqual(startCounts);
      } finally {
        await admin?.end();
        await disconnectAll();
      }
    });

    describe("purgeUser follows each reference's rule (AC-21)", () => {
      let a: Ref, b: Ref;
      let memberA: Ref, uploaderA: Ref, memberB: Ref, superAdmin: Ref;
      const f: Record<string, Ref> = {};

      beforeAll(async () => {
        a = await createCompany("a");
        b = await createCompany("b");
        memberA = await createUser("member-a", a.id);
        uploaderA = await createUser("uploader-a", a.id);
        memberB = await createUser("member-b", b.id);
        superAdmin = await createUser("super", null);

        const docA = await document(a.id, uploaderA.id);
        f.assignment = await assignment(docA.id, memberA.id);
        f.membership = await member((await group(a.id)).id, memberA.id);
        f.fileA = await file(a.id, memberA.id);
        f.workflowA = await workflow(a.id, memberA.id);
        f.fileB = await file(b.id, memberB.id);
        f.uploaderFile = await file(a.id, uploaderA.id);

        f.superFileA = await file(a.id, superAdmin.id);
        f.superFileB = await file(b.id, superAdmin.id);
        f.superMembership = await member((await group(b.id)).id, superAdmin.id);
        f.superWorkflowB = await workflow(b.id, superAdmin.id);
      });

      it("refuses while countdown_documents.uploadedBy (RESTRICT) holds the user, before any write", () =>
        runAsCoreTenant(async () => {
          const before = await countAllTables();

          const purge = purgeUser(uploaderA.id);
          await expect(purge).rejects.toBeInstanceOf(UserPurgeRefusedError);
          await expect(purge).rejects.toThrow(
            "countdown_documents.uploadedBy (1 row)",
          );

          expect(await exists("users", uploaderA)).toBe(true);
          expect(await valueOf("files", "uploadedBy", f.uploaderFile)).toBe(
            uploaderA.id,
          );
          expect(await countAllTables()).toEqual(before);
        }));

      it("deletes CASCADE rows, nulls SET NULL and declared nf_* values, and touches no other user's rows", () =>
        runAsCoreTenant(async () => {
          const result = await purgeUser(memberA.id);

          expect(result.userDeleted).toBe(true);
          expect(result.rowsDeleted).toMatchObject({
            "countdown_document_assignments.userId": 1,
            "countdown_group_members.userId": 1,
          });
          expect(result.valuesNulled).toMatchObject({
            "files.uploadedBy": 1,
            "nf_workflows.createdByUserId": 1,
          });
          expect(await exists("users", memberA)).toBe(false);
          expect(
            await exists("countdown_document_assignments", f.assignment),
          ).toBe(false);
          expect(await exists("countdown_group_members", f.membership)).toBe(
            false,
          );
          expect(await valueOf("files", "uploadedBy", f.fileA)).toBeNull();
          expect(
            await valueOf("nf_workflows", "createdByUserId", f.workflowA),
          ).toBeNull();
          expect(await valueOf("files", "uploadedBy", f.fileB)).toBe(
            memberB.id,
          );
          expect(await valueOf("files", "uploadedBy", f.uploaderFile)).toBe(
            uploaderA.id,
          );

          const check = await integrity();
          expect(check.err).toEqual([]);
          expect(check.code).toBe(0);
        }));

      it("purges a superAdmin's references in every company", () =>
        runAsCoreTenant(async () => {
          const result = await purgeUser(superAdmin.id);

          expect(result.userDeleted).toBe(true);
          expect(await valueOf("files", "uploadedBy", f.superFileA)).toBeNull();
          expect(await valueOf("files", "uploadedBy", f.superFileB)).toBeNull();
          expect(
            await exists("countdown_group_members", f.superMembership),
          ).toBe(false);
          expect(
            await valueOf("nf_workflows", "createdByUserId", f.superWorkflowB),
          ).toBeNull();
          expect((await integrity()).code).toBe(0);
        }));
    });

    describe("db-check-integrity finds orphans in batches (AC-20)", () => {
      let c: Ref, user: Ref;

      beforeAll(async () => {
        c = await createCompany("orphans");
        user = await createUser("orphans", c.id);
      });

      it("exits 0 on the clean copy", () =>
        runAsCoreTenant(async () => {
          const check = await integrity();
          expect(check.err).toEqual([]);
          expect(check.out[0]).toMatch(
            /^db-check-integrity: CLEAN; \d+ cross-plane references checked$/,
          );
          expect(check.code).toBe(0);
        }));

      it("names a manifest-declared nf_* column holding a user that does not exist, looking values up with whereIn batches", () =>
        runAsCoreTenant(async () => {
          await workflow(c.id, user.id);
          const orphan = await workflow(c.id, MISSING_USER_ID);
          const lookups: string[] = [];
          const core = ((table: string) =>
            db("core")(table).on("query", (q: { sql: string }) =>
              lookups.push(q.sql),
            )) as unknown as Knex;

          const found = await findOrphans(
            db("tenant"),
            core,
            {
              table: "nf_workflows",
              column: "createdByUserId",
              referencedTable: "users",
              referencedColumn: "id",
            },
            1,
          );
          expect(found?.sample).toContain(String(MISSING_USER_ID));
          expect(lookups.length).toBeGreaterThanOrEqual(2);
          expect(lookups.every((sql) => / in \(\?\)/.test(sql))).toBe(true);

          const check = await integrity();
          expect(check.code).toBe(1);
          expect(check.err.join("\n")).toContain(
            `orphans: nf_workflows.createdByUserId has 1 value(s) missing from users.id (e.g. ${MISSING_USER_ID})`,
          );

          await inMaintenance(`delete from nf_workflows where uuid = ?`, [
            orphan.uuid,
          ]);
          expect((await integrity()).code).toBe(0);
        }));

      it("names a foreign-key column holding a user that does not exist", () =>
        runAsCoreTenant(async () => {
          const planted = await file(c.id, null);
          await withoutForeignKeys(
            `update files set "uploadedBy" = $1 where uuid = $2`,
            [MISSING_USER_ID, planted.uuid],
          );

          const check = await integrity();
          expect(check.code).toBe(1);
          expect(check.err.join("\n")).toContain(
            "orphans: files.uploadedBy has 1 value(s) missing from users.id",
          );

          await withoutForeignKeys(
            `update files set "uploadedBy" = null where uuid = $1`,
            [planted.uuid],
          );
          expect((await integrity()).code).toBe(0);
        }));
    });

    describe("db-check-integrity finds company references outside companies", () => {
      it("names a tenant company column holding a company that does not exist", () =>
        runAsCoreTenant(async () => {
          const c = await createCompany("company-orphan");
          const planted = await file(c.id, null);
          await withoutForeignKeys(
            `update files set "companyId" = $1 where uuid = $2`,
            [MISSING_COMPANY_ID, planted.uuid],
          );

          const check = await integrity();
          expect(check.code).toBe(1);
          expect(check.err.join("\n")).toContain(
            `orphans: files.companyId has 1 value(s) missing from companies.id (e.g. ${MISSING_COMPANY_ID})`,
          );

          await withoutForeignKeys(`delete from files where uuid = $1`, [
            planted.uuid,
          ]);
          expect((await integrity()).code).toBe(0);
        }));
    });

    describe("purgeCompany through the module hooks at shared placement (AC-22)", () => {
      it("leaves 0 rows of the company in every scoped table, and a rerun is a no-op", () =>
        runAsCoreTenant(async () => {
          const c = await createCompany("purged");
          const user = await createUser("purged", c.id);
          const warehouse = await insert(
            `insert into warehouses (company_id, name) values (?, ?)`,
            [c.id, `zz-jest-t4-wh-${RUN}`],
          );
          const location = await insert(
            `insert into warehouse_locations (warehouse_id, "row", col) values (?, 1, 1)`,
            [warehouse.id],
          );
          const doc = await document(c.id, user.id);
          const assigned = await assignment(doc.id, user.id);
          const flow = await workflow(c.id, user.id);
          const attachment = await file(c.id, user.id);

          const first = await purgeCompany(c.id);
          expect(first.companyDeleted).toBe(true);

          const survivors: string[] = [];
          for (const t of await discoverScopedTables(db("core"))) {
            const { n } =
              t.via === "company"
                ? await one<{ n: number }>(
                    `select count(*)::int as n from ?? where ?? = ?`,
                    [t.table, t.column, c.id],
                  )
                : await one<{ n: number }>(
                    `select count(*)::int as n from ?? where ?? = ?`,
                    [t.table, t.column, warehouse.id],
                  );
            if (n > 0) survivors.push(`${t.table}: ${n}`);
          }
          expect(survivors).toEqual([]);
          for (const [table, ref] of [
            ["companies", c],
            ["users", user],
            ["warehouse_locations", location],
            ["countdown_document_assignments", assigned],
            ["nf_workflows", flow],
            ["files", attachment],
          ] as const) {
            expect([table, await exists(table, ref)]).toEqual([table, false]);
          }

          await expect(purgeCompany(c.id)).resolves.toEqual({
            companyDeleted: false,
            ledgerRowsDeleted: 0,
          });
        }));
    });

    describe("db-check-integrity --pre-c1 (AC-84)", () => {
      let a: Ref,
        b: Ref,
        memberA: Ref,
        otherA: Ref,
        memberB: Ref,
        superAdmin: Ref;
      let tuple: Ref, plain: Ref;

      const preC1 = () => integrity(["--pre-c1", "--snapshot", snapshotFile]);
      const linesOf = (err: string[], prefix: string) =>
        err.filter((line) => line.startsWith(`db-check-integrity: ${prefix}`));

      beforeAll(async () => {
        a = await createCompany("pre-a");
        b = await createCompany("pre-b");
        memberA = await createUser("pre-member-a", a.id);
        otherA = await createUser("pre-other-a", a.id);
        memberB = await createUser("pre-member-b", b.id);
        superAdmin = await createUser("pre-super", null);
        tuple = await file(a.id, null);
        plain = await file(a.id, null);

        const companies = await rows<{ id: number; uuid: string }>(
          `select id, uuid::text as uuid from companies order by id`,
        );
        snapshotFile = path.join(
          os.tmpdir(),
          `zz-jest-t4-pre-c1-${RUN}.snapshot.json`,
        );
        fs.writeFileSync(
          snapshotFile,
          JSON.stringify({
            snapshotId: `zz-jest-${RUN}`,
            takenAt: new Date().toISOString(),
            imageCommit: "zz-jest",
            keeperIds: companies.map((co) => co.id),
            counts: {
              companies,
              scoped: {},
              nullCompany: {},
              setNullToUsers: {},
              s3Prefixes: {},
            },
            attributionTuples: [
              {
                table: "files",
                rowUuid: tuple.uuid,
                column: "uploadedBy",
                userEmail: `zz-jest-gone-${RUN}@example.test`,
              },
            ],
          }),
        );
      });

      it("exits 0 when every clause holds", () =>
        runAsCoreTenant(async () => {
          const check = await preC1();
          expect(check.err).toEqual([]);
          expect(check.code).toBe(0);
        }));

      it("clause 1: a company outside the keepers is red", () =>
        runAsCoreTenant(async () => {
          const extra = await createCompany("pre-extra");
          const check = await preC1();
          expect(check.code).toBe(1);
          expect(linesOf(check.err, "pre-c1 companies:")).toHaveLength(1);

          await inMaintenance(`delete from companies where id = ?`, [extra.id]);
          await inMaintenance(`delete from audit_logs where "companyId" = ?`, [
            extra.id,
          ]);
          expect((await preC1()).code).toBe(0);
        }));

      it("clause 2: a row scoped to a company outside the keepers is red", () =>
        runAsCoreTenant(async () => {
          const stray = await workflow(MISSING_COMPANY_ID, null);
          const check = await preC1();
          expect(check.code).toBe(1);
          expect(
            linesOf(
              check.err,
              "pre-c1 non-keeper rows: nf_workflows (direct) 1",
            ),
          ).toHaveLength(1);

          await inMaintenance(`delete from nf_workflows where uuid = ?`, [
            stray.uuid,
          ]);
          await inMaintenance(`delete from audit_logs where "companyId" = ?`, [
            MISSING_COMPANY_ID,
          ]);
          expect((await preC1()).code).toBe(0);
        }));

      it("clause 3: an attribution tuple pointing at another company's user is red, at a same-company user green", () =>
        runAsCoreTenant(async () => {
          await rows(`update files set "uploadedBy" = ? where uuid = ?`, [
            memberB.id,
            tuple.uuid,
          ]);
          const red = await preC1();
          expect(red.code).toBe(1);
          expect(
            linesOf(
              red.err,
              `pre-c1 attribution: files.uploadedBy row ${tuple.uuid}`,
            ),
          ).toHaveLength(1);

          await rows(`update files set "uploadedBy" = ? where uuid = ?`, [
            otherA.id,
            tuple.uuid,
          ]);
          const reattributed = await preC1();
          expect(reattributed.err).toEqual([]);
          expect(reattributed.code).toBe(0);

          await rows(`update files set "uploadedBy" = null where uuid = ?`, [
            tuple.uuid,
          ]);
        }));

      it("clause 4: a SET NULL→users value of another company or a missing user is red; a superAdmin is not another company", () =>
        runAsCoreTenant(async () => {
          await rows(`update files set "uploadedBy" = ? where uuid = ?`, [
            memberB.id,
            plain.uuid,
          ]);
          const foreign = await preC1();
          expect(foreign.code).toBe(1);
          expect(
            linesOf(
              foreign.err,
              "pre-c1 user references: files.uploadedBy has 0 row(s) pointing at a missing user and 1 at a user of another company",
            ),
          ).toHaveLength(1);

          await rows(`update files set "uploadedBy" = ? where uuid = ?`, [
            superAdmin.id,
            plain.uuid,
          ]);
          const operatingAs = await preC1();
          expect(operatingAs.err).toEqual([]);
          expect(operatingAs.code).toBe(0);

          await withoutForeignKeys(
            `update files set "uploadedBy" = $1 where uuid = $2`,
            [MISSING_USER_ID, plain.uuid],
          );
          const missing = await preC1();
          expect(missing.code).toBe(1);
          expect(
            linesOf(
              missing.err,
              "pre-c1 user references: files.uploadedBy has 1 row(s) pointing at a missing user",
            ),
          ).toHaveLength(1);

          await withoutForeignKeys(
            `update files set "uploadedBy" = null where uuid = $1`,
            [plain.uuid],
          );
          expect((await preC1()).code).toBe(0);
          void memberA;
        }));
    });
  },
);
