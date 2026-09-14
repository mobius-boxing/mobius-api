import type { Knex } from "knex";
import {
  connectAll,
  disconnectAll,
  db,
  rawCoreInstance,
  withTenantTarget,
} from "../database/registry";
import { connectionFor } from "../database/env";
import { TenantDatabaseDAO } from "../dao/tenant-database/tenant-database.dao";
import { CompanyDAO } from "../dao/company/company.dao";
import {
  EXPLICITLY_PURGED_TABLES,
  purgeCompany,
  type CompanyPurgeResult,
} from "../services/company-purge.service";
import {
  PurgeObjectStore,
  buildInfoPathFor,
  checkNoOtherBackends,
  checkPurgePreconditions,
  companyArchivePrefix,
  discoverScopedTables,
  findTablesNotPurged,
  companySourcePrefix,
  defaultCommitSources,
  parseArchiveRoot,
  parseCliArgs,
  readDumpPairing,
  readSnapshotFile,
  resolveArchiveRoot,
  resolveImageCommit,
  runAsCli,
  type CommitSources,
  type PrefixStats,
} from "../services/purge-snapshot.service";

/**
 * State P, the purge (model D-63/D-64, brief D-76/D-82/D-86):
 *
 *   node dist/scripts/purge-companies.js --snapshot <file> --dump <s3://…|file://…> [--archive s3://…/backups/purge-<date>/] <uuid…>
 *   node dist/scripts/purge-companies.js archive-s3 --snapshot <file> --company <uuid> --archive s3://…/backups/purge-<date>/ --copy-only|--delete-source
 *
 * The purge itself is today's `purgeCompany`, unchanged; this file only
 * refuses to reach it unless every I-21 precondition holds.
 */

export type PurgeCliDeps = {
  knex: () => Knex;
  store: PurgeObjectStore;
  commitSources: CommitSources;
  companyIdByUuid: (uuid: string) => Promise<number | null>;
  purge: (companyId: number) => Promise<CompanyPurgeResult>;
  companiesOffSharedTarget: (companyIds: readonly number[]) => Promise<string[]>;
  explicitlyPurgedTables: readonly string[];
  out: (line: string) => void;
  err: (line: string) => void;
};

const FLAGS = {
  snapshot: "single",
  dump: "single",
  archive: "single",
  company: "single",
  "copy-only": "boolean",
  "delete-source": "boolean",
} as const;

const USAGE =
  "usage: purge-companies --snapshot <file> --dump <s3://…|file://…> [--archive s3://…/backups/purge-<date>/] <uuid…>\n" +
  "       purge-companies archive-s3 --snapshot <file> --company <uuid> --archive s3://…/backups/purge-<date>/ --copy-only|--delete-source";

const same = (a: PrefixStats, b: PrefixStats): boolean =>
  a.objects === b.objects && a.bytes === b.bytes;

async function purge(
  flags: Map<string, string[]>,
  targetUuids: readonly string[],
  deps: PurgeCliDeps,
): Promise<number> {
  const snapshotFile = flags.get("snapshot")?.[0];
  const dumpUrl = flags.get("dump")?.[0];
  if (!snapshotFile || !dumpUrl || targetUuids.length === 0) {
    deps.err(USAGE);
    return 2;
  }
  const refused = (reason: string): number => {
    deps.err(`purge-companies: refusing: ${reason}`);
    return 1;
  };

  const knex = deps.knex();
  const alone = await checkNoOtherBackends(knex);
  if (!alone.ok) return refused(alone.reason);

  const snapshot = readSnapshotFile(snapshotFile);
  if (!snapshot.ok) return refused(snapshot.reason);
  const commit = resolveImageCommit(deps.commitSources);
  if (!commit.ok) return refused(commit.reason);
  const pairing = await readDumpPairing(dumpUrl, deps.store);
  if (!pairing.ok) return refused(pairing.reason);
  const archiveRoot = resolveArchiveRoot(flags.get("archive")?.[0], dumpUrl);
  if (!archiveRoot.ok) return refused(archiveRoot.reason);

  const preconditions = await checkPurgePreconditions({
    snapshot: snapshot.value,
    targetUuids,
    pairing: pairing.value,
    imageCommit: commit.value,
    store: deps.store,
    archiveRoot: archiveRoot.value,
    production: deps.commitSources.production,
  });
  if (!preconditions.ok) return refused(preconditions.reason);

  const notPurged = await findTablesNotPurged(
    knex,
    await discoverScopedTables(knex),
    deps.explicitlyPurgedTables,
  );
  if (notPurged.length > 0) {
    return refused(
      `company rows in ${notPurged.join(", ")} are not removed by purgeCompany (no ON DELETE CASCADE from companies, not deleted explicitly)`,
    );
  }

  // Every uuid resolves before the first purge, so a bad argument changes nothing.
  const resolved: { uuid: string; id: number }[] = [];
  for (const uuid of targetUuids) {
    const id = await deps.companyIdByUuid(uuid);
    const expected = snapshot.value.counts.companies.find(
      (c) => c.uuid === uuid,
    )?.id;
    if (id === null)
      return refused(`${uuid} does not resolve to a company in this database`);
    if (id !== expected) {
      return refused(
        `${uuid} resolves to company ${id} here but was company ${String(expected)} in the snapshot`,
      );
    }
    resolved.push({ uuid, id });
  }

  const moved = await deps.companiesOffSharedTarget(
    resolved.map((r) => r.id),
  );
  if (moved.length > 0) {
    return refused(
      `${moved.join(", ")} already live in a dedicated database, which purgeCompany on the shared one would not reach; decommission instead`,
    );
  }

  for (const { uuid, id } of resolved) {
    const result = await deps.purge(id);
    deps.out(JSON.stringify({ uuid, companyId: id, ...result }));
    if (!result.companyDeleted) {
      deps.err(
        `purge-companies: company ${id} (${uuid}) was not deleted; stopping`,
      );
      return 1;
    }
  }
  return 0;
}

