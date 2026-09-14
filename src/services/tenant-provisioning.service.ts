import { randomBytes } from "crypto";
import fs from "fs";
import { knex as createKnex } from "knex";
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database/registry";
import { connectionFor, connectionForTenant } from "../database/env";
import {
  resolveCredential,
  sealCredential,
} from "../database/credential-resolver";
import {
  migrationConfigFor,
  migrationsDirectory,
} from "../database/migration-sets";
import { CompanyDAO } from "../dao/company/company.dao";
import { DbServerDAO } from "../dao/db-server/db-server.dao";
import { TenantDatabaseDAO } from "../dao/tenant-database/tenant-database.dao";
import {
  TENANT_DATABASE_LIVE_STATUSES,
  type IDbServer,
  type ITenantDatabase,
} from "../interfaces/tenant/tenant.interfaces";
import { purgeCompany, purgeCompanyCentralOnly } from "./company-purge.service";
import { readSnapshotFile, type Checked } from "./purge-snapshot.service";

/**
 * `registerShared` — state C1 (db-per-company model D-21/D-31, brief D-69,
 * AC-46/AC-85). Registers one `active` `tenant_databases` row per existing
 * company, all pointing at the shared server with the core connection's own
 * identity, so the pool layer dedupes them onto the core instance (D-13) and
 * C1 is bit-identical to today. This is the ONLY write `tenant-provisioning
 * .service.ts` ships in T7 — `provision`/`decommission`/`move` are T9.
 *
 * Reads `db("core")` directly for `tenant_databases`/`db_servers` (neither is
 * a CENTRAL_TABLE per AC-10 — only `companies`/`users`/RBAC/`modules`/
 * `invitations`/`emailTokens` are), so this file needs no CoreClient route.
 * It DOES hold a connection directly (the `pg_roles` introspection and the
 * `db_servers` admin-fields write), hence the `architecture.test.ts`
 * `PERMANENT_NON_DAO_HOLDERS` entry.
 */

type RawTenantDatabaseRow = {
  companyId: number;
  databaseName: string;
  status: string;
};

export type RegisterSharedResult = {
  registered: number;
  alreadyRegistered: number;
};

const sortedNumbers = (values: readonly number[]): number[] =>
  [...values].sort((a, b) => a - b);

