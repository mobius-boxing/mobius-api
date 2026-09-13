/**
 * State P's shared checks (db-per-company brief T0: AC-78 preconditions, AC-79
 * check (6) against a mocked S3 client, AC-82 build stamp), without a database.
 *
 * What needs a real Postgres — discovery, counts, the exported snapshot, the
 * pg_stat_activity refusal and the gate's row checks — is in
 * `__tests__/db/purge-snapshot.db.test.ts` and `purge-window.db.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { Knex } from "knex";
import {
  FALLBACK_PAIRING_MAX_LAG_MS,
  PURGE_APPLICATION_NAME,
  PurgeObjectStore,
  checkArchived,
  checkNoOtherBackends,
  checkObjectStorage,
  checkPurgePreconditions,
  checkSnapshotBinding,
  parseArchiveRoot,
  parseCliArgs,
  readDumpPairing,
  readSnapshotFile,
  resolveArchiveRoot,
  resolveImageCommit,
  snapshotFileName,
  writeSnapshotIdSidecar,
  type CommitSources,
  type PurgeSnapshot,
  type S3Location,
} from "../../../services/purge-snapshot.service";
import { FakeS3 } from "../../mocks/s3.mock";

const FILES = "files-bucket";
const ARCHIVE_URL = "s3://env-bucket/backups/purge-2026-09-15/";
const ARCHIVE: S3Location = {
  bucket: "env-bucket",
  prefix: "backups/purge-2026-09-15/",
};

const snapshotFixture = (
  overrides: Partial<PurgeSnapshot> = {},
): PurgeSnapshot => ({
  snapshotId: "00000003-0000001B-1",
  takenAt: "2026-09-15T10:00:00.000Z",
  imageCommit: "abc123",
  keeperIds: [3, 6, 15],
  counts: {
    companies: [
      { id: 2, uuid: "u-2" },
      { id: 3, uuid: "u-3" },
      { id: 4, uuid: "u-4" },
      { id: 6, uuid: "u-6" },
      { id: 15, uuid: "u-15" },
      { id: 16, uuid: "u-16" },
    ],
    scoped: {},
    nullCompany: { users: 5, invitations: 2, audit_logs: 4 },
    setNullToUsers: {},
    s3Prefixes: {
      "6": { objects: 1, bytes: 100 },
      "16": { objects: 3, bytes: 30 },
    },
  },
  attributionTuples: [],
  ...overrides,
});

const PAIRED = {
  snapshotId: "00000003-0000001B-1",
  modifiedAt: new Date("2026-09-15T10:01:00Z"),
};

describe("parseCliArgs", () => {
  const spec = { keepers: "list", out: "single", hold: "boolean" } as const;

  it("lets a list flag consume values up to the next flag and leaves the rest positional", () => {
    const parsed = parseCliArgs(
      ["--keepers", "a", "b", "--hold", "--out", "/tmp/x", "p1"],
      spec,
    );
    expect(parsed.ok && parsed.value.flags.get("keepers")).toEqual(["a", "b"]);
    expect(parsed.ok && parsed.value.flags.get("out")).toEqual(["/tmp/x"]);
    expect(parsed.ok && parsed.value.flags.has("hold")).toBe(true);
    expect(parsed.ok && parsed.value.positionals).toEqual(["p1"]);
  });

  it("takes the subcommand only from the first token", () => {
    const parsed = parseCliArgs(["upload", "--out", "d"], spec, ["upload"]);
    expect(parsed.ok && parsed.value.command).toBe("upload");
  });

  it("refuses unknown flags and a single flag without a value", () => {
    expect(parseCliArgs(["--nope"], spec).ok).toBe(false);
    expect(parseCliArgs(["--out", "--hold"], spec).ok).toBe(false);
  });
});

describe("AC-82 — resolveImageCommit", () => {
  const stamp = (commit: string, dirty: boolean): string =>
    JSON.stringify({ commit, dirty, builtAt: "2026-09-15T09:00:00Z" });
  const sources = (over: Partial<CommitSources>): CommitSources => ({
    production: false,
    readBuildInfo: () => null,
    gitHead: () => "git-head",
    ...over,
  });

  it("refuses in production when the stamp is absent", () => {
    const result = resolveImageCommit(sources({ production: true }));
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("absent"),
    });
  });

  it("refuses in production when the stamp says dirty", () => {
    const result = resolveImageCommit(
      sources({ production: true, readBuildInfo: () => stamp("c1", true) }),
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("dirty"),
    });
  });

  it("refuses in production when the stamp is malformed, and never asks git", () => {
    let askedGit = false;
    const result = resolveImageCommit(
      sources({
        production: true,
        readBuildInfo: () => "{}",
        gitHead: () => ((askedGit = true), "g"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(askedGit).toBe(false);
  });

  it("uses a clean stamp in production", () => {
    expect(
      resolveImageCommit(
        sources({ production: true, readBuildInfo: () => stamp("c1", false) }),
      ),
    ).toEqual({
      ok: true,
      value: "c1",
    });
  });

  it("falls back to git rev-parse HEAD outside production when there is no stamp", () => {
    expect(resolveImageCommit(sources({}))).toEqual({
      ok: true,
      value: "git-head",
    });
  });

  it("refuses outside production when there is no stamp and git fails", () => {
    const result = resolveImageCommit(
      sources({
        gitHead: () => {
          throw new Error("not a git repository");
        },
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("checkSnapshotBinding — pairing, staleness, image commit (D-73 (1))", () => {
  it("accepts a dump carrying the snapshot's id from the same commit", () => {
    expect(checkSnapshotBinding(snapshotFixture(), PAIRED, "abc123")).toEqual({
      ok: true,
    });
  });

  it("refuses a dump carrying another snapshot id", () => {
    const result = checkSnapshotBinding(
      snapshotFixture(),
      { ...PAIRED, snapshotId: "other" },
      "abc123",
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("unpaired"),
    });
  });

  it("in fallback mode refuses a dump older than the snapshot", () => {
    const result = checkSnapshotBinding(
      snapshotFixture(),
      { snapshotId: null, modifiedAt: new Date("2026-09-15T09:59:59Z") },
      "abc123",
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("stale"),
    });
  });

  it("in fallback mode accepts a dump not older than the snapshot", () => {
    const result = checkSnapshotBinding(
      snapshotFixture(),
      { snapshotId: null, modifiedAt: new Date("2026-09-15T10:00:00Z") },
      "abc123",
    );
    expect(result).toEqual({ ok: true });
  });

  it("in fallback mode accepts a dump modified exactly at the lag bound, and refuses one past it", () => {
    const takenAt = new Date("2026-09-15T10:00:00.000Z").getTime();
    const atBound = checkSnapshotBinding(
      snapshotFixture(),
      { snapshotId: null, modifiedAt: new Date(takenAt + FALLBACK_PAIRING_MAX_LAG_MS) },
      "abc123",
    );
    expect(atBound).toEqual({ ok: true });
    const pastBound = checkSnapshotBinding(
      snapshotFixture(),
      {
        snapshotId: null,
        modifiedAt: new Date(takenAt + FALLBACK_PAIRING_MAX_LAG_MS + 1000),
      },
      "abc123",
    );
    expect(pastBound).toEqual({
      ok: false,
      reason: expect.stringContaining("more than 30 minutes after"),
    });
  });

  it("does not apply the lag bound to a dump that carries the snapshot id", () => {
    const result = checkSnapshotBinding(
      snapshotFixture(),
      { ...PAIRED, modifiedAt: new Date("2026-09-16T10:00:00Z") },
      "abc123",
    );
    expect(result).toEqual({ ok: true });
  });

  it("refuses a snapshot taken by another commit", () => {
    const result = checkSnapshotBinding(snapshotFixture(), PAIRED, "def456");
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("wrong image"),
    });
  });
});

describe("snapshot and dump files", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-unit-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a file:// dump's sidecar id and mtime, and null without a sidecar", async () => {
    const dump = path.join(dir, "db.dump");
    fs.writeFileSync(dump, "x");
    const store = new PurgeObjectStore(new FakeS3().send, null);
    const bare = await readDumpPairing(pathToFileURL(dump).href, store);
    expect(bare.ok && bare.value.snapshotId).toBeNull();
    writeSnapshotIdSidecar(dump, "snap-1");
    const paired = await readDumpPairing(pathToFileURL(dump).href, store);
    expect(paired.ok && paired.value.snapshotId).toBe("snap-1");
  });

  it("reads an s3:// dump's snapshot-id metadata and refuses a missing object", async () => {
    const s3 = new FakeS3();
    s3.objects.set(
      "env-bucket/backups/purge-2026-09-15/traffic_production.pre-purge.dump",
      {
        size: 10,
        metadata: { "snapshot-id": "snap-9" },
        modified: new Date("2026-09-15T10:02:00Z"),
      },
    );
    const store = new PurgeObjectStore(s3.send, FILES);
    const found = await readDumpPairing(
      `${ARCHIVE_URL}traffic_production.pre-purge.dump`,
      store,
    );
    expect(found).toEqual({
      ok: true,
      value: {
        snapshotId: "snap-9",
        modifiedAt: new Date("2026-09-15T10:02:00Z"),
      },
    });
    expect(
      (await readDumpPairing(`${ARCHIVE_URL}missing.dump`, store)).ok,
    ).toBe(false);
  });

  it("refuses a snapshot file whose keys are not exactly the six", () => {
    const file = path.join(dir, "s.json");
    fs.writeFileSync(file, JSON.stringify({ ...snapshotFixture(), extra: 1 }));
    expect(readSnapshotFile(file)).toEqual({
      ok: false,
      reason: expect.stringContaining("keys"),
    });
    fs.writeFileSync(file, JSON.stringify(snapshotFixture()));
    expect(readSnapshotFile(file).ok).toBe(true);
    expect(readSnapshotFile(path.join(dir, "absent.json")).ok).toBe(false);
  });

  it("names the snapshot file purge-<date>.snapshot.json", () => {
    expect(snapshotFileName("2026-09-15T10:00:00.000Z")).toBe(
      "purge-2026-09-15.snapshot.json",
    );
  });
});

describe("archive roots", () => {
  it("derives the archive root from an s3:// dump's directory", () => {
    expect(
      resolveArchiveRoot(
        undefined,
        `${ARCHIVE_URL}traffic_production.pre-purge.dump`,
      ),
    ).toEqual({
      ok: true,
      value: ARCHIVE,
    });
  });

  it("has no archive root for a file:// dump unless --archive is given", () => {
    expect(resolveArchiveRoot(undefined, "file:///tmp/x.dump")).toEqual({
      ok: true,
      value: null,
    });
    expect(resolveArchiveRoot(ARCHIVE_URL, "file:///tmp/x.dump")).toEqual({
      ok: true,
      value: ARCHIVE,
    });
  });

  it("refuses a root that is not backups/purge-<date>/", () => {
    expect(parseArchiveRoot("s3://env-bucket/companies/").ok).toBe(false);
    expect(
      parseArchiveRoot("s3://env-bucket/backups/purge-2026-09-15").ok,
    ).toBe(false);
  });
});

describe("PurgeObjectStore against a mocked S3 client", () => {
  it("pages through listings and groups companies/<id>/ prefixes", async () => {
    const s3 = new FakeS3();
    s3.put(FILES, "companies/6/files/a.pdf", 100);
    s3.put(FILES, "companies/16/files/b.pdf", 10);
    s3.put(FILES, "companies/16/files/c.pdf", 20);
    s3.put(FILES, "companies/16/raw/d.bin", 5);
    const store = new PurgeObjectStore(s3.send, FILES);
    expect(await store.companyPrefixes()).toEqual({
      "6": { objects: 1, bytes: 100 },
      "16": { objects: 3, bytes: 35 },
    });
    expect(
      s3.sent.filter((c) => c.command === "ListObjectsV2Command").length,
    ).toBeGreaterThan(1);
  });

  it("copies a prefix key-for-key and deletes only under the given prefix", async () => {
    const s3 = new FakeS3();
    s3.put(FILES, "companies/16/files/b c.pdf", 10);
    s3.put(FILES, "companies/160/files/keep.pdf", 7);
    const store = new PurgeObjectStore(s3.send, FILES);
    await store.copyPrefix(
      { bucket: FILES, prefix: "companies/16/" },
      {
        bucket: "env-bucket",
        prefix: "backups/purge-2026-09-15/companies-16/",
      },
    );
    expect(s3.keys("env-bucket", "")).toEqual([
      "backups/purge-2026-09-15/companies-16/files/b c.pdf",
    ]);
    await store.deletePrefix({ bucket: FILES, prefix: "companies/16/" });
    expect(s3.keys(FILES, "")).toEqual(["companies/160/files/keep.pdf"]);
  });
});

describe("AC-78 — checkArchived / checkPurgePreconditions", () => {
  const withFiles = (): FakeS3 => {
    const s3 = new FakeS3();
    s3.put(FILES, "companies/16/files/a", 10);
    s3.put(FILES, "companies/16/files/b", 20);
    return s3;
  };
  const inputs = (
    s3: FakeS3,
    over: Partial<Parameters<typeof checkPurgePreconditions>[0]> = {},
  ) => ({
    snapshot: snapshotFixture(),
    targetUuids: ["u-4", "u-2", "u-16"],
    pairing: PAIRED,
    imageCommit: "abc123",
    store: new PurgeObjectStore(s3.send, FILES),
    archiveRoot: ARCHIVE,
    production: true,
    ...over,
  });

  it("passes when every precondition holds", async () => {
    const s3 = withFiles();
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/files/a", 10);
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/files/b", 20);
    expect(await checkPurgePreconditions(inputs(s3))).toEqual({ ok: true });
  });

  it("refuses a target with a prefix and no archive copy", async () => {
    const result = await checkPurgePreconditions(inputs(withFiles()));
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("companies/16/"),
    });
  });

  it("refuses an archive copy whose byte total differs although the object count matches", async () => {
    const s3 = withFiles();
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/files/a", 10);
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/files/b", 19);
    expect((await checkPurgePreconditions(inputs(s3))).ok).toBe(false);
  });

  it("refuses a target with a prefix when no archive root is known", async () => {
    expect(
      await checkArchived(
        new PurgeObjectStore(withFiles().send, FILES),
        16,
        null,
        true,
      ),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("no archive root"),
    });
  });

  it("refuses in production without a files bucket, and skips outside production", async () => {
    const store = new PurgeObjectStore(new FakeS3().send, null);
    expect((await checkArchived(store, 16, ARCHIVE, true)).ok).toBe(false);
    expect(await checkArchived(store, 16, ARCHIVE, false)).toEqual({
      ok: true,
    });
  });

  it("refuses a keeper among the targets", async () => {
    const result = await checkPurgePreconditions(
      inputs(new FakeS3(), { targetUuids: ["u-4", "u-2", "u-16", "u-6"] }),
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("is a keeper"),
    });
  });

  it("refuses when a snapshot company is neither kept nor purged (D-86)", async () => {
    const result = await checkPurgePreconditions(
      inputs(new FakeS3(), { targetUuids: ["u-4", "u-2"] }),
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("u-16"),
    });
  });

  it("refuses an unpaired or wrong-commit snapshot before looking at S3", async () => {
    const s3 = withFiles();
    const unpaired = await checkPurgePreconditions(
      inputs(s3, { pairing: { ...PAIRED, snapshotId: "x" } }),
    );
    expect(unpaired.ok).toBe(false);
    const wrongCommit = await checkPurgePreconditions(
      inputs(s3, { imageCommit: "zzz" }),
    );
    expect(wrongCommit.ok).toBe(false);
    expect(s3.sent).toEqual([]);
  });
});

describe("AC-79 check (6) — checkObjectStorage against a mocked S3 client", () => {
  const archived = (): FakeS3 => {
    const s3 = new FakeS3();
    s3.put(FILES, "companies/6/files/keep", 100);
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/a", 10);
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/b", 10);
    s3.put("env-bucket", "backups/purge-2026-09-15/companies-16/c", 10);
    return s3;
  };

  it("is green when only keeper prefixes remain and every purged prefix is archived", async () => {
    const store = new PurgeObjectStore(archived().send, FILES);
    expect(
      await checkObjectStorage(store, snapshotFixture(), ARCHIVE, true),
    ).toEqual({ ok: true });
  });

  it("names a non-keeper prefix that is still listed", async () => {
    const s3 = archived();
    s3.put(FILES, "companies/16/files/left-behind", 1);
    const result = await checkObjectStorage(
      new PurgeObjectStore(s3.send, FILES),
      snapshotFixture(),
      ARCHIVE,
      true,
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("companies/16/"),
    });
  });

  it("names an archive that does not match the snapshot's prefix stats", async () => {
    const s3 = archived();
    s3.objects.delete("env-bucket/backups/purge-2026-09-15/companies-16/c");
    const result = await checkObjectStorage(
      new PurgeObjectStore(s3.send, FILES),
      snapshotFixture(),
      ARCHIVE,
      true,
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("companies-16/"),
    });
  });

  it("refuses in production without a files bucket", async () => {
    const store = new PurgeObjectStore(new FakeS3().send, null);
    expect(
      (await checkObjectStorage(store, snapshotFixture(), ARCHIVE, true)).ok,
    ).toBe(false);
  });
});

describe("AC-77 — checkNoOtherBackends (query shape; the live refusal is a db test)", () => {
  const knexReturning = (
    rows: object[],
    seen: { sql: string; bindings: unknown }[],
  ): Knex =>
    ({
      raw: async (sql: string, bindings: unknown) => {
        seen.push({ sql, bindings });
        return { rows };
      },
    }) as unknown as Knex;

  it("excludes its own pid and the purge's application_name, and only client backends", async () => {
    const seen: { sql: string; bindings: unknown }[] = [];
    expect(await checkNoOtherBackends(knexReturning([], seen))).toEqual({
      ok: true,
    });
    expect(seen[0]?.sql).toContain("pg_backend_pid()");
    expect(seen[0]?.sql).toContain("backend_type = 'client backend'");
    expect(seen[0]?.bindings).toEqual([PURGE_APPLICATION_NAME]);
  });

  it("names every other backend it finds", async () => {
    const result = await checkNoOtherBackends(
      knexReturning(
        [
          {
            pid: 42,
            usename: "traffic_user",
            application_name: "psql",
            client_addr: null,
          },
        ],
        [],
      ),
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("pid 42"),
    });
    expect(!result.ok && result.reason).toContain("application_name='psql'");
  });
});
