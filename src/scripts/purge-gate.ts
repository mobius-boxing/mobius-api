import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../database/registry";
import {
  PurgeObjectStore,
  buildInfoPathFor,
  checkNoOtherBackends,
  defaultCommitSources,
  parseCliArgs,
  readDumpPairing,
  readSnapshotFile,
  resolveArchiveRoot,
  resolveImageCommit,
  runAsCli,
  runPurgeGate,
  type AttributionMode,
  type CommitSources,
} from "../services/purge-snapshot.service";

/**
 * State P, the gate (model D-73, brief D-87), run with the API still stopped:
 *
 *   node dist/scripts/purge-gate.js --snapshot <file> --dump <s3://…|file://…> --keepers <uuid…> [--attribution-mode null|reassigned] [--archive s3://…/backups/purge-<date>/]
 *
 * Exit 0 is the only signal that the API may be started; anything else means
 * the in-window restore from the paired dump (D-63).
 */

export type GateCliDeps = {
  knex: () => Knex;
  store: PurgeObjectStore;
  commitSources: CommitSources;
  out: (line: string) => void;
  err: (line: string) => void;
};

const FLAGS = {
  snapshot: "single",
  dump: "single",
  keepers: "list",
  "attribution-mode": "single",
  archive: "single",
} as const;

const USAGE =
  "usage: purge-gate --snapshot <file> --dump <s3://…|file://…> --keepers <uuid…> [--attribution-mode null|reassigned] [--archive s3://…/backups/purge-<date>/]";

const isAttributionMode = (value: string): value is AttributionMode =>
  value === "null" || value === "reassigned";

export async function runPurgeGateCli(
  argv: readonly string[],
  deps: GateCliDeps,
): Promise<number> {
  const parsed = parseCliArgs(argv, FLAGS);
  const flags = parsed.ok ? parsed.value.flags : new Map<string, string[]>();
  const snapshotFile = flags.get("snapshot")?.[0];
  const dumpUrl = flags.get("dump")?.[0];
  const keeperUuids = flags.get("keepers") ?? [];
  const mode = flags.get("attribution-mode")?.[0] ?? "null";
  if (
    !parsed.ok ||
    parsed.value.positionals.length > 0 ||
    !snapshotFile ||
    !dumpUrl ||
    keeperUuids.length === 0 ||
    !isAttributionMode(mode)
  ) {
    deps.err(parsed.ok ? USAGE : `${parsed.reason}\n${USAGE}`);
    return 2;
  }
  const red = (reason: string): number => {
    deps.err(`purge-gate: RED: ${reason}`);
    return 1;
  };

  const knex = deps.knex();
  const alone = await checkNoOtherBackends(knex);
  if (!alone.ok) return red(`refusing: ${alone.reason}`);

  const snapshot = readSnapshotFile(snapshotFile);
  if (!snapshot.ok) return red(`refusing: ${snapshot.reason}`);
  const commit = resolveImageCommit(deps.commitSources);
  if (!commit.ok) return red(`refusing: ${commit.reason}`);
  const pairing = await readDumpPairing(dumpUrl, deps.store);
  if (!pairing.ok) return red(`refusing: ${pairing.reason}`);
  const archiveRoot = resolveArchiveRoot(flags.get("archive")?.[0], dumpUrl);
  if (!archiveRoot.ok) return red(`refusing: ${archiveRoot.reason}`);

  const verdict = await runPurgeGate(knex, {
    snapshot: snapshot.value,
    keeperUuids,
    mode,
    pairing: pairing.value,
    imageCommit: commit.value,
    store: deps.store,
    archiveRoot: archiveRoot.value,
    production: deps.commitSources.production,
  });
  if (!verdict.ok) return red(verdict.reason);
  deps.out(
    `purge-gate: GREEN: companies = keepers [${snapshot.value.keeperIds.join(", ")}], keeper counts equal the snapshot, ` +
      `${snapshot.value.attributionTuples.length} attribution tuple(s) under --attribution-mode ${mode}`,
  );
  return 0;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const store = PurgeObjectStore.fromEnv();
  void runAsCli(
    () =>
      runPurgeGateCli(argv, {
        knex: () => db("core"),
        store,
        commitSources: defaultCommitSources(buildInfoPathFor(__dirname)),
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      }).finally(() => store.destroy()),
    { connect: connectAll, disconnect: disconnectAll },
  );
}