const sameIdSet = (a: readonly number[], b: readonly number[]): boolean => {
  const left = sortedNumbers(a);
  const right = sortedNumbers(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
};

/**
 * D-32: fills the shared server's admin identity in on first success, only
 * when the connected role can actually provision (`CREATEDB`+`CREATEROLE`).
 * A no-op once `adminUser` is already set, or when the role still lacks it —
 * a later, more-privileged run of this same command completes it then.
 */
async function grantServerAdminIfPossible(serverId: number): Promise<void> {
  const server = await new DbServerDAO().getById(serverId);
  if (!server || server.adminUser) return;
  const knex = db("core");
  const role = await knex.raw(
    `select rolcreatedb and rolcreaterole as allowed from pg_roles where rolname = current_user`,
  );
  const allowed: boolean = role.rows[0]?.allowed === true;
  if (!allowed) return;
  await knex("db_servers")
    .where("id", serverId)
    .update({
      adminUser: connectionFor("core").user,
      adminCredentialRef: "env:SQL_PASSWORD",
      updatedAt: knex.fn.now(),
    });
}

export async function registerShared(
  snapshotPath: string,
): Promise<Checked<RegisterSharedResult>> {
  const snapshot = readSnapshotFile(snapshotPath);
  if (!snapshot.ok) return snapshot;

  const all = await new CompanyDAO().getAll(1, 1_000_000);
  const companyIds = all.data
    .map((company) => company.id)
    .filter((id): id is number => id !== undefined);

  if (!sameIdSet(companyIds, snapshot.value.keeperIds)) {
    return {
      ok: false,
      reason:
        `companies (${companyIds.length}) do not match the snapshot's ` +
        `keeperIds (${snapshot.value.keeperIds.length}) — AC-85(b)`,
    };
  }

  const server = await new DbServerDAO().getDefaultPlacement();
  if (!server) {
    return { ok: false, reason: "no default-placement db_servers row" };
  }

  const coreConnection = connectionFor("core");
  const existingRows: RawTenantDatabaseRow[] = await db("core")(
    "tenant_databases",
  ).select("companyId", "databaseName", "status");
  const liveRows = existingRows.filter((row) =>
    TENANT_DATABASE_LIVE_STATUSES.includes(
      row.status as (typeof TENANT_DATABASE_LIVE_STATUSES)[number],
    ),
  );
  const movedAway = liveRows.filter(
    (row) => row.databaseName !== coreConnection.database,
  );
  if (movedAway.length > 0) {
    return {
      ok: false,
      reason:
        `${movedAway.length} tenant_databases row(s) already point at a ` +
        `dedicated server — register-shared refuses once any C2 move has ` +
        `happened (AC-85(c), D-71)`,
    };
  }

  const alreadyRegistered = new Set(liveRows.map((row) => row.companyId));
  const tenantDAO = new TenantDatabaseDAO();
  let registered = 0;
  for (const company of all.data) {
    if (company.id === undefined || alreadyRegistered.has(company.id)) {
      continue;
    }
    const created = await tenantDAO.create({
      uuid: uuidv4(),
      companyId: company.id,
      serverId: server.id,
      databaseName: coreConnection.database,
      dbUser: coreConnection.user ?? "",
      credentialRef: "env:SQL_PASSWORD",
      credentialCiphertext: null,
    });
    await tenantDAO.transition(created.id, "provisioning", "active", {
      migrationState: "current",
      provisionedAt: new Date(),
    });
    registered += 1;
  }

  await grantServerAdminIfPossible(server.id);

  return {
    ok: true,
    value: { registered, alreadyRegistered: alreadyRegistered.size },
  };
}

/**
 * Provisioning (model D-19, D-25, D-70; brief AC-50…52). `provisionTenantDatabase`
 * is the whole flow — create-or-resume the row, then run the six steps below —
 * so a fresh call and a retry of a `failed` row are the same function.
 */

/** D-70 CHECK regex, shared by `databaseName` and `dbUser`. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export const TENANT_SLUG_MAX_LENGTH = 40;

export type TenantNaming = { databaseName: string; dbUser: string };

/**
 * D-25: `tenant_<id>_<slug>` / `<databaseName>_user`, the slug's hyphens
 * turned to underscores and cut to 40 chars (brief AC-52) — a trailing cut
 * mid-word can leave a dangling underscore, stripped the same way
 * `toDnsSlug` strips a dangling hyphen.
 */
export function computeTenantNaming(
  companyId: number,
  companySlug: string,
): TenantNaming {
  const converted = companySlug
    .toLowerCase()
    .replace(/-/g, "_")
    .slice(0, TENANT_SLUG_MAX_LENGTH)
    .replace(/_+$/, "");
  const databaseName = `tenant_${companyId}_${converted}`;
  return { databaseName, dbUser: `${databaseName}_user` };
}

function assertSafeIdentifier(name: string): void {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`refusing to interpolate unsafe identifier "${name}"`);
  }
}

const quoteIdent = (name: string): string => {
  assertSafeIdentifier(name);
  return `"${name}"`;
};

function sslFor(server: IDbServer): false | { rejectUnauthorized: true } {
  return server.sslMode === "disable" ? false : { rejectUnauthorized: true };
}

async function openAdminClient(
  server: IDbServer,
): Promise<InstanceType<typeof Client>> {
  if (!server.adminUser || !server.adminCredentialRef) {
    throw new Error(
      `db_servers "${server.name}": not provisionable (no adminUser) — SERVER_NOT_PROVISIONABLE`,
    );
  }
  const password = await resolveCredential(
    server.adminCredentialRef,
    server.adminCredentialCiphertext,
  );
  const client = new Client({
    host: server.host ?? process.env.SQL_HOST,
    port: server.port ?? (Number(process.env.SQL_PORT) || 5432),
    user: server.adminUser,
    password,
    database: "postgres",
    ssl: sslFor(server),
  });
  await client.connect();
  return client;
}

/** D-70: refuses before any `CREATE` is ever issued for this pair. */
async function findNameCollision(
  server: IDbServer,
  databaseName: string,
  dbUser: string,
): Promise<string | null> {
  const admin = await openAdminClient(server);
  try {
    const [dbHit, roleHit] = await Promise.all([
      admin.query("select 1 from pg_database where datname = $1", [
        databaseName,
      ]),
      admin.query("select 1 from pg_roles where rolname = $1", [dbUser]),
    ]);
    if ((dbHit.rowCount ?? 0) > 0) {
      return `database "${databaseName}" already exists on server "${server.name}" (D-70 collision guard)`;
    }
    if ((roleHit.rowCount ?? 0) > 0) {
      return `role "${dbUser}" already exists on server "${server.name}" (D-70 collision guard)`;
    }
    return null;
  } finally {
    await admin.end();
  }
}

