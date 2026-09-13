import fs from "fs";
import path from "path";
import readline from "readline";
import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../database/registry";
import { connectionFor } from "../database/env";
import { EXPLICITLY_PURGED_TABLES } from "../services/company-purge.service";
import {
  PurgeObjectStore,
  PurgeRefusedError,
  SNAPSHOT_ID_METADATA_KEY,
  buildInfoPathFor,
  checkNoOtherBackends,
  defaultCommitSources,
  parseCliArgs,
  parseS3Url,
  readSnapshotFile,
  resolveImageCommit,
  runAsCli,
  snapshotFileName,
  takeSnapshot,
  writeSnapshotIdSidecar,
  type CommitSources,
  type PurgeSnapshot,
} from "../services/purge-snapshot.service";

/**
 * State P, step 1 (model D-65, brief D-75):
 *
 *   node dist/scripts/db-snapshot-counts.js --keepers <uuid…> --out <dir> [--hold]
 *   node dist/scripts/db-snapshot-counts.js upload --dump <file> --snapshot <json> --to s3://<bucket>/<key>
 *
 * `--hold` keeps the exporting transaction open until Enter, so the dump the
 * operator takes meanwhile is paired with these counts.
 */

export type SnapshotCliDeps = {
  knex: () => Knex;
  store: PurgeObjectStore;
  commitSources: CommitSources;
  explicitlyPurgedTables: readonly string[];
  now: () => Date;
  waitForRelease: (
    snapshot: PurgeSnapshot,
    dumpCommand: string,
  ) => Promise<void>;
  out: (line: string) => void;
  err: (line: string) => void;
};

const FLAGS = {
  keepers: "list",
  out: "single",
  hold: "boolean",
  dump: "single",
  snapshot: "single",
  to: "single",
} as const;

const USAGE =
  "usage: db-snapshot-counts --keepers <uuid…> --out <dir> [--hold] | upload --dump <file> --snapshot <json> --to s3://<bucket>/<key>";

async function capture(
  flags: Map<string, string[]>,
  deps: SnapshotCliDeps,
): Promise<number> {
  const keeperUuids = flags.get("keepers") ?? [];
  const outDir = flags.get("out")?.[0];
  if (keeperUuids.length === 0 || !outDir) {
    deps.err(USAGE);
    return 2;
  }
  const knex = deps.knex();
  const alone = await checkNoOtherBackends(knex);
  if (!alone.ok) {
    deps.err(`db-snapshot-counts: refusing: ${alone.reason}`);
    return 1;
  }
  const commit = resolveImageCommit(deps.commitSources);
  if (!commit.ok) {
    deps.err(`db-snapshot-counts: refusing: ${commit.reason}`);
    return 1;
  }
  if (!deps.store.filesBucket && deps.commitSources.production) {
    deps.err(
      "db-snapshot-counts: refusing: S3_FILES_BUCKET is not set in production",
    );
    return 1;
  }
  const s3Prefixes = await deps.store.companyPrefixes();

  let held;
  try {
    held = await takeSnapshot(knex, {
      keeperUuids,
      imageCommit: commit.value,
      s3Prefixes,
      explicitlyPurgedTables: deps.explicitlyPurgedTables,
      now: deps.now,
    });
  } catch (error) {
    if (error instanceof PurgeRefusedError) {
      deps.err(`db-snapshot-counts: refusing: ${error.message}`);
      return 1;
    }
    throw error;
  }

  try {
    const { snapshot } = held;
    const file = path.join(outDir, snapshotFileName(snapshot.takenAt));
    if (fs.existsSync(file)) {
      // L-017: an earlier attempt's snapshot is evidence; a re-attempt gets a new directory.
      deps.err(
        `db-snapshot-counts: refusing: ${file} already exists; use a fresh --out directory`,
      );
      return 1;
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);

    const scopedRows = Object.values(snapshot.counts.scoped).reduce(
      (total, perKeeper) =>
        total + Object.values(perKeeper).reduce((a, n) => a + n, 0),
      0,
    );
    deps.out(`snapshot file: ${file}`);
    deps.out(`snapshotId: ${snapshot.snapshotId}`);
    deps.out(
      `takenAt: ${snapshot.takenAt}  imageCommit: ${snapshot.imageCommit}`,
    );
    deps.out(
      `keeperIds: [${snapshot.keeperIds.join(", ")}]  companies: ${snapshot.counts.companies.length}`,
    );
    deps.out(
      `scoped tables: ${Object.keys(snapshot.counts.scoped).length}  keeper rows: ${scopedRows}`,
    );
    deps.out(`attribution tuples: ${snapshot.attributionTuples.length}`);

    if (flags.has("hold")) {
      const { user, database } = connectionFor("core");
      const dumpCommand = `docker exec traffic-postgres pg_dump -Fc --snapshot=${snapshot.snapshotId} -U ${user ?? "<user>"} ${database} > ${path.join(outDir, `${database}.pre-purge.dump`)}`;
      deps.out("holding the snapshot open; take the paired dump now:");
      deps.out(`  ${dumpCommand}`);
      await deps.waitForRelease(snapshot, dumpCommand);
    }
    return 0;
  } finally {
    await held.release();
  }
}

