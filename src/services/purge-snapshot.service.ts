import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import type { Knex } from "knex";
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type ListObjectsV2CommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

/**
 * State P (db-per-company model Amendment 1, D-63/D-65/D-73; brief D-74…D-87):
 * snapshot, pairing, purge preconditions and the post-purge gate shared by
 * `db-snapshot-counts`, `purge-companies` and `purge-gate` (and, later,
 * `db-check-integrity --pre-c1`).
 *
 * Every query is raw SQL on the connection the caller hands in, and every table
 * list is discovered from `information_schema` at run time, never hand-listed:
 * P runs on the monolith with live FKs, and the plane rework must not reach
 * this file (D-74).
 */

/** Connections carrying this name are the purge's own and never block it (I-21). */
export const PURGE_APPLICATION_NAME = "mobius-purge";

export type Refusal = { ok: false; reason: string };
export type Verdict = { ok: true } | Refusal;
export type Checked<T> = { ok: true; value: T } | Refusal;

const OK: Verdict = { ok: true };
const refuse = (reason: string): Refusal => ({ ok: false, reason });

export class PurgeRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PurgeRefusedError";
  }
}

export type CompanyRef = { id: number; uuid: string };
export type PrefixStats = { objects: number; bytes: number };
export type AttributionTuple = {
  table: string;
  rowUuid: string;
  column: string;
  userEmail: string;
};
export type AttributionMode = "null" | "reassigned";

const NULL_COMPANY_TABLES = ["users", "invitations", "audit_logs"] as const;
type NullCompanyTable = (typeof NULL_COMPANY_TABLES)[number];

/** Bucket key for rows whose own company column is NULL. */
const NULL_BUCKET = "null";
/** Bucket key for a `SET NULL` column on a table with no company column. */
const UNSCOPED_BUCKET = "all";

export type PurgeSnapshotCounts = {
  companies: CompanyRef[];
  /** table → keeper company id → rows (direct company column, or via `warehouses`). */
  scoped: Record<string, Record<string, number>>;
  nullCompany: Record<NullCompanyTable, number>;
  /** `table.column` (an `ON DELETE SET NULL` FK to `users`) → company bucket → NULL rows. */
  setNullToUsers: Record<string, Record<string, number>>;
  /** company id → its `companies/<id>/` prefix in the files bucket. */
  s3Prefixes: Record<string, PrefixStats>;
};

export type PurgeSnapshot = {
  snapshotId: string;
  takenAt: string;
  imageCommit: string;
  keeperIds: number[];
  counts: PurgeSnapshotCounts;
  attributionTuples: AttributionTuple[];
};

const SNAPSHOT_KEYS = [
  "snapshotId",
  "takenAt",
  "imageCommit",
  "keeperIds",
  "counts",
  "attributionTuples",
];

const rowsOf = async <T>(
  knex: Knex,
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> => ((await knex.raw(sql, bindings)) as { rows: T[] }).rows;

// ==================== CLI plumbing ====================

export type FlagKind = "single" | "list" | "boolean";
export type CliArgs = {
  command: string | null;
  flags: Map<string, string[]>;
  positionals: string[];
};

export function parseCliArgs(
  argv: readonly string[],
  spec: Readonly<Record<string, FlagKind>>,
  subcommands: readonly string[] = [],
): Checked<CliArgs> {
  const tokens = [...argv];
  const command =
    tokens.length > 0 && subcommands.includes(tokens[0] ?? "")
      ? (tokens.shift() ?? null)
      : null;
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];
  while (tokens.length > 0) {
    const token = tokens.shift() ?? "";
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const kind = spec[name];
    if (!kind) return refuse(`unknown flag ${token}`);
    const values: string[] = [];
    if (kind === "single") {
      const value = tokens.shift();
      if (value === undefined || value.startsWith("--")) {
        return refuse(`${token} needs a value`);
      }
      values.push(value);
    } else if (kind === "list") {
      while (tokens.length > 0 && !(tokens[0] ?? "").startsWith("--")) {
        values.push(tokens.shift() ?? "");
      }
      if (values.length === 0)
        return refuse(`${token} needs at least one value`);
    }
    flags.set(name, [...(flags.get(name) ?? []), ...values]);
  }
  return { ok: true, value: { command, flags, positionals } };
}

export type CliLifecycle = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

/**
 * Runs a P script as a process. `PGAPPNAME` is set before the pools exist, so
 * every connection this process opens is excluded from `checkNoOtherBackends`.
 * `lifecycle` is null for subcommands that never touch the database.
 */
export async function runAsCli(
  execute: () => Promise<number>,
  lifecycle: CliLifecycle | null,
): Promise<void> {
  process.env.PGAPPNAME = PURGE_APPLICATION_NAME;
  try {
    if (lifecycle) await lifecycle.connect();
    process.exitCode = await execute();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (lifecycle) await lifecycle.disconnect();
  }
}

// ==================== I-21: nobody else on the database ====================

type Backend = {
  pid: number;
  usename: string | null;
  application_name: string;
  client_addr: string | null;
};

/**
 * The exact-count gate is only sound if nothing but the purge writes between
 * snapshot and gate, so "the API is stopped" is checked here rather than
 * trusted to the runbook (brief D-79). Autovacuum and other background workers
 * are not client backends and never block.
 */
export async function checkNoOtherBackends(knex: Knex): Promise<Verdict> {
  const others = await rowsOf<Backend>(
    knex,
    `select pid, usename, application_name, client_addr::text as client_addr
       from pg_stat_activity
      where datname = current_database()
        and backend_type = 'client backend'
        and pid <> pg_backend_pid()
        and application_name <> ?
      order by pid`,
    [PURGE_APPLICATION_NAME],
  );
  if (others.length === 0) return OK;
  const described = others
    .map(
      (b) =>
        `pid ${b.pid} user=${b.usename ?? "?"} application_name='${b.application_name}' client=${b.client_addr ?? "local"}`,
    )
    .join("; ");
  return refuse(
    `other backends are connected to this database (${described}); stop the API and close every other session first`,
  );
}

// ==================== image commit (D-80) ====================

export type BuildInfo = { commit: string; dirty: boolean; builtAt: string };
export type CommitSources = {
  production: boolean;
  readBuildInfo: () => string | null;
  gitHead: () => string;
};

/** `dist/build-info.json`, written by `deploy-backend.sh` before the tar. */
export const buildInfoPathFor = (scriptDir: string): string =>
  path.resolve(scriptDir, "..", "build-info.json");

export const defaultCommitSources = (buildInfoPath: string): CommitSources => ({
  production: process.env.NODE_ENV === "production",
  readBuildInfo: () =>
    fs.existsSync(buildInfoPath)
      ? fs.readFileSync(buildInfoPath, "utf8")
      : null,
  gitHead: () =>
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
});