/** The newest tenant migration filename shipped in this image (model, I-7). */
export const latestTenantMigrationFile = (): string => {
  const files = fs
    .readdirSync(migrationsDirectory("tenant"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".js"))
    .sort();
  const latest = files[files.length - 1];
  if (!latest) {
    throw new Error("No tenant migration files found in migrations/tenant/");
  }
  return latest;
};

export type ProvisioningStep =
  | "role"
  | "database"
  | "revoke"
  | "pins"
  | "migrate"
  | "seed";

export type ProvisionHooks = {
  /** Test seam (AC-51): fires only when a CREATE is actually about to run —
   * never on a step whose existence check found the object already there. */
  onCreate?: (step: "role" | "database") => void;
  /** Test seam (AC-51): throws right after a step's real effect completed, to
   * prove a crash mid-provisioning resumes without repeating destructive work. */
  failAfter?: ProvisioningStep;
};

const maybeFail = (hooks: ProvisionHooks, step: ProvisioningStep): void => {
  if (hooks.failAfter === step) {
    throw new Error(`injected fault after provisioning step "${step}"`);
  }
};

async function ensureRole(
  admin: InstanceType<typeof Client>,
  roleName: string,
  password: string,
  hooks: ProvisionHooks,
): Promise<void> {
  assertSafeIdentifier(roleName);
  const exists = await admin.query(
    "select 1 from pg_roles where rolname = $1",
    [roleName],
  );
  if ((exists.rowCount ?? 0) > 0) return;
  hooks.onCreate?.("role");
  // `password` is generated by this file (`randomBytes(...).toString("base64url")`),
  // never user input, and base64url's alphabet has no quote/backslash to escape —
  // CREATE ROLE is a utility statement that node-pg cannot bind parameters into.
  await admin.query(
    `CREATE ROLE ${quoteIdent(roleName)} LOGIN PASSWORD '${password}'`,
  );
}

async function ensureDatabase(
  admin: InstanceType<typeof Client>,
  databaseName: string,
  owner: string,
  hooks: ProvisionHooks,
): Promise<void> {
  assertSafeIdentifier(databaseName);
  assertSafeIdentifier(owner);
  const exists = await admin.query(
    "select 1 from pg_database where datname = $1",
    [databaseName],
  );
  if ((exists.rowCount ?? 0) > 0) return;
  hooks.onCreate?.("database");
  await admin.query(
    `CREATE DATABASE ${quoteIdent(databaseName)} OWNER ${quoteIdent(owner)}`,
  );
}

