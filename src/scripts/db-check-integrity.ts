import { knex as createKnex, type Knex } from "knex";
import {
  connectAll,
  disconnectAll,
  db,
  rawCoreInstance,
  withTenantTarget,
} from "../database/registry";
import { connectionFor, connectionForTenant } from "../database/env";
import { resolveCredential } from "../database/credential-resolver";
import { crossPlaneRefs } from "../database/cross-plane-refs";
import { userReferences } from "../services/company-purge.service";
import { TenantDatabaseDAO } from "../dao/tenant-database/tenant-database.dao";
import { DbServerDAO } from "../dao/db-server/db-server.dao";
import {
  discoverScopedTables,
  discoverSetNullUserColumns,
  findNonKeeperRows,
  parseCliArgs,
  readSnapshotFile,
  type PurgeSnapshot,
} from "../services/purge-snapshot.service";
import type {
  IDbServer,
  ITenantDatabase,
} from "../interfaces/tenant/tenant.interfaces";

/**
 * Referential integrity across the plane boundary, where no foreign key can
 * hold it:
 *
 *   npx ts-node src/scripts/db-check-integrity.ts [--pre-c1 --snapshot <file>]
 *
 * Every tenant column that references a central table — the catalogue's
 * foreign keys (`crossPlaneRefs`) plus the user columns module manifests
 * declare — is read as distinct values in batches, and each batch is looked up
 * in the central table with one `whereIn`. `--pre-c1` adds the C1
 * precondition checks against the state-P snapshot (model D-73, I-19, I-20),
 * built from `purge-snapshot.service`'s discovery and non-keeper checks.
 *
 * Exit 0 clean, 1 on any finding (every one is printed), 2 on usage.
 */

export type PlaneReference = {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
};

export const INTEGRITY_BATCH_SIZE = 1000;