async function upload(
  flags: Map<string, string[]>,
  deps: SnapshotCliDeps,
): Promise<number> {
  const dump = flags.get("dump")?.[0];
  const snapshotFile = flags.get("snapshot")?.[0];
  const to = flags.get("to")?.[0];
  const target = to ? parseS3Url(to) : null;
  if (!dump || !snapshotFile || !target || target.prefix === "") {
    deps.err(USAGE);
    return 2;
  }
  const snapshot = readSnapshotFile(snapshotFile);
  if (!snapshot.ok) {
    deps.err(`db-snapshot-counts upload: refusing: ${snapshot.reason}`);
    return 1;
  }
  if (!fs.existsSync(dump)) {
    deps.err(`db-snapshot-counts upload: refusing: ${dump} does not exist`);
    return 1;
  }
  await deps.store.upload(dump, target, {
    [SNAPSHOT_ID_METADATA_KEY]: snapshot.value.snapshotId,
  });
  writeSnapshotIdSidecar(dump, snapshot.value.snapshotId);
  deps.out(
    `uploaded ${dump} → ${to} (x-amz-meta-${SNAPSHOT_ID_METADATA_KEY}=${snapshot.value.snapshotId})`,
  );
  return 0;
}

export async function runDbSnapshotCounts(
  argv: readonly string[],
  deps: SnapshotCliDeps,
): Promise<number> {
  const parsed = parseCliArgs(argv, FLAGS, ["upload"]);
  if (!parsed.ok || parsed.value.positionals.length > 0) {
    deps.err(parsed.ok ? USAGE : `${parsed.reason}\n${USAGE}`);
    return 2;
  }
  return parsed.value.command === "upload"
    ? upload(parsed.value.flags, deps)
    : capture(parsed.value.flags, deps);
}

const waitForEnter = (
  _snapshot: PurgeSnapshot,
  _dumpCommand: string,
): Promise<void> =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      "press Enter once the dump has finished to release the snapshot… ",
      () => {
        rl.close();
        resolve();
      },
    );
  });

if (require.main === module) {
  const argv = process.argv.slice(2);
  const store = PurgeObjectStore.fromEnv();
  void runAsCli(
    () =>
      runDbSnapshotCounts(argv, {
        knex: () => db("core"),
        store,
        commitSources: defaultCommitSources(buildInfoPathFor(__dirname)),
        explicitlyPurgedTables: EXPLICITLY_PURGED_TABLES,
        now: () => new Date(),
        waitForRelease: waitForEnter,
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      }).finally(() => store.destroy()),
    argv[0] === "upload"
      ? null
      : { connect: connectAll, disconnect: disconnectAll },
  );
}