/** Steps 1…4 (role, database, revoke, pins) — all against the admin connection. */
async function runAdminSteps(
  row: ITenantDatabase,
  server: IDbServer,
  password: string,
  companyUuid: string,
  hooks: ProvisionHooks,
): Promise<void> {
  const admin = await openAdminClient(server);
  try {
    await ensureRole(admin, row.dbUser, password, hooks);
    maybeFail(hooks, "role");

    await ensureDatabase(admin, row.databaseName, row.dbUser, hooks);
    maybeFail(hooks, "database");

    // REVOKE and ALTER DATABASE SET are idempotent to reissue — no existence
    // check needed for the retry path to stay a single CREATE overall.
    await admin.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdent(row.databaseName)} FROM PUBLIC`,
    );
    maybeFail(hooks, "revoke");

    await admin.query(
      `ALTER DATABASE ${quoteIdent(row.databaseName)} SET mobius.company_id = '${row.companyId}'`,
    );
    await admin.query(
      `ALTER DATABASE ${quoteIdent(row.databaseName)} SET mobius.company_uuid = '${companyUuid}'`,
    );
    maybeFail(hooks, "pins");
  } finally {
    await admin.end();
  }
}

/** Steps 5…6 (migrate, seed) — against the new database itself, as its owner. */
async function runTenantSteps(
  row: ITenantDatabase,
  server: IDbServer,
  password: string,
  hooks: ProvisionHooks,
): Promise<string> {
  const tenantKnex = createKnex({
    ...migrationConfigFor("tenant", connectionForTenant(row, server, password)),
    pool: { min: 0, max: 2 },
  });
  try {
    await tenantKnex.migrate.latest();
    maybeFail(hooks, "migrate");

    await tenantKnex.seed.run();
    maybeFail(hooks, "seed");

    const head = await tenantKnex("knex_migrations")
      .orderBy("id", "desc")
      .first("name");
    return (head?.name as string | undefined) ?? latestTenantMigrationFile();
  } finally {
    await tenantKnex.destroy();
  }
}

export type ProvisionOptions = {
  serverUuid?: string;
  /**
   * T10/D-1: `POST /companies`'s auto-provision (model D-19 — "company creation
   * never fails because of provisioning") needs a row created even against a
   * server that is not currently accepting placements, so the eventual failure
   * is a visible `failed` row rather than no row at all. The explicit
   * `.../provision` endpoint never sets this: it answers 409 synchronously
   * instead (brief AC-59), which is what a superAdmin calling it needs.
   */
  deferServerPreconditions?: boolean;
};

export type ProvisionResult =
  | { ok: true; row: ITenantDatabase }
  | { ok: false; reason: string; row: ITenantDatabase | null };

/** T10's discriminant for routing a `beginProvisioning` failure to its HTTP code (model). */
export type ProvisionFailureCode =
  | "COMPANY_NOT_FOUND"
  | "SERVER_NOT_FOUND"
  | "SERVER_NOT_ACCEPTING"
  | "SERVER_NOT_PROVISIONABLE"
  | "TENANT_DB_ALREADY_PROVISIONED";

async function resolveProvisioningServer(
  options: ProvisionOptions,
): Promise<IDbServer | { failure: string; code: ProvisionFailureCode }> {
  const dbServerDAO = new DbServerDAO();
  const server = options.serverUuid
    ? await dbServerDAO.getByUuid(options.serverUuid)
    : await dbServerDAO.getDefaultPlacement();
  if (!server)
    return {
      failure: "no such db_servers row (SERVER_NOT_FOUND)",
      code: "SERVER_NOT_FOUND",
    };
  if (options.deferServerPreconditions) return server;
  if (server.status !== "active") {
    return {
      failure: `db_servers "${server.name}" is ${server.status} (SERVER_NOT_ACCEPTING)`,
      code: "SERVER_NOT_ACCEPTING",
    };
  }
  if (!server.adminUser) {
    return {
      failure: `db_servers "${server.name}" has no adminUser (SERVER_NOT_PROVISIONABLE)`,
      code: "SERVER_NOT_PROVISIONABLE",
    };
  }
  return server;
}

/**
 * T10/D-1 (self-approved amendment, reported at close-out): `provisionTenantDatabase`
 * split into `beginProvisioning` (row lookup/creation only — no network round trip to
 * a real server) and `runProvisioningSteps` (the admin/tenant work), so the HTTP
 * `provision` endpoint can satisfy model D-19 / brief AC-59 (202 with the row's real,
 * already-persisted `"provisioning"` state) without either duplicating this file's
 * row-creation logic in the controller or repurposing the test-only `ProvisionHooks`
 * seam for production control flow. `provisionTenantDatabase` itself is unchanged in
 * signature and behavior — every existing caller (T9's DB/unit tests) still awaits one
 * call and gets the exact same final `ProvisionResult`.
 */
export type BeginProvisioningResult =
  | {
      ok: true;
      row: ITenantDatabase;
      server: IDbServer;
      companyUuid: string;
      /** false only for the D-70 collision path: a `failed` row was created and there is nothing left to run. */
      needsRun: boolean;
    }
  | {
      ok: false;
      code: ProvisionFailureCode;
      reason: string;
      row: ITenantDatabase | null;
    };

export async function beginProvisioning(
  companyId: number,
  options: ProvisionOptions = {},
): Promise<BeginProvisioningResult> {
  const tenantDAO = new TenantDatabaseDAO();
  const companyDAO = new CompanyDAO();

  const live = await tenantDAO.getLiveByCompanyId(companyId);
  if (live) {
    return {
      ok: false,
      code: "TENANT_DB_ALREADY_PROVISIONED",
      reason: `tenant_databases already has a live row (status "${live.status}") — TENANT_DB_ALREADY_PROVISIONED`,
      row: live,
    };
  }

  const server = await resolveProvisioningServer(options);
  if ("failure" in server)
    return { ok: false, code: server.code, reason: server.failure, row: null };

  const company = await companyDAO.getById(companyId);
  if (!company || company.id === undefined) {
    return {
      ok: false,
      code: "COMPANY_NOT_FOUND",
      reason: "no such company (COMPANY_NOT_FOUND)",
      row: null,
    };
  }
  const companyUuid = company.uuid ?? "";

  let row = await tenantDAO.getBuildingByCompanyId(companyId);
  if (!row) {
    const naming = computeTenantNaming(
      companyId,
      company.slug ?? String(companyId),
    );
    // A not-yet-provisionable server (deferred preconditions) has no admin
    // connection to check a collision against — `findNameCollision` would
    // throw the very "not provisionable" error this branch exists to turn
    // into a `failed` row instead of a lost company-create request.
    const canCheckCollision = server.status === "active" && !!server.adminUser;
    const collision = canCheckCollision
      ? await findNameCollision(server, naming.databaseName, naming.dbUser)
      : null;
    if (collision) {
      const created = await tenantDAO.create({
        uuid: uuidv4(),
        companyId,
        serverId: server.id,
        databaseName: naming.databaseName,
        dbUser: naming.dbUser,
        credentialRef: "env:SQL_PASSWORD", // placeholder — no role/credential was ever created
        credentialCiphertext: null,
      });
      await tenantDAO.transition(created.id, "provisioning", "failed", {
        lastMigrationError: collision,
      });
      const failedRow = await tenantDAO.getById(created.id);
      return {
        ok: true,
        row: failedRow as ITenantDatabase,
        server,
        companyUuid,
        needsRun: false,
      };
    }
    const password = randomBytes(24).toString("base64url");
    const sealed = sealCredential(password);
    row = await tenantDAO.create({
      uuid: uuidv4(),
      companyId,
      serverId: server.id,
      databaseName: naming.databaseName,
      dbUser: naming.dbUser,
      credentialRef: sealed.ref,
      credentialCiphertext: sealed.ciphertext,
    });
  } else if (row.status === "failed") {
    await tenantDAO.transition(row.id, "failed", "provisioning");
    row = (await tenantDAO.getById(row.id)) as ITenantDatabase;
  }

  return { ok: true, row, server, companyUuid, needsRun: true };
}

/**
 * Runs the admin+tenant provisioning steps for a row `beginProvisioning` already
 * created/resumed, and transitions it to its final `active`/`failed` state. Safe to
 * call without awaiting from an HTTP handler (D-19's "in-process, asynchronously") —
 * every outcome, including a thrown step, ends in a `transition()` call, never an
 * unhandled rejection the caller must catch to stay correct.
 */
export async function runProvisioningSteps(
  row: ITenantDatabase,
  server: IDbServer,
  companyUuid: string,
  hooks: ProvisionHooks = {},
): Promise<ProvisionResult> {
  const tenantDAO = new TenantDatabaseDAO();
  try {
    const password = await resolveCredential(
      row.credentialRef,
      row.credentialCiphertext,
    );
    await runAdminSteps(row, server, password, companyUuid, hooks);
    const schemaVersion = await runTenantSteps(row, server, password, hooks);
    await tenantDAO.transition(row.id, "provisioning", "active", {
      schemaVersion,
      migrationState: "current",
      provisionedAt: new Date(),
    });
    return {
      ok: true,
      row: (await tenantDAO.getById(row.id)) as ITenantDatabase,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await tenantDAO.transition(row.id, "provisioning", "failed", {
      lastMigrationError: message,
    });
    return { ok: false, reason: message, row: await tenantDAO.getById(row.id) };
  }
}

/**
 * Provision (or retry-provision) a dedicated tenant database for `companyId`
 * (model D-19; brief AC-50…52). Idempotent (I-11): a fresh call creates the
 * row and both the role and database exactly once; a retry of a `failed` row
 * resumes at the first incomplete step, never repeating a completed CREATE.
 *
 * Kept as a single awaited call for CLI/test callers (T9); the HTTP `provision`
 * endpoint calls `beginProvisioning`/`runProvisioningSteps` separately instead (T10/D-1).
 */
export async function provisionTenantDatabase(
  companyId: number,
  options: ProvisionOptions = {},
  hooks: ProvisionHooks = {},
): Promise<ProvisionResult> {
  const prepared = await beginProvisioning(companyId, options);
  if (!prepared.ok) return prepared;
  if (!prepared.needsRun)
    return {
      ok: false,
      reason: prepared.row?.lastMigrationError ?? "provisioning failed",
      row: prepared.row,
    };
  return runProvisioningSteps(
    prepared.row,
    prepared.server,
    prepared.companyUuid,
    hooks,
  );
}

/**
 * Decommission (model D-20, D-38, I-14; brief AC-55). Exactly one path per
 * tenant: a shared-target row (C1/C2) gets the existing hook-based
 * `purgeCompany` (its "tenant" plane IS core), a dedicated row gets parked
 * (renamed, role NOLOGIN — never dropped) plus `purgeCompanyCentralOnly`,
 * since its business rows leave with the whole parked database, not one by
 * one. The row is deleted last, after park/purge succeed (I-14): a fault
 * before that leaves `decommissioning`, and a rerun completes.
 */

export type DecommissionHooks = {
  /** Park+revoke are separate statements; the purge-and-row-delete step that
   * follows is one transaction (I-14), so there is no "after purge, before
   * the row delete" state left to inject a fault into. */
  failAfter?: "park" | "roleNoLogin";
};

export type DecommissionResult =
  | { ok: true; companyDeleted: boolean }
  | { ok: false; reason: string };

const PARKED_PREFIX = "zz_decommissioned_";
/** Room for `_<yyyymmdd>` (9 chars) under the 63-char identifier ceiling. */
const PARKED_NAME_MAX = 63 - "_yyyymmdd".length;

const parkedDatabaseName = (databaseName: string, today: string): string => {
  const budget = PARKED_NAME_MAX - PARKED_PREFIX.length;
  const body = databaseName.slice(0, Math.max(0, budget));
  return `${PARKED_PREFIX}${body}_${today}`;
};

const todayStamp = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
};

async function parkDedicatedDatabase(
  row: ITenantDatabase,
  server: IDbServer,
): Promise<void> {
  const admin = await openAdminClient(server);
  try {
    const stillLive = await admin.query(
      "select 1 from pg_database where datname = $1",
      [row.databaseName],
    );
    if ((stillLive.rowCount ?? 0) === 0) return; // I-11: already parked by an earlier attempt
    const parked = parkedDatabaseName(row.databaseName, todayStamp());
    assertSafeIdentifier(row.databaseName);
    await admin.query(
      `ALTER DATABASE ${quoteIdent(row.databaseName)} RENAME TO ${quoteIdent(parked)}`,
    );
  } finally {
    await admin.end();
  }
}

async function revokeDedicatedLogin(
  row: ITenantDatabase,
  server: IDbServer,
): Promise<void> {
  const admin = await openAdminClient(server);
  try {
    await admin.query(`ALTER ROLE ${quoteIdent(row.dbUser)} NOLOGIN`);
  } finally {
    await admin.end();
  }
}

export async function decommissionTenantDatabase(
  companyId: number,
  hooks: DecommissionHooks = {},
): Promise<DecommissionResult> {
  const tenantDAO = new TenantDatabaseDAO();
  const dbServerDAO = new DbServerDAO();

  let row = await tenantDAO.getLiveByCompanyId(companyId);
  if (!row) {
    return {
      ok: false,
      reason: "no live tenant_databases row for this company",
    };
  }

  const coreDatabase = connectionFor("core").database;
  const isSharedTarget = row.databaseName === coreDatabase;

  if (row.status !== "decommissioning") {
    const from = row.status as "active" | "suspended";
    await tenantDAO.transition(row.id, from, "decommissioning");
    row = { ...row, status: "decommissioning" };
  }

  if (isSharedTarget) {
    // I-14: the row is RESTRICT-referenced by companies until it is gone —
    // purgeCompany deletes it inside the same transaction as `companies`.
    const purgeResult = await purgeCompany(companyId, {
      decommissioningTenantDatabaseId: row.id,
    });
    return { ok: true, companyDeleted: purgeResult.companyDeleted };
  }

  const server = await dbServerDAO.getById(row.serverId);
  if (!server) {
    return { ok: false, reason: `db_servers #${row.serverId} not found` };
  }

  await parkDedicatedDatabase(row, server);
  if (hooks.failAfter === "park") {
    throw new Error('injected fault after decommission step "park"');
  }

  await revokeDedicatedLogin(row, server);
  if (hooks.failAfter === "roleNoLogin") {
    throw new Error('injected fault after decommission step "roleNoLogin"');
  }

  const purgeResult = await purgeCompanyCentralOnly(companyId, {
    decommissioningTenantDatabaseId: row.id,
  });
  return { ok: true, companyDeleted: purgeResult.companyDeleted };
}
