import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../database/registry";
import { crossPlaneRefs } from "../database/cross-plane-refs";
import { userReferences } from "../services/company-purge.service";
import {
  discoverScopedTables,
  discoverSetNullUserColumns,
  findNonKeeperRows,
  parseCliArgs,
  readSnapshotFile,
  type PurgeSnapshot,
} from "../services/purge-snapshot.service";

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

export type IntegrityCliDeps = {
  core: () => Knex;
  tenant: () => Knex;
  out: (line: string) => void;
  err: (line: string) => void;
  batchSize?: number;
};

const FLAGS = { "pre-c1": "boolean", snapshot: "single" } as const;
const USAGE =
  "usage: db-check-integrity [--pre-c1 --snapshot <purge-snapshot.json>]";

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
  const snapshotFile = parsed.value.flags.get("snapshot")?.[0];
  if (preC1 !== (snapshotFile !== undefined)) {
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
  const references = await integrityReferences(deps.core());
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
  if (snapshot) findings.push(...(await checkPreC1(deps.core(), snapshot)));

  for (const finding of findings) deps.err(`db-check-integrity: ${finding}`);
  deps.out(
    `db-check-integrity: ${findings.length === 0 ? "CLEAN" : `${findings.length} finding(s)`}; ${references.length} cross-plane references checked${snapshot ? `; pre-c1 against keepers [${snapshot.keeperIds.join(", ")}]` : ""}`,
  );
  return findings.length === 0 ? 0 : 1;
}

if (require.main === module) {
  void (async () => {
    try {
      await connectAll();
      process.exitCode = await runDbCheckIntegrity(process.argv.slice(2), {
        core: () => db("core"),
        tenant: () => db("tenant"),
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await disconnectAll();
    }
  })();
}