const rowsOf = async <T>(
  knex: Knex,
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> => ((await knex.raw(sql, bindings)) as { rows: T[] }).rows;

const referenceLabel = (ref: PlaneReference): string =>
  `${ref.table}.${ref.column} → ${ref.referencedTable}.${ref.referencedColumn}`;

export async function integrityReferences(
  core: Knex,
): Promise<PlaneReference[]> {
  const references = new Map<string, PlaneReference>();
  const add = (ref: PlaneReference): void => {
    references.set(referenceLabel(ref), ref);
  };
  for (const ref of await crossPlaneRefs(core)) add(ref);
  for (const ref of await userReferences(core)) {
    add({ ...ref, referencedTable: "users", referencedColumn: "id" });
  }
  return [...references.values()];
}

export type OrphanFinding = {
  reference: PlaneReference;
  orphanValues: number;
  sample: string[];
};

const ORPHAN_SAMPLE_SIZE = 5;

/** Distinct values of `ref` in the tenant plane that the central table lacks. */
export async function findOrphans(
  tenant: Knex,
  core: Knex,
  ref: PlaneReference,
  batchSize = INTEGRITY_BATCH_SIZE,
): Promise<OrphanFinding | null> {
  let orphanValues = 0;
  const sample: string[] = [];
  let after: Knex.Value | null = null;
  for (;;) {
    const query = tenant(ref.table)
      .distinct(ref.column)
      .whereNotNull(ref.column)
      .orderBy(ref.column)
      .limit(batchSize);
    if (after !== null) query.where(ref.column, ">", after);
    const values = ((await query) as Record<string, Knex.Value>[]).map(
      (row) => row[ref.column] ?? null,
    );
    if (values.length === 0) break;
    const present = new Set(
      (
        (await core(ref.referencedTable)
          .select(ref.referencedColumn)
          .whereIn(ref.referencedColumn, values)) as Record<string, unknown>[]
      ).map((row) => String(row[ref.referencedColumn])),
    );
    for (const value of values) {
      if (present.has(String(value))) continue;
      orphanValues += 1;
      if (sample.length < ORPHAN_SAMPLE_SIZE) sample.push(String(value));
    }
    if (values.length < batchSize) break;
    after = values[values.length - 1] ?? null;
  }
  return orphanValues > 0 ? { reference: ref, orphanValues, sample } : null;
}

/**
 * The C1 precondition. Keeper row counts are not compared: the keepers write
 * after P. A `SET NULL`→`users` value pointing at a user with no company (a
 * superAdmin acting in a tenant) is not "another company" (T4/D-orch-6).
 */
export async function checkPreC1(
  knex: Knex,
  snapshot: PurgeSnapshot,
): Promise<string[]> {
  const failures: string[] = [];
  const keepers = snapshot.keeperIds;

  const companyIds = (
    await rowsOf<{ id: number }>(knex, "select id from companies order by id")
  ).map((row) => row.id);
  const extra = companyIds.filter((id) => !keepers.includes(id));
  const missing = keepers.filter((id) => !companyIds.includes(id));
  if (extra.length > 0 || missing.length > 0) {
    failures.push(
      `pre-c1 companies: expected exactly the keepers [${keepers.join(", ")}], found [${companyIds.join(", ")}]`,
    );
  }

  const tables = await discoverScopedTables(knex);
  for (const survivor of await findNonKeeperRows(knex, tables, keepers)) {
    failures.push(
      `pre-c1 non-keeper rows: ${survivor.table} (${survivor.via === "warehouse" ? "via warehouse" : "direct"}) ${survivor.rows}`,
    );
  }

  const columns = await discoverSetNullUserColumns(knex, tables);
  for (const tuple of snapshot.attributionTuples) {
    const companyColumn =
      columns.find((c) => c.table === tuple.table && c.column === tuple.column)
        ?.companyColumn ?? null;
    const [row] = await rowsOf<{
      user_id: number | null;
      row_company: number | null;
      user_company: number | null;
      user_exists: boolean;
    }>(
      knex,
      `select t.?? as user_id, ${companyColumn ? "t.??" : "null::int"} as row_company,
              u."companyId" as user_company, u.id is not null as user_exists
         from ?? t left join users u on u.id = t.??
        where t.uuid::text = ?`,
      [
        tuple.column,
        ...(companyColumn ? [companyColumn] : []),
        tuple.table,
        tuple.column,
        tuple.rowUuid,
      ],
    );
    if (!row || row.user_id === null) continue;
    if (!row.user_exists || row.user_company !== row.row_company) {
      failures.push(
        `pre-c1 attribution: ${tuple.table}.${tuple.column} row ${tuple.rowUuid} (was ${tuple.userEmail}) points at user ${row.user_id}, which is not an existing user of the row's company`,
      );
    }
  }

  for (const c of columns) {
    const [row] = await rowsOf<{ missing: number; foreign: number }>(
      knex,
      `select count(*) filter (where u.id is null)::int as missing,
              count(*) filter (where u.id is not null and u."companyId" is not null
                                 and ${c.companyColumn ? `t.?? is not null and u."companyId" <> t.??` : "false"})::int as foreign
         from ?? t left join users u on u.id = t.??
        where t.?? is not null`,
      [
        ...(c.companyColumn ? [c.companyColumn, c.companyColumn] : []),
        c.table,
        c.column,
        c.column,
      ],
    );
    if ((row?.missing ?? 0) > 0 || (row?.foreign ?? 0) > 0) {
      failures.push(
        `pre-c1 user references: ${c.table}.${c.column} has ${row?.missing ?? 0} row(s) pointing at a missing user and ${row?.foreign ?? 0} at a user of another company`,
      );
    }
  }
  return failures;
}

/**
 * Every dedicated tenant's own GUC pin (model I-15, mirrored here as a
 * belt-and-braces check independent of the pool layer's own check at
 * connection-open time).
 */
export async function checkDedicatedTenantPin(
  tenantKnex: Knex,
  row: Pick<ITenantDatabase, "id" | "companyId" | "databaseName">,
): Promise<string | null> {
  const result = (await tenantKnex.raw(
    "select current_setting('mobius.company_id', true) as pin",
  )) as { rows: { pin: string | null }[] };
  const raw = result.rows[0]?.pin ?? null;
  const actual = raw === null || raw === "" ? null : Number(raw);
  if (actual !== row.companyId) {
    return (
      `pin: tenant_databases #${row.id} (${row.databaseName}) expects ` +
      `companyId ${row.companyId}, database reports ${actual === null ? "no pin" : actual}`
    );
  }
  return null;
}

/**
 * I-2: every tenant table with a company column holds only this tenant's own
 * rows. AC-56 — an injected row with a foreign `companyId` names its table.
 */
export async function checkDedicatedTenantRows(
  tenantKnex: Knex,
  row: Pick<ITenantDatabase, "companyId" | "databaseName">,
): Promise<string[]> {
  const tables = await discoverScopedTables(tenantKnex);
  const foreign = await findNonKeeperRows(tenantKnex, tables, [row.companyId]);
  return foreign.map(
    (f) =>
      `pin: ${row.databaseName} (companyId ${row.companyId}) — ${f.table} has ${f.rows} row(s) with a foreign companyId`,
  );
}

const FLEET_LIVE_STATUSES: readonly string[] = [
  "active",
  "suspended",
  "decommissioning",
];
/** I-18's grace window for a company still `provisioning`. */
export const FLEET_COVERAGE_GRACE_MS = 15 * 60 * 1000;

/**
 * I-18 (AC-86): from C1 onward every `companies` row has exactly one live
 * `tenant_databases` row. A `failed` building row always fails; a
 * `provisioning` one within the grace window is a warning, not a failure.
 */
export async function checkFleetCoverage(
  core: Knex,
  now: Date,
): Promise<{ failures: string[]; warnings: string[] }> {
  const companies = await core("companies").select<
    { id: number; uuid: string }[]
  >("id", "uuid");
  const rows = await core("tenant_databases").select<
    { companyId: number; status: string; createdAt: Date }[]
  >("companyId", "status", "createdAt");
  const byCompany = new Map<number, typeof rows>();
  for (const row of rows) {
    byCompany.set(row.companyId, [
      ...(byCompany.get(row.companyId) ?? []),
      row,
    ]);
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  for (const company of companies) {
    const companyRows = byCompany.get(company.id) ?? [];
    if (companyRows.some((r) => FLEET_LIVE_STATUSES.includes(r.status)))
      continue;

    if (companyRows.some((r) => r.status === "failed")) {
      failures.push(
        `fleet coverage: company ${company.uuid} has no live tenant_databases row (a "failed" row always counts as a failure)`,
      );
      continue;
    }
    const provisioning = companyRows.find((r) => r.status === "provisioning");
    if (
      provisioning &&
      now.getTime() - new Date(provisioning.createdAt).getTime() <=
        FLEET_COVERAGE_GRACE_MS
    ) {
      warnings.push(
        `fleet coverage: company ${company.uuid} is still "provisioning" (within the 15-minute grace, I-18)`,
      );
      continue;
    }
    failures.push(
      `fleet coverage: company ${company.uuid} has no live tenant_databases row`,
    );
  }
  return { failures, warnings };
}

export type DedicatedTenantTarget = {
  row: ITenantDatabase;
  server: IDbServer;
};

export type IntegrityCliDeps = {
  core: () => Knex;
  /** The shared/legacy target — pre-cutover, where "tenant" IS core (C0/C1). */
  tenant: () => Knex;
  now: () => Date;
  listDedicatedTenants: () => Promise<DedicatedTenantTarget[]>;
  openTenant: (target: DedicatedTenantTarget) => Promise<Knex>;
  closeTenant: (knex: Knex) => Promise<void>;
  out: (line: string) => void;
  err: (line: string) => void;
  batchSize?: number;
};

const FLAGS = {
  "pre-c1": "boolean",
  snapshot: "single",
  "fleet-coverage": "boolean",
} as const;
const USAGE =
  "usage: db-check-integrity [--pre-c1 --snapshot <purge-snapshot.json>] [--fleet-coverage]";

export async function runDbCheckIntegrity(
  argv: readonly string[],
  deps: IntegrityCliDeps,
): Promise<number> {
  const parsed = parseCliArgs(argv, FLAGS);
  if (!parsed.ok || parsed.value.positionals.length > 0) {
    deps.err(parsed.ok ? USAGE : `${parsed.reason}\n${USAGE}`);
    return 2;
  }
  const preC1 = parsed.value.flags.has("pre-c1");
  const fleetCoverage = parsed.value.flags.has("fleet-coverage");
  const snapshotFile = parsed.value.flags.get("snapshot")?.[0];
  if (preC1 !== (snapshotFile !== undefined) || (preC1 && fleetCoverage)) {
    deps.err(USAGE);
    return 2;
  }
  let snapshot: PurgeSnapshot | null = null;
  if (snapshotFile !== undefined) {
    const read = readSnapshotFile(snapshotFile);
    if (!read.ok) {
      deps.err(`db-check-integrity: refusing: ${read.reason}`);
      return 1;
    }
    snapshot = read.value;
  }

  const findings: string[] = [];
  const warnings: string[] = [];
  const references = await integrityReferences(deps.core());
  let dedicatedCount = 0;

  if (snapshot) {
    // I-18 applies "from C1 onward"; pre-C1 has no dedicated tenant yet.
    findings.push(...(await checkPreC1(deps.core(), snapshot)));
  } else {
    // The shared/legacy target — unchanged since before T9 (C0/C1: "tenant"
    // resolves to core, so this already covers every shared-target company).
    for (const ref of references) {
      const orphans = await findOrphans(
        deps.tenant(),
        deps.core(),
        ref,
        deps.batchSize,
      );
      if (orphans) {
        findings.push(
          `orphans: ${ref.table}.${ref.column} has ${orphans.orphanValues} value(s) missing from ${ref.referencedTable}.${ref.referencedColumn} (e.g. ${orphans.sample.join(", ")})`,
        );
      }
    }

    // T9 AC-56: every DEDICATED tenant, each its own physical database, gets
    // the same orphan check plus the I-2 pin/foreign-companyId check.
    const dedicated = await deps.listDedicatedTenants();
    dedicatedCount = dedicated.length;
    for (const target of dedicated) {
      const tenantKnex = await deps.openTenant(target);
      try {
        for (const ref of references) {
          const orphans = await findOrphans(
            tenantKnex,
            deps.core(),
            ref,
            deps.batchSize,
          );
          if (orphans) {
            findings.push(
              `orphans: ${target.row.databaseName} — ${ref.table}.${ref.column} has ${orphans.orphanValues} value(s) missing from ${ref.referencedTable}.${ref.referencedColumn} (e.g. ${orphans.sample.join(", ")})`,
            );
          }
        }
        const pinFinding = await checkDedicatedTenantPin(
          tenantKnex,
          target.row,
        );
        if (pinFinding) findings.push(pinFinding);
        findings.push(
          ...(await checkDedicatedTenantRows(tenantKnex, target.row)),
        );
      } finally {
        await deps.closeTenant(tenantKnex);
      }
    }
    if (fleetCoverage) {
      // I-18 holds only "from C1 onward" — opt-in so a database that never
      // ran `tenant:register-shared` (every local/CI fixture pre-C1) does not
      // get a false failure per company with no tenant_databases row at all.
      const coverage = await checkFleetCoverage(deps.core(), deps.now());
      findings.push(...coverage.failures);
      warnings.push(...coverage.warnings);
    }
  }

  for (const warning of warnings)
    deps.out(`db-check-integrity: WARNING: ${warning}`);
  for (const finding of findings) deps.err(`db-check-integrity: ${finding}`);
  const dedicatedSuffix =
    dedicatedCount > 0 ? ` across ${dedicatedCount} dedicated tenant(s)` : "";
  deps.out(
    `db-check-integrity: ${findings.length === 0 ? "CLEAN" : `${findings.length} finding(s)`}; ${references.length} cross-plane references checked${dedicatedSuffix}${snapshot ? `; pre-c1 against keepers [${snapshot.keeperIds.join(", ")}]` : ""}`,
  );
  return findings.length === 0 ? 0 : 1;
}

async function realListDedicatedTenants(): Promise<DedicatedTenantTarget[]> {
  const coreDatabase = connectionFor("core").database;
  const tenantDAO = new TenantDatabaseDAO();
  const dbServerDAO = new DbServerDAO();
  const rows = (await tenantDAO.listForFleetMigration()).filter(
    (row) => row.databaseName !== coreDatabase,
  );
  const targets: DedicatedTenantTarget[] = [];
  for (const row of rows) {
    const server = await dbServerDAO.getById(row.serverId);
    if (server) targets.push({ row, server });
  }
  return targets;
}

async function realOpenTenant(target: DedicatedTenantTarget): Promise<Knex> {
  const password = await resolveCredential(
    target.row.credentialRef,
    target.row.credentialCiphertext,
  );
  return createKnex({
    client: "pg",
    connection: connectionForTenant(target.row, target.server, password),
    pool: { min: 0, max: 1 },
  });
}

if (require.main === module) {
  void (async () => {
    try {
      await connectAll();
      // db-per-company (T8, AC-49): `tenant: () => db("tenant")` answers the
      // shared-placement check (a C1 company's target IS the core database,
      // D-31's dedupe) — outside a request that needs an explicit scope now
      // that the fallback is gone. `openTenant`/`closeTenant` are unaffected:
      // they open their own dedicated connection per tenant and never call
      // `db()` at all.
      process.exitCode = await withTenantTarget(
        { physicalKey: "core", instance: rawCoreInstance() },
        () =>
          runDbCheckIntegrity(process.argv.slice(2), {
            core: () => db("core"),
            tenant: () => db("tenant"),
            now: () => new Date(),
            listDedicatedTenants: realListDedicatedTenants,
            openTenant: realOpenTenant,
            closeTenant: (knex) => knex.destroy(),
            out: (line) => console.log(line),
            err: (line) => console.error(line),
          }),
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await disconnectAll();
    }
  })();
}