const parseBuildInfo = (raw: string): BuildInfo | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { commit, dirty, builtAt } = parsed as Record<string, unknown>;
    if (typeof commit !== "string" || commit.length === 0) return null;
    if (typeof dirty !== "boolean" || typeof builtAt !== "string") return null;
    return { commit, dirty, builtAt };
  } catch {
    return null;
  }
};

export function resolveImageCommit(sources: CommitSources): Checked<string> {
  const raw = sources.readBuildInfo();
  const info = raw === null ? null : parseBuildInfo(raw);
  if (sources.production) {
    if (raw === null) {
      return refuse(
        "dist/build-info.json is absent: this image was not built by deploy-backend.sh",
      );
    }
    if (!info)
      return refuse("dist/build-info.json is not {commit,dirty,builtAt}");
    if (info.dirty) {
      return refuse(
        `dist/build-info.json says the image was built from a dirty tree (commit ${info.commit})`,
      );
    }
    return { ok: true, value: info.commit };
  }
  if (info) return { ok: true, value: info.commit };
  try {
    return { ok: true, value: sources.gitHead() };
  } catch (error) {
    return refuse(
      `no build stamp and git rev-parse HEAD failed: ${String(error)}`,
    );
  }
}

// ==================== object storage ====================

export type S3Location = { bucket: string; prefix: string };
export type S3Send = (command: object) => Promise<unknown>;
type ObjectSummary = { key: string; size: number };

export const parseS3Url = (url: string): S3Location | null => {
  const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(url);
  if (!match || !match[1]) return null;
  return { bucket: match[1], prefix: match[2] ?? "" };
};

const ARCHIVE_ROOT_PATTERN = /^backups\/purge-\d{4}-\d{2}-\d{2}\/$/;

/** `s3://<bucket>/backups/purge-<date>/` — where `companies-<id>/` copies live. */
export function parseArchiveRoot(url: string): Checked<S3Location> {
  const location = parseS3Url(url);
  if (!location || !ARCHIVE_ROOT_PATTERN.test(location.prefix)) {
    return refuse(
      `archive root must look like s3://<bucket>/backups/purge-YYYY-MM-DD/, got '${url}'`,
    );
  }
  return { ok: true, value: location };
}

/**
 * `--archive` when given; otherwise the directory of an `s3://` dump, which
 * D-65 places under the same `backups/purge-<date>/` root. A `file://` dump
 * names no archive root.
 */
export function resolveArchiveRoot(
  archiveFlag: string | undefined,
  dumpUrl: string,
): Checked<S3Location | null> {
  if (archiveFlag !== undefined) return parseArchiveRoot(archiveFlag);
  if (!dumpUrl.startsWith("s3://")) return { ok: true, value: null };
  const dumpDir = dumpUrl.slice(0, dumpUrl.lastIndexOf("/") + 1);
  return parseArchiveRoot(dumpDir);
}

export const companySourcePrefix = (
  bucket: string,
  companyId: number,
): S3Location => ({ bucket, prefix: `companies/${companyId}/` });

export const companyArchivePrefix = (
  root: S3Location,
  companyId: number,
): S3Location => ({
  bucket: root.bucket,
  prefix: `${root.prefix}companies-${companyId}/`,
});

const sameStats = (a: PrefixStats, b: PrefixStats): boolean =>
  a.objects === b.objects && a.bytes === b.bytes;

const describeStats = (s: PrefixStats): string =>
  `${s.objects} objects / ${s.bytes} bytes`;

const isNotFound = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
};

export class PurgeObjectStore {
  constructor(
    private readonly send: S3Send,
    /** `S3_FILES_BUCKET`; null where files live on local disk (dev). */
    readonly filesBucket: string | null,
    private readonly onDestroy: () => void = () => undefined,
  ) {}

  /** Same region/bucket resolution as `FileStorageService`. */
  static fromEnv(): PurgeObjectStore {
    const region = process.env.S3_REGION || process.env.AWS_REGION;
    const client = new S3Client(region ? { region } : {});
    return new PurgeObjectStore(
      (command) => client.send(command as Parameters<S3Client["send"]>[0]),
      process.env.S3_FILES_BUCKET || null,
      () => client.destroy(),
    );
  }

  destroy(): void {
    this.onDestroy();
  }