async function archiveS3(
  flags: Map<string, string[]>,
  deps: PurgeCliDeps,
): Promise<number> {
  const snapshotFile = flags.get("snapshot")?.[0];
  const uuid = flags.get("company")?.[0];
  const archiveFlag = flags.get("archive")?.[0];
  const copyOnly = flags.has("copy-only");
  const deleteSource = flags.has("delete-source");
  if (!snapshotFile || !uuid || !archiveFlag || copyOnly === deleteSource) {
    deps.err(USAGE);
    return 2;
  }
  const refused = (reason: string): number => {
    deps.err(`purge-companies archive-s3: refusing: ${reason}`);
    return 1;
  };
  const snapshot = readSnapshotFile(snapshotFile);
  if (!snapshot.ok) return refused(snapshot.reason);
  const archiveRoot = parseArchiveRoot(archiveFlag);
  if (!archiveRoot.ok) return refused(archiveRoot.reason);
  const bucket = deps.store.filesBucket;
  if (!bucket) return refused("S3_FILES_BUCKET is not set");
  // Resolved from the snapshot, not the database: after the purge the company row is gone.
  const company = snapshot.value.counts.companies.find((c) => c.uuid === uuid);
  if (!company) return refused(`${uuid} is not a company in the snapshot`);
  if (snapshot.value.keeperIds.includes(company.id)) {
    return refused(
      `${uuid} (company ${company.id}) is a keeper; its files are never archived or deleted here`,
    );
  }

  const source = companySourcePrefix(bucket, company.id);
  const archive = companyArchivePrefix(archiveRoot.value, company.id);
  const where = `s3://${archive.bucket}/${archive.prefix}`;
  const sourceStats = await deps.store.stats(source);

  if (copyOnly) {
    if (sourceStats.objects === 0) {
      deps.out(`companies/${company.id}/ is empty; nothing to archive`);
      return 0;
    }
    await deps.store.copyPrefix(source, archive);
    const archiveStats = await deps.store.stats(archive);
    if (!same(sourceStats, archiveStats)) {
      return refused(
        `copy verification failed: source ${sourceStats.objects}/${sourceStats.bytes}, archive ${archiveStats.objects}/${archiveStats.bytes}`,
      );
    }
    deps.out(
      `archived companies/${company.id}/ → ${where} (${archiveStats.objects} objects, ${archiveStats.bytes} bytes)`,
    );
    return 0;
  }

  const archiveStats = await deps.store.stats(archive);
  if (sourceStats.objects === 0) {
    deps.out(
      `companies/${company.id}/ is already empty; archive holds ${archiveStats.objects} objects, ${archiveStats.bytes} bytes`,
    );
    return 0;
  }
  if (!same(sourceStats, archiveStats)) {
    return refused(
      `no verified copy: companies/${company.id}/ holds ${sourceStats.objects}/${sourceStats.bytes}, ${where} holds ${archiveStats.objects}/${archiveStats.bytes}`,
    );
  }
  await deps.store.deletePrefix(source);
  const remaining = await deps.store.stats(source);
  if (remaining.objects !== 0) {
    return refused(
      `companies/${company.id}/ still holds ${remaining.objects} objects after delete`,
    );
  }
  deps.out(
    `deleted companies/${company.id}/ (${sourceStats.objects} objects, ${sourceStats.bytes} bytes); archive kept at ${where}`,
  );
  return 0;
}

export async function runPurgeCompanies(
  argv: readonly string[],
  deps: PurgeCliDeps,
): Promise<number> {
  const parsed = parseCliArgs(argv, FLAGS, ["archive-s3"]);
  if (!parsed.ok) {
    deps.err(`${parsed.reason}\n${USAGE}`);
    return 2;
  }
  const { command, flags, positionals } = parsed.value;
  if (command === "archive-s3") {
    if (positionals.length > 0) {
      deps.err(USAGE);
      return 2;
    }
    return archiveS3(flags, deps);
  }
  return purge(flags, positionals, deps);
}

export const purgeCompaniesDeps = (
  store: PurgeObjectStore,
): Omit<PurgeCliDeps, "out" | "err"> => ({
  knex: () => db("core"),
  store,
  commitSources: defaultCommitSources(buildInfoPathFor(__dirname)),
  companyIdByUuid: (uuid) => new CompanyDAO().getIdByUuid(uuid),
  // State P runs before C1, so every company still lives in the core
  // database; `companiesOffSharedTarget` refuses one that has already moved.
  purge: (id) =>
    withTenantTarget({ physicalKey: "core", instance: rawCoreInstance() }, () =>
      purgeCompany(id),
    ),
  companiesOffSharedTarget: async (companyIds) => {
    const dao = new TenantDatabaseDAO();
    const shared = connectionFor("core").database;
    const moved: string[] = [];
    for (const id of companyIds) {
      const row = await dao.getLiveByCompanyId(id);
      if (row && row.databaseName !== shared) {
        moved.push(`company ${id} (${row.databaseName})`);
      }
    }
    return moved;
  },
  explicitlyPurgedTables: EXPLICITLY_PURGED_TABLES,
});

if (require.main === module) {
  const argv = process.argv.slice(2);
  const store = PurgeObjectStore.fromEnv();
  void runAsCli(
    () =>
      runPurgeCompanies(argv, {
        ...purgeCompaniesDeps(store),
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      }).finally(() => store.destroy()),
    argv[0] === "archive-s3"
      ? null
      : { connect: connectAll, disconnect: disconnectAll },
  );
}
