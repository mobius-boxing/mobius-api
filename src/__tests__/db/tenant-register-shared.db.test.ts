/**
 * `tenant:register-shared` against REAL Postgres (db-per-company model D-21/
 * D-31, brief D-69, AC-46, AC-85). State C1: one `active` `tenant_databases`
 * row per existing company, all pointing at the shared server with the core
 * connection's own identity.
 *
 * Needs a local database — same guard as `ambient-transaction.db.test.ts`.
 *
 *   SQL_HOST=localhost SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=<a scratch core db from db:bootstrap> \
 *   npx jest src/__tests__/db/tenant-register-shared.db.test.ts --runInBand
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  runTenantRegisterShared,
  type RegisterSharedCliDeps,
} from "../../scripts/tenant-register-shared";
import { registerShared } from "../../services/tenant-provisioning.service";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { CompanyDAO } from "../../dao/company/company.dao";
import { DbServerDAO } from "../../dao/db-server/db-server.dao";
import { connectionFor } from "../../database/env";
import type { PurgeSnapshot } from "../../services/purge-snapshot.service";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);
const mark = (suffix: string): string => `t7reg_${RUN}_${suffix}`;

const writeSnapshot = (keeperIds: readonly number[]): string => {
  const snapshot: PurgeSnapshot = {
    snapshotId: mark("snap"),
    takenAt: new Date().toISOString(),
    imageCommit: "0000000000000000000000000000000000000000",
    keeperIds: [...keeperIds],
    counts: {
      companies: [],
      scoped: {},
      nullCompany: { users: 0, invitations: 0, audit_logs: 0 },
      setNullToUsers: {},
      s3Prefixes: {},
    } as never,
    attributionTuples: [],
  };
  const file = path.join(os.tmpdir(), `${mark("snapshot")}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot));
  return file;
};

describeIfLocalDb("tenant:register-shared against real Postgres (T7)", () => {
  const companyDAO = new CompanyDAO();
  const createdCompanyIds: number[] = [];
  const createdTenantRowIds: number[] = [];
  const snapshotFiles: string[] = [];

  const makeCompany = async (suffix: string): Promise<number> => {
    const company = await companyDAO.create({
      name: mark(suffix),
      slug: mark(suffix).replace(/_/g, "-"),
    } as never);
    const id = company.id ?? 0;
    createdCompanyIds.push(id);
    return id;
  };

  beforeAll(async () => {
    await connectAll();
  });

  // `registerShared`'s own AC-85(b) check compares EVERY company in the
  // database against the snapshot's keeperIds, so a company left over from
  // an earlier `it()` would make the next test's narrower snapshot refuse.
  // Each test therefore starts and ends with the company set IT created —
  // both rows and companies clean up here, not only in `afterAll`.
  afterEach(async () => {
    for (const id of createdTenantRowIds.splice(0)) {
      await db("core")("tenant_databases").where("id", id).del();
    }
    for (const id of createdCompanyIds.splice(0)) {
      await db("core")("tenant_databases").where("companyId", id).del();
      await companyDAO.delete(id);
    }
  });

  afterAll(async () => {
    for (const id of createdCompanyIds.splice(0)) {
      await db("core")("tenant_databases").where("companyId", id).del();
      await companyDAO.delete(id);
    }
    for (const file of snapshotFiles) {
      fs.rmSync(file, { force: true });
    }
    await disconnectAll();
  });

  it("AC-46: registers one active shared-target row per company (>=2), and a second run inserts 0", async () => {
    const a = await makeCompany("a");
    const b = await makeCompany("b");
    const snapshot = writeSnapshot([a, b]);
    snapshotFiles.push(snapshot);

    const first = await registerShared(snapshot);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.registered).toBe(2);
      expect(first.value.alreadyRegistered).toBe(0);
    }

    const rows = await db("core")("tenant_databases")
      .whereIn("companyId", [a, b])
      .select("*");
    createdTenantRowIds.push(...rows.map((row: { id: number }) => row.id));
    expect(rows).toHaveLength(2);
    const coreDatabase = connectionFor("core").database;
    for (const row of rows) {
      expect(row.status).toBe("active");
      expect(row.databaseName).toBe(coreDatabase);
      expect(row.dbUser).toBe(process.env.SQL_USER);
      expect(row.credentialRef).toBe("env:SQL_PASSWORD");
    }

    const second = await registerShared(snapshot);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.registered).toBe(0);
      expect(second.value.alreadyRegistered).toBe(2);
    }

    // "every companies row has exactly one live row"
    const stillOne = await db("core")("tenant_databases")
      .whereIn("companyId", [a, b])
      .whereIn("status", ["active", "suspended", "decommissioning"]);
    expect(stillOne).toHaveLength(2);
  }, 30000);

  /**
   * Orchestrator T7/D-orch-1: `tenant_databases_server_database_name_unique`
   * is now partial (`WHERE "databaseName" LIKE 'tenant\_%'`) — DEDICATED rows
   * (D-70's `tenant_<id>_<slug>` names) still collide on `(serverId,
   * databaseName)`; shared-target C1 rows (databaseName = the core
   * database's own name) are exempt and may share the pair across every
   * company, which is the whole point of C1 (D-21/D-31).
   */
  it("two DEDICATED rows on the same (serverId, databaseName) still collide with 23505", async () => {
    const a = await makeCompany("dedicated-a");
    const b = await makeCompany("dedicated-b");
    const server = await new DbServerDAO().getDefaultPlacement();
    if (!server) throw new Error("no default-placement db_servers row");

    const [rowA] = await db("core")("tenant_databases")
      .insert({
        uuid: "30000000-0000-4000-8000-000000000001",
        companyId: a,
        serverId: server.id,
        databaseName: `tenant_${a}_dedicated`,
        dbUser: `tenant_${a}_dedicated_user`,
        credentialRef: "env:SQL_PASSWORD",
        status: "active",
      })
      .returning("id");
    createdTenantRowIds.push(rowA.id as number);

    await expect(
      db("core")("tenant_databases").insert({
        uuid: "30000000-0000-4000-8000-000000000002",
        companyId: b,
        serverId: server.id,
        databaseName: `tenant_${a}_dedicated`, // same dedicated name, wrong company
        dbUser: `tenant_${a}_dedicated_user`,
        credentialRef: "env:SQL_PASSWORD",
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "23505" });
  }, 30000);

  it("two SHARED-TARGET rows for two companies succeed on the same (serverId, databaseName)", async () => {
    const a = await makeCompany("shared-a");
    const b = await makeCompany("shared-b");

    const result = await registerShared(writeSnapshot([a, b]));

    expect(result.ok).toBe(true);
    const rows = await db("core")("tenant_databases").whereIn("companyId", [
      a,
      b,
    ]);
    createdTenantRowIds.push(...rows.map((row: { id: number }) => row.id));
    expect(rows).toHaveLength(2);
    expect(
      new Set(rows.map((row: { databaseName: string }) => row.databaseName))
        .size,
    ).toBe(1);
  }, 30000);

  it("AC-85(b): refuses when companies do not match the snapshot's keeperIds", async () => {
    const a = await makeCompany("mismatch-a");
    const snapshot = writeSnapshot([a, 999999999]); // an id that is not a real company
    snapshotFiles.push(snapshot);

    const result = await registerShared(snapshot);

    expect(result.ok).toBe(false);
    const rows = await db("core")("tenant_databases").where("companyId", a);
    expect(rows).toHaveLength(0);
  }, 30000);

  it("AC-85(c): refuses once any row's physical target differs from core (a C2 move already happened)", async () => {
    const a = await makeCompany("moved-a");
    const b = await makeCompany("moved-b");
    const server = await new DbServerDAO().getDefaultPlacement();
    if (!server) throw new Error("no default-placement db_servers row");

    // Simulate company a already moved (C2) to a dedicated database.
    const [movedRow] = await db("core")("tenant_databases")
      .insert({
        uuid: "10000000-0000-4000-8000-000000000001",
        companyId: a,
        serverId: server.id,
        databaseName: `tenant_${a}_moved`,
        dbUser: `tenant_${a}_moved_user`,
        credentialRef: "env:SQL_PASSWORD",
        status: "active",
      })
      .returning("id");
    createdTenantRowIds.push(movedRow.id as number);

    const snapshot = writeSnapshot([a, b]);
    snapshotFiles.push(snapshot);

    const result = await registerShared(snapshot);

    expect(result.ok).toBe(false);
    // b must not have been registered either — the whole run refuses.
    const bRows = await db("core")("tenant_databases").where("companyId", b);
    expect(bRows).toHaveLength(0);
  }, 30000);
});