  async list(location: S3Location): Promise<ObjectSummary[]> {
    const objects: ObjectSummary[] = [];
    let token: string | undefined;
    do {
      const page = (await this.send(
        new ListObjectsV2Command({
          Bucket: location.bucket,
          Prefix: location.prefix,
          ContinuationToken: token,
        }),
      )) as ListObjectsV2CommandOutput;
      for (const item of page.Contents ?? []) {
        if (item.Key) objects.push({ key: item.Key, size: item.Size ?? 0 });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return objects;
  }

  async stats(location: S3Location): Promise<PrefixStats> {
    const objects = await this.list(location);
    return {
      objects: objects.length,
      bytes: objects.reduce((total, o) => total + o.size, 0),
    };
  }

  async companyPrefixes(): Promise<Record<string, PrefixStats>> {
    if (!this.filesBucket) return {};
    const prefixes: Record<string, PrefixStats> = {};
    const objects = await this.list({
      bucket: this.filesBucket,
      prefix: "companies/",
    });
    for (const object of objects) {
      const companyId = object.key.split("/")[1] ?? "";
      const current = prefixes[companyId] ?? { objects: 0, bytes: 0 };
      prefixes[companyId] = {
        objects: current.objects + 1,
        bytes: current.bytes + object.size,
      };
    }
    return prefixes;
  }

  async copyPrefix(from: S3Location, to: S3Location): Promise<void> {
    for (const object of await this.list(from)) {
      const relative = object.key.slice(from.prefix.length);
      // CopySource is `bucket/key` with the key URL-encoded; S3 accepts the
      // slashes literally, and keeping them keeps the source readable in logs.
      const encodedKey = encodeURIComponent(object.key).replace(/%2F/g, "/");
      await this.send(
        new CopyObjectCommand({
          Bucket: to.bucket,
          Key: `${to.prefix}${relative}`,
          CopySource: `${from.bucket}/${encodedKey}`,
        }),
      );
    }
  }

  async deletePrefix(location: S3Location): Promise<void> {
    const objects = await this.list(location);
    for (let start = 0; start < objects.length; start += 1000) {
      const batch = objects.slice(start, start + 1000);
      await this.send(
        new DeleteObjectsCommand({
          Bucket: location.bucket,
          Delete: { Objects: batch.map((o) => ({ Key: o.key })), Quiet: true },
        }),
      );
    }
  }

  async head(
    location: S3Location,
  ): Promise<{ metadata: Record<string, string>; lastModified: Date } | null> {
    try {
      const head = (await this.send(
        new HeadObjectCommand({
          Bucket: location.bucket,
          Key: location.prefix,
        }),
      )) as HeadObjectCommandOutput;
      return {
        metadata: head.Metadata ?? {},
        lastModified: head.LastModified ?? new Date(0),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async upload(
    file: string,
    location: S3Location,
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.send(
      new PutObjectCommand({
        Bucket: location.bucket,
        Key: location.prefix,
        Body: fs.createReadStream(file),
        ContentLength: fs.statSync(file).size,
        Metadata: metadata,
      }),
    );
  }
}

// ==================== snapshot ↔ dump pairing (D-73 (1), D-78) ====================

/** S3 lower-cases user metadata keys; `x-amz-meta-` is stripped by the SDK. */
export const SNAPSHOT_ID_METADATA_KEY = "snapshot-id";

export type DumpPairing = { snapshotId: string | null; modifiedAt: Date };

export const snapshotIdSidecarPath = (dumpPath: string): string =>
  `${dumpPath}.snapshot-id`;

export const writeSnapshotIdSidecar = (
  dumpPath: string,
  snapshotId: string,
): void => fs.writeFileSync(snapshotIdSidecarPath(dumpPath), `${snapshotId}\n`);

export async function readDumpPairing(
  dumpUrl: string,
  store: PurgeObjectStore,
): Promise<Checked<DumpPairing>> {
  if (dumpUrl.startsWith("file://")) {
    const dumpPath = fileURLToPath(dumpUrl);
    if (!fs.existsSync(dumpPath))
      return refuse(`dump ${dumpUrl} does not exist`);
    const sidecar = snapshotIdSidecarPath(dumpPath);
    return {
      ok: true,
      value: {
        snapshotId: fs.existsSync(sidecar)
          ? fs.readFileSync(sidecar, "utf8").trim()
          : null,
        modifiedAt: fs.statSync(dumpPath).mtime,
      },
    };
  }
  const location = parseS3Url(dumpUrl);
  if (!location || location.prefix === "") {
    return refuse(
      `--dump must be s3://<bucket>/<key> or file://<path>, got '${dumpUrl}'`,
    );
  }
  const head = await store.head(location);
  if (!head) return refuse(`dump ${dumpUrl} does not exist`);
  return {
    ok: true,
    value: {
      snapshotId: head.metadata[SNAPSHOT_ID_METADATA_KEY] ?? null,
      modifiedAt: head.lastModified,
    },
  };
}

/**
 * Paired when the dump carries the snapshot's id. A dump with no id at all
 * (fallback mode, D-65) is accepted only if it is not older than the snapshot —
 * I-21's "not older in fallback mode" — since counts-then-dump with the API
 * stopped is the fallback order.
 */
/**
 * Fallback pairing's upper bound. The window is minutes, and in fallback mode
 * the dump is taken right after the counts with the API stopped, so an
 * id-less dump modified long after the snapshot belongs to some later attempt.
 */
export const FALLBACK_PAIRING_MAX_LAG_MS = 30 * 60 * 1000;

export function checkSnapshotBinding(
  snapshot: PurgeSnapshot,
  pairing: DumpPairing,
  imageCommit: string,
): Verdict {
  if (pairing.snapshotId !== null) {
    if (pairing.snapshotId !== snapshot.snapshotId) {
      return refuse(
        `unpaired snapshot: the dump carries snapshot id '${pairing.snapshotId}', the snapshot file is '${snapshot.snapshotId}'`,
      );
    }
  } else {
    const lag =
      pairing.modifiedAt.getTime() - new Date(snapshot.takenAt).getTime();
    if (lag < 0) {
      return refuse(
        `stale snapshot: taken ${snapshot.takenAt}, after the dump was last modified ${pairing.modifiedAt.toISOString()}`,
      );
    }
    if (lag > FALLBACK_PAIRING_MAX_LAG_MS) {
      return refuse(
        `unpaired snapshot: the dump carries no snapshot id and was last modified ${pairing.modifiedAt.toISOString()}, more than ${FALLBACK_PAIRING_MAX_LAG_MS / 60000} minutes after the snapshot was taken ${snapshot.takenAt}`,
      );
    }
  }
  if (snapshot.imageCommit !== imageCommit) {
    return refuse(
      `wrong image: the snapshot was taken by commit ${snapshot.imageCommit}, this process runs ${imageCommit}`,
    );
  }
  return OK;
}

// ==================== snapshot file ====================

export const snapshotFileName = (takenAt: string): string =>
  `purge-${takenAt.slice(0, 10)}.snapshot.json`;

export function readSnapshotFile(file: string): Checked<PurgeSnapshot> {
  if (!fs.existsSync(file))
    return refuse(`snapshot file ${file} does not exist`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return refuse(`snapshot file ${file} is not JSON: ${String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return refuse(`snapshot file ${file} is not an object`);
  }
  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== [...SNAPSHOT_KEYS].sort().join(",")) {
    return refuse(
      `snapshot file ${file} has keys [${keys.join(", ")}], expected [${SNAPSHOT_KEYS.join(", ")}]`,
    );
  }
  const s = parsed as PurgeSnapshot;
  if (
    typeof s.snapshotId !== "string" ||
    typeof s.takenAt !== "string" ||
    Number.isNaN(new Date(s.takenAt).getTime()) ||
    typeof s.imageCommit !== "string" ||
    !Array.isArray(s.keeperIds) ||
    !Array.isArray(s.attributionTuples) ||
    !Array.isArray(s.counts?.companies)
  ) {
    return refuse(`snapshot file ${file} is malformed`);
  }
  return { ok: true, value: s };
}

// ==================== discovery (information_schema, never a hand list) ====================

export type ScopedTable =
  | { table: string; column: string; via: "company" }
  | { table: string; column: string; via: "warehouse" };

export type SetNullUserColumn = {
  table: string;
  column: string;
  companyColumn: string | null;
  hasUuid: boolean;
};

type TableColumn = { table: string; column: string };

const normalise = (column: string): string =>
  column.toLowerCase().replace(/_/g, "");

/**
 * Partitions are skipped: a partitioned parent (`audit_logs`) already counts
 * its partitions' rows, so counting both would double every audit row.
 */
const companyColumns = (knex: Knex): Promise<TableColumn[]> =>
  rowsOf<TableColumn>(
    knex,
    `select c.table_name as "table", c.column_name as "column"
       from information_schema.columns c
       join pg_class k
         on k.relname = c.table_name
        and k.relnamespace = 'public'::regnamespace
      where c.table_schema = 'public'
        and c.column_name ilike '%company%id%'
        and k.relkind in ('r', 'p')
        and not k.relispartition
      order by 1, 2`,
  );

const foreignKeysTo = (
  knex: Knex,
  referencedTable: string,
  deleteRule: string | null,
): Promise<TableColumn[]> =>
  rowsOf<TableColumn>(
    knex,
    `select distinct kcu.table_name as "table", kcu.column_name as "column"
       from information_schema.referential_constraints rc
       join information_schema.key_column_usage kcu
         on kcu.constraint_schema = rc.constraint_schema
        and kcu.constraint_name = rc.constraint_name
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_schema = rc.constraint_schema
        and ccu.constraint_name = rc.constraint_name
      where rc.constraint_schema = 'public'
        and ccu.table_name = ?
        and ccu.column_name = 'id'
        and (?::text is null or rc.delete_rule = ?)
      order by 1, 2`,
    [referencedTable, deleteRule, deleteRule],
  );

/**
 * One scope column per table: the one spelled `companyId`/`company_id` when
 * present (so `audit_logs` is scoped by `companyId`, not `actorCompanyId`),
 * otherwise the first match. Tables with no company column but an FK to
 * `warehouses` are scoped through the warehouse.
 */
export async function discoverScopedTables(knex: Knex): Promise<ScopedTable[]> {
  const byTable = new Map<string, string>();
  for (const { table, column } of await companyColumns(knex)) {
    const current = byTable.get(table);
    if (
      !current ||
      (normalise(column) === "companyid" && normalise(current) !== "companyid")
    ) {
      byTable.set(table, column);
    }
  }
  const scoped: ScopedTable[] = [...byTable].map(([table, column]) => ({
    table,
    column,
    via: "company",
  }));
  const viaWarehouse = new Map<string, string>();
  for (const { table, column } of await foreignKeysTo(
    knex,
    "warehouses",
    null,
  )) {
    if (!byTable.has(table) && !viaWarehouse.has(table)) {
      viaWarehouse.set(table, column);
    }
  }
  for (const [table, column] of viaWarehouse) {
    scoped.push({ table, column, via: "warehouse" });
  }
  return scoped.sort((a, b) => a.table.localeCompare(b.table));
}

const warehouseCompanyColumn = (tables: readonly ScopedTable[]): string => {
  const warehouses = tables.find(
    (t) => t.table === "warehouses" && t.via === "company",
  );
  if (!warehouses) {
    throw new PurgeRefusedError(
      "warehouses has no company column: cannot scope warehouse-owned tables",
    );
  }
  return warehouses.column;
};

export async function discoverSetNullUserColumns(
  knex: Knex,
  tables: readonly ScopedTable[],
): Promise<SetNullUserColumn[]> {
  const uuidTables = await tablesWithUuid(knex);
  return (await foreignKeysTo(knex, "users", "SET NULL")).map(
    ({ table, column }) => {
      const scope = tables.find(
        (t) => t.table === table && t.via === "company",
      );
      return {
        table,
        column,
        companyColumn: scope ? scope.column : null,
        hasUuid: uuidTables.has(table),
      };
    },
  );
}

type ForeignKey = {
  name: string;
  child: string;
  parent: string;
  /** `pg_constraint.confdeltype`: c cascade, n set null, r restrict, a no action, d set default. */
  rule: string;
  childColumns: string[];
  parentColumns: string[];
};

/** Partition copies of a parent's constraint (`conparentid <> 0`) are skipped. */
const loadForeignKeys = (knex: Knex): Promise<ForeignKey[]> =>
  rowsOf<ForeignKey>(
    knex,
    `select c.conname::text as name, child.relname as child, parent.relname as parent, c.confdeltype::text as rule,
            array(select a.attname::text from unnest(c.conkey) with ordinality k(num, ord)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num
                   order by k.ord) as "childColumns",
            array(select a.attname::text from unnest(c.confkey) with ordinality k(num, ord)
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.num
                   order by k.ord) as "parentColumns"
       from pg_constraint c
       join pg_class child on child.oid = c.conrelid
       join pg_class parent on parent.oid = c.confrelid
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and c.conparentid = 0
      order by 2, 3, 5`,
  );

const isCascadeOn = (
  fks: readonly ForeignKey[],
  child: string,
  column: string,
  parent: string,
): boolean =>
  fks.some(
    (fk) =>
      fk.child === child &&
      fk.parent === parent &&
      fk.rule === "c" &&
      fk.childColumns.length === 1 &&
      fk.childColumns[0] === column,
  );

/**
 * Scoped tables whose company rows `purgeCompany` would leave behind: neither
 * reached by an `ON DELETE CASCADE` from `companies` (directly, or through
 * `warehouses`) nor deleted explicitly by it. Any entry makes the purge unsound
 * (db-per-company T0, finding F-1), so the P scripts refuse.
 */
export async function findTablesNotPurged(
  knex: Knex,
  tables: readonly ScopedTable[],
  explicitlyPurged: readonly string[],
): Promise<string[]> {
  const fks = await loadForeignKeys(knex);
  return tables
    .filter((t) => !explicitlyPurged.includes(t.table))
    .filter((t) =>
      t.via === "company"
        ? !isCascadeOn(fks, t.table, t.column, "companies")
        : !isCascadeOn(fks, t.table, t.column, "warehouses"),
    )
    .map((t) => `${t.table}.${t.column}`);
}

export type KeeperCascadeRisk = { path: string; rows: number };

/** Deep enough for every cascade chain in the schema today (the longest is 3). */
const MAX_CASCADE_DEPTH = 6;
const MAX_OWNER_DEPTH = 3;

type Sql = { sql: string; bindings: Knex.RawBinding[] };

type OwnershipSide = "kept" | "purged";

/**
 * Which company a row of `table` (aliased `alias`) belongs to, as a SQL
 * condition: "…belongs to a keeper or to no company" (`kept`) or "…belongs to
 * a company being purged" (`purged`). The company is the row's own company
 * column, or is found through any foreign key other than `users`, at most
 * `MAX_OWNER_DEPTH` levels away, leading to a table that has one. Null means the
 * table has no owner but its user (`emailTokens`, `user_devices`) — those rows
 * go with the purged user by design.
 */
const companyOwnership = (
  side: OwnershipSide,
  table: string,
  alias: string,
  fks: readonly ForeignKey[],
  companyColumn: ReadonlyMap<string, string>,
  keeperIds: readonly number[],
  depth = 0,
): Sql | null => {
  const own = companyColumn.get(table);
  if (own) {
    return side === "kept"
      ? {
          sql: `(${alias}.?? = any(?) or ${alias}.?? is null)`,
          bindings: [own, [...keeperIds], own],
        }
      : {
          sql: `(${alias}.?? is not null and ${alias}.?? <> all(?))`,
          bindings: [own, own, [...keeperIds]],
        };
  }
  if (depth >= MAX_OWNER_DEPTH) return null;
  const alternatives: Sql[] = [];
  fks
    .filter(
      (fk) =>
        fk.child === table &&
        fk.parent !== "users" &&
        fk.childColumns.length === 1,
    )
    .forEach((fk, index) => {
      const parentAlias = `${alias}_o${index}`;
      const parent = companyOwnership(
        side,
        fk.parent,
        parentAlias,
        fks,
        companyColumn,
        keeperIds,
        depth + 1,
      );
      if (!parent) return;
      alternatives.push({
        sql: `exists (select 1 from ?? ${parentAlias} where ${parentAlias}.?? = ${alias}.?? and ${parent.sql})`,
        bindings: [
          fk.parent,
          fk.parentColumns[0] ?? "id",
          fk.childColumns[0] ?? "",
          ...parent.bindings,
        ],
      });
    });
  if (alternatives.length === 0) return null;
  return {
    sql: `(${alternatives.map((a) => a.sql).join(" or ")})`,
    bindings: alternatives.flatMap((a) => a.bindings),
  };
};

/**
 * Rows of kept companies that `ON DELETE CASCADE` would remove when a user of a
 * purged company is deleted — e.g. a kept company's `countdown_group_members`
 * row for that user. Cascade chains are walked from `users` through
 * `pg_constraint`, never a hand list; the owning company of a row without a
 * company column is resolved through its other foreign keys. Every chain found
 * is reported with its row count; the caller refuses on any.
 */
export async function findKeeperRowsCascadingFromPurgedUsers(
  knex: Knex,
  tables: readonly ScopedTable[],
  keeperIds: readonly number[],
): Promise<KeeperCascadeRisk[]> {
  const fks = await loadForeignKeys(knex);
  const companyColumn = new Map(
    tables.filter((t) => t.via === "company").map((t) => [t.table, t.column]),
  );
  const userCompany = companyColumn.get("users");
  if (!userCompany) throw new PurgeRefusedError("users has no company column");

  const risks: KeeperCascadeRisk[] = [];
  const walk = async (chain: readonly ForeignKey[]): Promise<void> => {
    const tail =
      chain.length === 0 ? "users" : (chain[chain.length - 1]?.child ?? "");
    if (chain.length >= MAX_CASCADE_DEPTH) {
      throw new PurgeRefusedError(
        `cascade chain from users is deeper than ${MAX_CASCADE_DEPTH} at ${tail}; cannot prove kept rows survive`,
      );
    }
    const visited = new Set(["users", ...chain.map((fk) => fk.child)]);
    for (const fk of fks.filter(
      (f) => f.parent === tail && f.rule === "c" && !visited.has(f.child),
    )) {
      if (fk.childColumns.length !== 1) {
        throw new PurgeRefusedError(
          `multi-column cascade ${fk.child}(${fk.childColumns.join(",")}) → ${fk.parent}; cannot prove kept rows survive`,
        );
      }
      const next = [...chain, fk];
      const last = `t${next.length}`;
      const owner = companyOwnership(
        "kept",
        fk.child,
        last,
        fks,
        companyColumn,
        keeperIds,
      );
      if (owner) {
        const joins = next.map((edge, i) => ({
          sql: `join ?? t${i + 1} on t${i + 1}.?? = ${i === 0 ? "u" : `t${i}`}.??`,
          bindings: [
            edge.child,
            edge.childColumns[0] ?? "",
            edge.parentColumns[0] ?? "id",
          ] as Knex.RawBinding[],
        }));
        const [row] = await rowsOf<{ n: number }>(
          knex,
          `select count(*)::int as n from ?? u ${joins.map((j) => j.sql).join(" ")}
            where u.?? is not null and u.?? <> all(?) and ${owner.sql}`,
          [
            "users",
            ...joins.flatMap((j) => j.bindings),
            userCompany,
            userCompany,
            [...keeperIds],
            ...owner.bindings,
          ],
        );
        if ((row?.n ?? 0) > 0) {
          risks.push({
            path: [
              "users",
              ...next.map((e) => `${e.child}.${e.childColumns[0] ?? ""}`),
            ].join(" → "),
            rows: row?.n ?? 0,
          });
        }
      }
      await walk(next);
    }
  };
  await walk([]);
  return risks;
}

export type RestrictBlock = {
  constraint: string;
  foreignKey: string;
  references: { keptRow: string; referencedRow: string }[];
};

const RESTRICT_ROWS_REPORTED = 20;

const tablesWithUuid = async (knex: Knex): Promise<Set<string>> =>
  new Set(
    (
      await rowsOf<{ table: string }>(
        knex,
        `select table_name as "table" from information_schema.columns
          where table_schema = 'public' and column_name = 'uuid'`,
      )
    ).map((r) => r.table),
  );

/**
 * Rows of kept companies that reference a row of a purged company — or of a
 * purged company's user — through an `ON DELETE RESTRICT` or `NO ACTION`
 * foreign key. Purging that company raises part-way through the run, after the
 * companies before it were already committed: a partial purge that only a
 * full restore undoes (T0/D-115). Both rows' companies come from
 * `companyOwnership`; up to `RESTRICT_ROWS_REPORTED` (kept row, referenced
 * row) pairs per foreign key are reported, each row by uuid, or by id where its
 * table has none.
 */
export async function findKeeperRowsBlockingPurge(
  knex: Knex,
  tables: readonly ScopedTable[],
  keeperIds: readonly number[],
): Promise<RestrictBlock[]> {
  const fks = await loadForeignKeys(knex);
  const companyColumn = new Map(
    tables.filter((t) => t.via === "company").map((t) => [t.table, t.column]),
  );
  const uuidTables = await tablesWithUuid(knex);
  const blocks: RestrictBlock[] = [];
  for (const fk of fks.filter((f) => f.rule === "r" || f.rule === "a")) {
    if (fk.childColumns.length !== 1) {
      throw new PurgeRefusedError(
        `multi-column restricting foreign key ${fk.child}(${fk.childColumns.join(",")}) → ${fk.parent}; cannot prove the purge completes`,
      );
    }
    const child = companyOwnership(
      "kept",
      fk.child,
      "c",
      fks,
      companyColumn,
      keeperIds,
    );
    const parent = companyOwnership(
      "purged",
      fk.parent,
      "p",
      fks,
      companyColumn,
      keeperIds,
    );
    if (!child || !parent) continue;
    const found = await rowsOf<{ kept_row: string; referenced_row: string }>(
      knex,
      `select c.??::text as kept_row, p.??::text as referenced_row
         from ?? c join ?? p on p.?? = c.??
        where ${child.sql} and ${parent.sql}
        order by 1, 2 limit ?`,
      [
        uuidTables.has(fk.child) ? "uuid" : "id",
        uuidTables.has(fk.parent) ? "uuid" : "id",
        fk.child,
        fk.parent,
        fk.parentColumns[0] ?? "id",
        fk.childColumns[0] ?? "",
        ...child.bindings,
        ...parent.bindings,
        RESTRICT_ROWS_REPORTED,
      ],
    );
    if (found.length > 0) {
      blocks.push({
        constraint: fk.name,
        foreignKey: `${fk.child}.${fk.childColumns[0] ?? ""} → ${fk.parent}`,
        references: found.map((r) => ({
          keptRow: r.kept_row,
          referencedRow: r.referenced_row,
        })),
      });
    }
  }
  return blocks;
}

const columnKey = (c: { table: string; column: string }): string =>
  `${c.table}.${c.column}`;

// ==================== counts ====================

const perKeeper = (
  keeperIds: readonly number[],
  rows: readonly { company: number | null; n: number }[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const id of keeperIds) counts[String(id)] = 0;
  for (const row of rows) counts[String(row.company)] = row.n;
  return counts;
};

export async function countScoped(
  knex: Knex,
  tables: readonly ScopedTable[],
  keeperIds: readonly number[],
): Promise<Record<string, Record<string, number>>> {
  const warehouseColumn = warehouseCompanyColumn(tables);
  const counts: Record<string, Record<string, number>> = {};
  for (const t of tables) {
    const rows =
      t.via === "company"
        ? await rowsOf<{ company: number; n: number }>(
            knex,
            `select ?? as company, count(*)::int as n from ?? where ?? = any(?) group by 1`,
            [t.column, t.table, t.column, [...keeperIds]],
          )
        : await rowsOf<{ company: number; n: number }>(
            knex,
            `select w.?? as company, count(*)::int as n
               from ?? t join ?? w on w.id = t.??
              where w.?? = any(?) group by 1`,
            [
              warehouseColumn,
              t.table,
              "warehouses",
              t.column,
              warehouseColumn,
              [...keeperIds],
            ],
          );
    counts[t.table] = perKeeper(keeperIds, rows);
  }
  return counts;
}

async function countNullCompany(
  knex: Knex,
  tables: readonly ScopedTable[],
): Promise<Record<NullCompanyTable, number>> {
  const counts = {} as Record<NullCompanyTable, number>;
  for (const table of NULL_COMPANY_TABLES) {
    const scope = tables.find((t) => t.table === table && t.via === "company");
    if (!scope) throw new PurgeRefusedError(`${table} has no company column`);
    const [row] = await rowsOf<{ n: number }>(
      knex,
      `select count(*)::int as n from ?? where ?? is null`,
      [table, scope.column],
    );
    counts[table] = row?.n ?? 0;
  }
  return counts;
}

/**
 * NULLs per `SET NULL`→`users` column, over the rows the purge keeps (keeper
 * company or no company). The gate compares these to prove no NULL appeared
 * beyond the snapshot's attribution tuples.
 */
async function countSetNullNulls(
  knex: Knex,
  columns: readonly SetNullUserColumn[],
  keeperIds: readonly number[],
): Promise<Record<string, Record<string, number>>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const c of columns) {
    if (c.companyColumn === null) {
      const [row] = await rowsOf<{ n: number }>(
        knex,
        `select count(*)::int as n from ?? where ?? is null`,
        [c.table, c.column],
      );
      counts[columnKey(c)] = { [UNSCOPED_BUCKET]: row?.n ?? 0 };
      continue;
    }
    const rows = await rowsOf<{ company: number | null; n: number }>(
      knex,
      `select ?? as company, count(*)::int as n from ??
        where ?? is null and (?? = any(?) or ?? is null) group by 1`,
      [
        c.companyColumn,
        c.table,
        c.column,
        c.companyColumn,
        [...keeperIds],
        c.companyColumn,
      ],
    );
    const buckets = perKeeper(keeperIds, rows);
    buckets[NULL_BUCKET] = rows.find((r) => r.company === null)?.n ?? 0;
    counts[columnKey(c)] = buckets;
  }
  return counts;
}

const sumBuckets = (buckets: Record<string, number> | undefined): number =>
  Object.values(buckets ?? {}).reduce((total, n) => total + n, 0);

/**
 * Rows the purge will keep whose `SET NULL` column points at a user of a
 * company being purged — exactly the values the cascade will NULL (D-66). Rows
 * of purged companies are excluded: they are deleted, not NULLed.
 */
export async function captureAttributionTuples(
  knex: Knex,
  columns: readonly SetNullUserColumn[],
  keeperIds: readonly number[],
): Promise<AttributionTuple[]> {
  const tuples: AttributionTuple[] = [];
  for (const c of columns) {
    const survivingRow =
      c.companyColumn === null ? "" : `and (t.?? = any(?) or t.?? is null)`;
    const bindings: Knex.RawBinding[] = [
      c.hasUuid ? "uuid" : "id",
      c.table,
      c.column,
      [...keeperIds],
    ];
    if (c.companyColumn !== null) {
      bindings.push(c.companyColumn, [...keeperIds], c.companyColumn);
    }
    const rows = await rowsOf<{ row_key: string; email: string }>(
      knex,
      `select t.??::text as row_key, u.email
         from ?? t join users u on u.id = t.??
        where u."companyId" is not null and u."companyId" <> all(?)
        ${survivingRow}
        order by 1`,
      bindings,
    );
    if (rows.length > 0 && !c.hasUuid) {
      throw new PurgeRefusedError(
        `${columnKey(c)} references users of purged companies but ${c.table} has no uuid to record the tuple by (ids ${rows.map((r) => r.row_key).join(", ")})`,
      );
    }
    for (const row of rows) {
      tuples.push({
        table: c.table,
        rowUuid: row.row_key,
        column: c.column,
        userEmail: row.email,
      });
    }
  }
  return tuples;
}

// ==================== snapshot (D-65) ====================

export type HeldSnapshot = {
  snapshot: PurgeSnapshot;
  release: () => Promise<void>;
};

/**
 * Opens a REPEATABLE READ transaction, exports its snapshot and captures every
 * count inside it. The transaction stays open until `release()`, so
 * `pg_dump --snapshot=<snapshotId>` taken meanwhile sees exactly these rows.
 */
export async function takeSnapshot(
  knex: Knex,
  input: {
    keeperUuids: readonly string[];
    imageCommit: string;
    s3Prefixes: Record<string, PrefixStats>;
    explicitlyPurgedTables: readonly string[];
    now: () => Date;
  },
): Promise<HeldSnapshot> {
  const trx = await knex.transaction();
  try {
    await trx.raw("set transaction isolation level repeatable read, read only");
    const [exported] = await rowsOf<{ id: string }>(
      trx,
      "select pg_export_snapshot() as id",
    );
    const takenAt = input.now().toISOString();
    const companies = await rowsOf<CompanyRef>(
      trx,
      `select id, uuid::text as uuid from companies order by id`,
    );
    const keeperIds: number[] = [];
    for (const uuid of input.keeperUuids) {
      const company = companies.find((c) => c.uuid === uuid);
      if (!company)
        throw new PurgeRefusedError(
          `keeper ${uuid} is not a company in this database`,
        );
      if (!keeperIds.includes(company.id)) keeperIds.push(company.id);
    }
    if (keeperIds.length === 0)
      throw new PurgeRefusedError("at least one keeper is required");
    keeperIds.sort((a, b) => a - b);

    const tables = await discoverScopedTables(trx);
    const notPurged = await findTablesNotPurged(
      trx,
      tables,
      input.explicitlyPurgedTables,
    );
    if (notPurged.length > 0) {
      throw new PurgeRefusedError(
        `company rows in ${notPurged.join(", ")} are not removed by purgeCompany (no ON DELETE CASCADE from companies, not deleted explicitly)`,
      );
    }
    const cascading = await findKeeperRowsCascadingFromPurgedUsers(
      trx,
      tables,
      keeperIds,
    );
    if (cascading.length > 0) {
      throw new PurgeRefusedError(
        `rows of kept companies would be removed by ON DELETE CASCADE from users of purged companies: ${cascading.map((r) => `${r.path} (${r.rows})`).join("; ")}`,
      );
    }
    const blocking = await findKeeperRowsBlockingPurge(trx, tables, keeperIds);
    if (blocking.length > 0) {
      throw new PurgeRefusedError(
        `rows of kept companies reference rows of purged companies through ON DELETE RESTRICT/NO ACTION foreign keys, so the purge would stop part-way: ${blocking.map((b) => `${b.foreignKey}: ${b.references.map((r) => `${r.keptRow} references ${r.referencedRow}`).join(", ")} (constraint ${b.constraint})`).join("; ")}`,
      );
    }
    const setNullColumns = await discoverSetNullUserColumns(trx, tables);
    const snapshot: PurgeSnapshot = {
      snapshotId: exported?.id ?? "",
      takenAt,
      imageCommit: input.imageCommit,
      keeperIds,
      counts: {
        companies,
        scoped: await countScoped(trx, tables, keeperIds),
        nullCompany: await countNullCompany(trx, tables),
        setNullToUsers: await countSetNullNulls(trx, setNullColumns, keeperIds),
        s3Prefixes: input.s3Prefixes,
      },
      attributionTuples: await captureAttributionTuples(
        trx,
        setNullColumns,
        keeperIds,
      ),
    };
    return { snapshot, release: async () => void (await trx.commit()) };
  } catch (error) {
    await trx.rollback();
    throw error;
  }
}

// ==================== purge preconditions (AC-78) ====================

export type PurgeInputs = {
  snapshot: PurgeSnapshot;
  targetUuids: readonly string[];
  pairing: DumpPairing;
  imageCommit: string;
  store: PurgeObjectStore;
  archiveRoot: S3Location | null;
  production: boolean;
};

const companyByUuid = (
  snapshot: PurgeSnapshot,
  uuid: string,
): CompanyRef | undefined =>
  snapshot.counts.companies.find((c) => c.uuid === uuid);

/** A prefix without a verified archive copy must never reach the purge (D-82). */
export async function checkArchived(
  store: PurgeObjectStore,
  companyId: number,
  archiveRoot: S3Location | null,
  production: boolean,
): Promise<Verdict> {
  if (!store.filesBucket) {
    return production
      ? refuse(
          "S3_FILES_BUCKET is not set in production: cannot verify company file archives",
        )
      : OK;
  }
  const source = await store.stats(
    companySourcePrefix(store.filesBucket, companyId),
  );
  if (source.objects === 0) return OK;
  if (!archiveRoot) {
    return refuse(
      `company ${companyId} has ${describeStats(source)} under companies/${companyId}/ and no archive root was given (--archive or an s3:// --dump)`,
    );
  }
  const archive = await store.stats(
    companyArchivePrefix(archiveRoot, companyId),
  );
  if (!sameStats(source, archive)) {
    return refuse(
      `company ${companyId}: companies/${companyId}/ holds ${describeStats(source)} but the archive s3://${archiveRoot.bucket}/${companyArchivePrefix(archiveRoot, companyId).prefix} holds ${describeStats(archive)}`,
    );
  }
  return OK;
}

export async function checkPurgePreconditions(
  input: PurgeInputs,
): Promise<Verdict> {
  const { snapshot } = input;
  const binding = checkSnapshotBinding(
    snapshot,
    input.pairing,
    input.imageCommit,
  );
  if (!binding.ok) return binding;

  const targets: CompanyRef[] = [];
  for (const uuid of input.targetUuids) {
    const company = companyByUuid(snapshot, uuid);
    if (company && snapshot.keeperIds.includes(company.id)) {
      return refuse(`${uuid} (company ${company.id}) is a keeper`);
    }
    if (!company) return refuse(`${uuid} is not a company in the snapshot`);
    targets.push(company);
  }
  const covered = new Set([...snapshot.keeperIds, ...targets.map((t) => t.id)]);
  const uncovered = snapshot.counts.companies.filter((c) => !covered.has(c.id));
  if (uncovered.length > 0) {
    return refuse(
      `every snapshot company must be kept or purged; neither: ${uncovered.map((c) => `${c.uuid} (id ${c.id})`).join(", ")}`,
    );
  }
  for (const target of targets) {
    const archived = await checkArchived(
      input.store,
      target.id,
      input.archiveRoot,
      input.production,
    );
    if (!archived.ok) return archived;
  }
  return OK;
}

// ==================== post-purge gate (D-73) ====================

export type GateInputs = {
  snapshot: PurgeSnapshot;
  keeperUuids: readonly string[];
  mode: AttributionMode;
  pairing: DumpPairing;
  imageCommit: string;
  store: PurgeObjectStore;
  archiveRoot: S3Location | null;
  production: boolean;
};

const sameMembers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length &&
  [...a].sort((x, y) => x - y).join(",") ===
    [...b].sort((x, y) => x - y).join(",");

function checkKeepers(
  snapshot: PurgeSnapshot,
  keeperUuids: readonly string[],
): Verdict {
  const ids: number[] = [];
  for (const uuid of keeperUuids) {
    const company = companyByUuid(snapshot, uuid);
    if (!company)
      return refuse(
        `keeper mismatch: ${uuid} is not a company in the snapshot`,
      );
    ids.push(company.id);
  }
  if (!sameMembers([...new Set(ids)], snapshot.keeperIds)) {
    return refuse(
      `keeper mismatch: --keepers resolves to [${ids.join(", ")}], the snapshot's keeperIds are [${snapshot.keeperIds.join(", ")}]`,
    );
  }
  return OK;
}

async function checkKeeperCounts(
  knex: Knex,
  snapshot: PurgeSnapshot,
  tables: readonly ScopedTable[],
): Promise<Verdict> {
  const now = await countScoped(knex, tables, snapshot.keeperIds);
  const before = snapshot.counts.scoped;
  const tableSet = (o: object): string => Object.keys(o).sort().join(",");
  if (tableSet(now) !== tableSet(before)) {
    return refuse(
      `scoped table set differs from the snapshot: now [${tableSet(now)}], snapshot [${tableSet(before)}]`,
    );
  }
  for (const table of Object.keys(before).sort()) {
    for (const id of snapshot.keeperIds) {
      const expected = before[table]?.[String(id)] ?? 0;
      const actual = now[table]?.[String(id)] ?? 0;
      if (expected !== actual) {
        return refuse(
          `keeper count: ${table} for company ${id} was ${expected} in the snapshot, is ${actual} now`,
        );
      }
    }
  }
  return OK;
}

/** Every scoped table still holding rows of a non-keeper company, with counts. */
export async function findNonKeeperRows(
  knex: Knex,
  tables: readonly ScopedTable[],
  keeperIds: readonly number[],
): Promise<{ table: string; via: ScopedTable["via"]; rows: number }[]> {
  const warehouseColumn = warehouseCompanyColumn(tables);
  const found: { table: string; via: ScopedTable["via"]; rows: number }[] = [];
  for (const t of tables) {
    const [row] =
      t.via === "company"
        ? await rowsOf<{ n: number }>(
            knex,
            `select count(*)::int as n from ?? where ?? is not null and ?? <> all(?)`,
            [t.table, t.column, t.column, [...keeperIds]],
          )
        : await rowsOf<{ n: number }>(
            knex,
            `select count(*)::int as n from ?? t join ?? w on w.id = t.?? where w.?? <> all(?)`,
            [t.table, "warehouses", t.column, warehouseColumn, [...keeperIds]],
          );
    if ((row?.n ?? 0) > 0)
      found.push({ table: t.table, via: t.via, rows: row?.n ?? 0 });
  }
  return found;
}

async function checkCompaniesAndNulls(
  knex: Knex,
  snapshot: PurgeSnapshot,
  tables: readonly ScopedTable[],
): Promise<Verdict> {
  const companies = await rowsOf<{ id: number }>(
    knex,
    `select id from companies order by id`,
  );
  const ids = companies.map((c) => c.id);
  if (
    ids.length !== snapshot.keeperIds.length ||
    !sameMembers(ids, snapshot.keeperIds)
  ) {
    return refuse(
      `companies: expected exactly the keepers [${snapshot.keeperIds.join(", ")}], found [${ids.join(", ")}]`,
    );
  }
  const nulls = await countNullCompany(knex, tables);
  for (const table of NULL_COMPANY_TABLES) {
    if (nulls[table] !== snapshot.counts.nullCompany[table]) {
      return refuse(
        `NULL-company rows: ${table} was ${snapshot.counts.nullCompany[table]} in the snapshot, is ${nulls[table]} now`,
      );
    }
  }
  return OK;
}

async function checkAttribution(
  knex: Knex,
  snapshot: PurgeSnapshot,
  tables: readonly ScopedTable[],
  mode: AttributionMode,
): Promise<Verdict> {
  const columns = await discoverSetNullUserColumns(knex, tables);
  const nowKeys = columns.map(columnKey).sort().join(",");
  const snapshotKeys = Object.keys(snapshot.counts.setNullToUsers)
    .sort()
    .join(",");
  if (nowKeys !== snapshotKeys) {
    return refuse(
      `SET NULL→users column set differs from the snapshot: now [${nowKeys}], snapshot [${snapshotKeys}]`,
    );
  }
  for (const tuple of snapshot.attributionTuples) {
    const [row] = await rowsOf<{
      user_id: number | null;
      user_company: number | null;
      user_exists: boolean;
    }>(
      knex,
      `select t.?? as user_id, u."companyId" as user_company, u.id is not null as user_exists
         from ?? t left join users u on u.id = t.??
        where t.uuid::text = ?`,
      [tuple.column, tuple.table, tuple.column, tuple.rowUuid],
    );
    const label = `${tuple.table}.${tuple.column} row ${tuple.rowUuid} (was ${tuple.userEmail})`;
    if (!row) return refuse(`attribution: ${label} no longer exists`);
    if (mode === "null" && row.user_id !== null) {
      return refuse(
        `attribution: ${label} is not NULL (points at user ${row.user_id})`,
      );
    }
    if (mode === "reassigned") {
      if (row.user_id === null)
        return refuse(
          `attribution: ${label} is still NULL under --attribution-mode reassigned`,
        );
      if (
        !row.user_exists ||
        row.user_company === null ||
        !snapshot.keeperIds.includes(row.user_company)
      ) {
        return refuse(
          `attribution: ${label} points at user ${row.user_id}, which is not a user of a keeper company`,
        );
      }
    }
  }
  const now = await countSetNullNulls(knex, columns, snapshot.keeperIds);
  for (const c of columns) {
    const key = columnKey(c);
    const expected =
      sumBuckets(snapshot.counts.setNullToUsers[key]) +
      (mode === "null"
        ? snapshot.attributionTuples.filter((t) => columnKey(t) === key).length
        : 0);
    const actual = sumBuckets(now[key]);
    if (actual !== expected) {
      return refuse(
        `attribution: ${key} has ${actual} NULLs on kept rows, expected ${expected} (snapshot NULLs + attribution tuples); ${actual - expected} newly NULL value(s) are not in attributionTuples`,
      );
    }
  }
  return OK;
}

export async function checkObjectStorage(
  store: PurgeObjectStore,
  snapshot: PurgeSnapshot,
  archiveRoot: S3Location | null,
  production: boolean,
): Promise<Verdict> {
  if (!store.filesBucket) {
    return production
      ? refuse(
          "S3_FILES_BUCKET is not set in production: cannot check company prefixes",
        )
      : OK;
  }
  const live = await store.companyPrefixes();
  const foreign = Object.keys(live).filter(
    (id) => !snapshot.keeperIds.includes(Number(id)),
  );
  if (foreign.length > 0) {
    return refuse(
      `S3: companies/ still lists non-keeper prefixes: ${foreign.map((id) => `companies/${id}/`).join(", ")}`,
    );
  }
  for (const [id, expected] of Object.entries(snapshot.counts.s3Prefixes)) {
    if (snapshot.keeperIds.includes(Number(id))) continue;
    if (!archiveRoot)
      return refuse(
        `S3: company ${id} had files but no archive root was given`,
      );
    const archive = companyArchivePrefix(archiveRoot, Number(id));
    const actual = await store.stats(archive);
    if (!sameStats(actual, expected)) {
      return refuse(
        `S3: archive s3://${archive.bucket}/${archive.prefix} holds ${describeStats(actual)}, the snapshot recorded ${describeStats(expected)}`,
      );
    }
  }
  return OK;
}

/** D-73 checks (1)–(6) in order; the first failure is the verdict. */
export async function runPurgeGate(
  knex: Knex,
  input: GateInputs,
): Promise<Verdict> {
  const { snapshot } = input;
  const binding = checkSnapshotBinding(
    snapshot,
    input.pairing,
    input.imageCommit,
  );
  if (!binding.ok) return binding;
  const keepers = checkKeepers(snapshot, input.keeperUuids);
  if (!keepers.ok) return keepers;

  const tables = await discoverScopedTables(knex);
  const counts = await checkKeeperCounts(knex, snapshot, tables);
  if (!counts.ok) return counts;

  const survivors = await findNonKeeperRows(knex, tables, snapshot.keeperIds);
  const [first] = survivors;
  if (first) {
    return refuse(
      `non-keeper rows survive: ${survivors.map((s) => `${s.table} (${s.via === "warehouse" ? "via warehouse" : "direct"}) ${s.rows}`).join(", ")}; first: ${first.table}`,
    );
  }

  const companies = await checkCompaniesAndNulls(knex, snapshot, tables);
  if (!companies.ok) return companies;

  const attribution = await checkAttribution(
    knex,
    snapshot,
    tables,
    input.mode,
  );
  if (!attribution.ok) return attribution;

  return checkObjectStorage(
    input.store,
    snapshot,
    input.archiveRoot,
    input.production,
  );
}