describe("runTenantRegisterShared — CLI argument parsing (AC-85(a))", () => {
  const deps = (): RegisterSharedCliDeps & {
    outLines: string[];
    errLines: string[];
  } => {
    const outLines: string[] = [];
    const errLines: string[] = [];
    return {
      outLines,
      errLines,
      register: async () => ({
        ok: true,
        value: { registered: 0, alreadyRegistered: 0 },
      }),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
    };
  };

  it("exits 2 with 0 rows written when --snapshot is absent", async () => {
    const d = deps();
    let registerCalled = false;
    d.register = async () => {
      registerCalled = true;
      return { ok: true, value: { registered: 0, alreadyRegistered: 0 } };
    };

    const code = await runTenantRegisterShared([], d);

    expect(code).toBe(2);
    expect(registerCalled).toBe(false);
    expect(d.errLines.join("\n")).toContain("--snapshot is required");
  });

  it("exits 1 and prints the reason when the service refuses", async () => {
    const d = deps();
    d.register = async () => ({ ok: false, reason: "companies do not match" });

    const code = await runTenantRegisterShared(["--snapshot", "x.json"], d);

    expect(code).toBe(1);
    expect(d.errLines.join("\n")).toContain("companies do not match");
  });

  it("exits 0 and reports counts on success", async () => {
    const d = deps();
    d.register = async () => ({
      ok: true,
      value: { registered: 3, alreadyRegistered: 1 },
    });

    const code = await runTenantRegisterShared(["--snapshot", "x.json"], d);

    expect(code).toBe(0);
    expect(d.outLines.join("\n")).toContain("registered 3");
  });
});
