/**
 * The three P CLIs with a mocked service boundary and a mocked S3 client
 * (db-per-company brief T0: AC-78 refusals and purge order, AC-81 archive-s3,
 * AC-82 build-stamp refusal). "0 rows changed" is asserted here as "the purge
 * and the id lookup were never reached"; the same refusals against a real
 * database, with per-table counts, are in `__tests__/db/purge-window.db.test.ts`.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { Knex } from "knex";
import { FakeS3 } from "../../mocks/s3.mock";

const mockGetIdByUuid = jest.fn<(uuid: string) => Promise<number | null>>();
const mockPurgeCompany = jest.fn();
let mockActiveTarget: string | null = null;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => {
    throw new Error("unit tests never reach the registry");
  },
  rawCoreInstance: () => ({}),
  withTenantTarget: async (
    target: { physicalKey: string },
    fn: () => unknown,
  ) => {
    mockActiveTarget = target.physicalKey;
    try {
      return await fn();
    } finally {
      mockActiveTarget = null;
    }
  },
  connectAll: async () => undefined,
  disconnectAll: async () => undefined,
}));
jest.mock("../../../dao/company/company.dao", () => ({
  __esModule: true,
  CompanyDAO: class {
    getIdByUuid(uuid: string) {
      return mockGetIdByUuid(uuid);
    }
  },
}));
jest.mock("../../../services/company-purge.service", () => ({
  __esModule: true,
  purgeCompany: (id: number) => mockPurgeCompany(id),
  EXPLICITLY_PURGED_TABLES: [],
}));

import {
  PurgeObjectStore,
  writeSnapshotIdSidecar,
  type CommitSources,
  type PurgeSnapshot,
} from "../../../services/purge-snapshot.service";
import {
  runPurgeCompanies,
  purgeCompaniesDeps,
  type PurgeCliDeps,
} from "../../../scripts/purge-companies";
import { runPurgeGateCli } from "../../../scripts/purge-gate";
import { runDbSnapshotCounts } from "../../../scripts/db-snapshot-counts";

const FILES = "files-bucket";
const ARCHIVE_URL = "s3://env-bucket/backups/purge-2026-09-15/";
const IDS: Record<string, number> = {
  "u-2": 2,
  "u-3": 3,
  "u-4": 4,
  "u-5": 5,
  "u-6": 6,
  "u-15": 15,
  "u-16": 16,
};

const snapshot = (over: Partial<PurgeSnapshot> = {}): PurgeSnapshot => ({
  snapshotId: "snap-1",
  takenAt: "2026-09-15T10:00:00.000Z",
  imageCommit: "abc123",
  keeperIds: [3, 6, 15],
  counts: {
    companies: Object.entries(IDS).map(([uuid, id]) => ({ id, uuid })),
    scoped: {},
    nullCompany: { users: 0, invitations: 0, audit_logs: 0 },
    setNullToUsers: {},
    s3Prefixes: {},
  },
  attributionTuples: [],
  ...over,
});

const TARGETS = ["u-4", "u-5", "u-2", "u-16"];

let dir: string;
let s3: FakeS3;
let out: string[];
let err: string[];
let rawCalls: string[];
let backends: object[];
let stamp: string | null;
let production: boolean;
let offShared: string[];

const knex = (): Knex =>
  ({
    raw: async (sql: string) => {
      rawCalls.push(sql);
      return { rows: backends };
    },
    transaction: async () => {
      throw new Error("transaction must not be reached");
    },
  }) as unknown as Knex;

const commitSources = (): CommitSources => ({
  production,
  readBuildInfo: () => stamp,
  gitHead: () => "abc123",
});

const deps = (): PurgeCliDeps => ({
  knex,
  store: new PurgeObjectStore(s3.send, FILES),
  commitSources: commitSources(),
  companyIdByUuid: (uuid) => mockGetIdByUuid(uuid),
  purge: (id) => mockPurgeCompany(id) as ReturnType<PurgeCliDeps["purge"]>,
  companiesOffSharedTarget: async () => offShared,
  explicitlyPurgedTables: [],
  out: (line) => out.push(line),
  err: (line) => err.push(line),
});

const writeSnapshot = (
  name: string,
  over: Partial<PurgeSnapshot> = {},
): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(snapshot(over)));
  return file;
};

const pairedDump = (snapshotId = "snap-1"): string => {
  const file = path.join(dir, `db-${snapshotId}.dump`);
  fs.writeFileSync(file, "dump");
  writeSnapshotIdSidecar(file, snapshotId);
  return pathToFileURL(file).href;
};

const purgeArgs = (
  snapshotFile: string,
  dump: string,
  targets = TARGETS,
): string[] => ["--snapshot", snapshotFile, "--dump", dump, ...targets];

beforeEach(() => {
  offShared = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-scripts-"));
  s3 = new FakeS3();
  out = [];
  err = [];
  rawCalls = [];
  backends = [];
  stamp = JSON.stringify({
    commit: "abc123",
    dirty: false,
    builtAt: "2026-09-15T09:00:00Z",
  });
  production = true;
  mockGetIdByUuid.mockImplementation(async (uuid) => IDS[uuid] ?? null);
  mockPurgeCompany.mockImplementation(async () => ({
    companyDeleted: true,
    ledgerRowsDeleted: 4,
  }));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("AC-78 — purge-companies", () => {
  it("purges in argument order with ids resolved by CompanyDAO.getIdByUuid and prints each result", async () => {
    const code = await runPurgeCompanies(
      purgeArgs(writeSnapshot("s.json"), pairedDump()),
      deps(),
    );
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(mockGetIdByUuid.mock.calls.map((c) => c[0])).toEqual(TARGETS);
    expect(mockPurgeCompany.mock.calls.map((c) => c[0])).toEqual([4, 5, 2, 16]);
    expect(out.map((line) => JSON.parse(line))).toEqual([
      { uuid: "u-4", companyId: 4, companyDeleted: true, ledgerRowsDeleted: 4 },
      { uuid: "u-5", companyId: 5, companyDeleted: true, ledgerRowsDeleted: 4 },
      { uuid: "u-2", companyId: 2, companyDeleted: true, ledgerRowsDeleted: 4 },
      {
        uuid: "u-16",
        companyId: 16,
        companyDeleted: true,
        ledgerRowsDeleted: 4,
      },
    ]);
  });

  const refusals: [string, () => string[], string][] = [
    [
      "the snapshot file is missing",
      () => purgeArgs(path.join(dir, "absent.json"), pairedDump()),
      "does not exist",
    ],
    [
      "the dump carries another snapshot id",
      () => purgeArgs(writeSnapshot("s.json"), pairedDump("snap-other")),
      "unpaired",
    ],
    [
      "fallback mode: the snapshot is newer than the dump",
      () => {
        const dump = path.join(dir, "bare.dump");
        fs.writeFileSync(dump, "dump");
        const old = new Date("2026-09-15T09:00:00Z");
        fs.utimesSync(dump, old, old);
        return purgeArgs(writeSnapshot("s.json"), pathToFileURL(dump).href);
      },
      "stale",
    ],
    [
      "imageCommit differs from build-info",
      () =>
        purgeArgs(
          writeSnapshot("s.json", { imageCommit: "old" }),
          pairedDump(),
        ),
      "wrong image",
    ],
    [
      "a target is a keeper",
      () =>
        purgeArgs(writeSnapshot("s.json"), pairedDump(), [...TARGETS, "u-15"]),
      "is a keeper",
    ],
    [
      "keepers ∪ targets is not every snapshot company",
      () =>
        purgeArgs(writeSnapshot("s.json"), pairedDump(), ["u-4", "u-5", "u-2"]),
      "neither",
    ],
  ];

  it.each(refusals)(
    "refuses when %s, reaching neither the lookup nor the purge",
    async (_label, args, reason) => {
      const code = await runPurgeCompanies(args(), deps());
      expect(code).toBe(1);
      expect(err.join("\n")).toContain(reason);
      expect(mockGetIdByUuid).not.toHaveBeenCalled();
      expect(mockPurgeCompany).not.toHaveBeenCalled();
    },
  );

  it("refuses a target whose companies/<id>/ prefix has no verified archive copy, and purges once it has", async () => {
    s3.put(FILES, "companies/16/files/a.pdf", 10);
    const args = [
      ...purgeArgs(writeSnapshot("s.json"), pairedDump()),
      "--archive",
      ARCHIVE_URL,
    ];
    expect(await runPurgeCompanies(args, deps())).toBe(1);
    expect(err.join("\n")).toContain("companies/16/");
    expect(mockPurgeCompany).not.toHaveBeenCalled();

    s3.put(
      "env-bucket",
      "backups/purge-2026-09-15/companies-16/files/a.pdf",
      10,
    );
    err = [];
    expect(await runPurgeCompanies(args, deps())).toBe(0);
    expect(mockPurgeCompany).toHaveBeenCalledTimes(4);
  });

  it("refuses a target that already lives in a dedicated database, reaching no purge", async () => {
    offShared = ["company 4 (tenant_4_corrunor)"];
    const code = await runPurgeCompanies(
      purgeArgs(writeSnapshot("s.json"), pairedDump()),
      deps(),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("company 4 (tenant_4_corrunor)");
    expect(mockPurgeCompany).not.toHaveBeenCalled();
  });

  it("refuses before any other read when another backend is connected", async () => {
    backends = [
      {
        pid: 7,
        usename: "traffic_user",
        application_name: "api",
        client_addr: null,
      },
    ];
    const code = await runPurgeCompanies(
      purgeArgs(path.join(dir, "absent.json"), pairedDump()),
      deps(),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("other backends");
    expect(err.join("\n")).not.toContain("does not exist");
    expect(rawCalls).toHaveLength(1);
  });

  it("resolves every uuid before purging any, so an unresolvable one changes nothing", async () => {
    mockGetIdByUuid.mockImplementation(async (uuid) =>
      uuid === "u-16" ? null : (IDS[uuid] ?? null),
    );
    expect(
      await runPurgeCompanies(
        purgeArgs(writeSnapshot("s.json"), pairedDump()),
        deps(),
      ),
    ).toBe(1);
    expect(mockPurgeCompany).not.toHaveBeenCalled();
  });

  it("stops at the first company the purge did not delete", async () => {
    mockPurgeCompany.mockImplementationOnce(async () => ({
      companyDeleted: false,
      ledgerRowsDeleted: 0,
    }));
    expect(
      await runPurgeCompanies(
        purgeArgs(writeSnapshot("s.json"), pairedDump()),
        deps(),
      ),
    ).toBe(1);
    expect(mockPurgeCompany).toHaveBeenCalledTimes(1);
  });

  it("wires CompanyDAO.getIdByUuid and purgeCompany inside the shared core tenant target", async () => {
    mockPurgeCompany.mockImplementationOnce(() => ({
      inTarget: mockActiveTarget,
    }));
    const wired = purgeCompaniesDeps(new PurgeObjectStore(s3.send, FILES));
    await wired.companyIdByUuid("u-6");
    const result = await wired.purge(6);
    expect(mockGetIdByUuid).toHaveBeenCalledWith("u-6");
    expect(mockPurgeCompany).toHaveBeenCalledWith(6);
    expect(result).toEqual({ inTarget: "core" });
  });
});

describe("AC-82 — the scripts refuse a missing or dirty stamp in production", () => {
  it.each([
    ["absent", null],
    ["dirty", JSON.stringify({ commit: "abc123", dirty: true, builtAt: "x" })],
  ])("purge-companies refuses a %s stamp", async (_label, value) => {
    stamp = value;
    expect(
      await runPurgeCompanies(
        purgeArgs(writeSnapshot("s.json"), pairedDump()),
        deps(),
      ),
    ).toBe(1);
    expect(mockPurgeCompany).not.toHaveBeenCalled();
  });

  it("purge-gate refuses an absent stamp before any gate query", async () => {
    stamp = null;
    const code = await runPurgeGateCli(
      [
        "--snapshot",
        writeSnapshot("s.json"),
        "--dump",
        pairedDump(),
        "--keepers",
        "u-3",
        "u-6",
        "u-15",
      ],
      {
        knex,
        store: new PurgeObjectStore(s3.send, FILES),
        commitSources: commitSources(),
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("build-info.json is absent");
    expect(rawCalls).toHaveLength(1);
  });

  it("db-snapshot-counts refuses an absent stamp before opening the snapshot", async () => {
    stamp = null;
    const code = await runDbSnapshotCounts(
      ["--keepers", "u-3", "--out", path.join(dir, "out")],
      {
        knex,
        store: new PurgeObjectStore(s3.send, FILES),
        commitSources: commitSources(),
        explicitlyPurgedTables: [],
        now: () => new Date(),
        waitForRelease: async () => undefined,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      },
    );
    expect(code).toBe(1);
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
  });
});

describe("purge-gate argument handling", () => {
  it("rejects an unknown --attribution-mode without touching the database", async () => {
    const code = await runPurgeGateCli(
      [
        "--snapshot",
        "s",
        "--dump",
        "file:///d",
        "--keepers",
        "u-3",
        "--attribution-mode",
        "maybe",
      ],
      {
        knex,
        store: new PurgeObjectStore(s3.send, FILES),
        commitSources: commitSources(),
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      },
    );
    expect(code).toBe(2);
    expect(rawCalls).toEqual([]);
  });
});

describe("AC-81 — purge-companies archive-s3", () => {
  const archiveArgs = (mode: string, company = "u-16"): string[] => [
    "archive-s3",
    "--snapshot",
    writeSnapshot("s.json"),
    "--company",
    company,
    "--archive",
    ARCHIVE_URL,
    mode,
  ];

  beforeEach(() => {
    s3.put(FILES, "companies/16/files/a.pdf", 10);
    s3.put(FILES, "companies/16/files/b.pdf", 25);
    s3.put(FILES, "companies/6/files/keep.pdf", 7);
  });

  it("--copy-only copies companies/<id>/ to backups/purge-<date>/companies-<id>/ and verifies it", async () => {
    expect(await runPurgeCompanies(archiveArgs("--copy-only"), deps())).toBe(0);
    expect(s3.keys("env-bucket", "")).toEqual([
      "backups/purge-2026-09-15/companies-16/files/a.pdf",
      "backups/purge-2026-09-15/companies-16/files/b.pdf",
    ]);
    expect(s3.keys(FILES, "companies/16/")).toHaveLength(2);
    expect(out.join("\n")).toContain("2 objects, 35 bytes");
  });

  it("--delete-source refuses without a verified copy and deletes nothing", async () => {
    s3.put(
      "env-bucket",
      "backups/purge-2026-09-15/companies-16/files/a.pdf",
      10,
    );
    expect(
      await runPurgeCompanies(archiveArgs("--delete-source"), deps()),
    ).toBe(1);
    expect(s3.keys(FILES, "companies/16/")).toHaveLength(2);
    expect(s3.sent.some((c) => c.command === "DeleteObjectsCommand")).toBe(
      false,
    );
  });

  it("--delete-source deletes only that company's prefix once the copy is verified", async () => {
    expect(await runPurgeCompanies(archiveArgs("--copy-only"), deps())).toBe(0);
    expect(
      await runPurgeCompanies(archiveArgs("--delete-source"), deps()),
    ).toBe(0);
    expect(s3.keys(FILES, "companies/")).toEqual([
      "companies/6/files/keep.pdf",
    ]);
    expect(s3.keys("env-bucket", "")).toHaveLength(2);
  });

  it("refuses a keeper company", async () => {
    expect(
      await runPurgeCompanies(archiveArgs("--copy-only", "u-6"), deps()),
    ).toBe(1);
    expect(s3.sent).toEqual([]);
  });

  it("needs exactly one of --copy-only / --delete-source", async () => {
    const args = archiveArgs("--copy-only");
    expect(await runPurgeCompanies([...args, "--delete-source"], deps())).toBe(
      2,
    );
  });
});

describe("db-snapshot-counts upload", () => {
  it("uploads with x-amz-meta-snapshot-id and writes the local sidecar", async () => {
    const dump = path.join(dir, "traffic_production.pre-purge.dump");
    fs.writeFileSync(dump, "0123456789");
    const code = await runDbSnapshotCounts(
      [
        "upload",
        "--dump",
        dump,
        "--snapshot",
        writeSnapshot("s.json"),
        "--to",
        `${ARCHIVE_URL}traffic_production.pre-purge.dump`,
      ],
      {
        knex,
        store: new PurgeObjectStore(s3.send, FILES),
        commitSources: commitSources(),
        explicitlyPurgedTables: [],
        now: () => new Date(),
        waitForRelease: async () => undefined,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      },
    );
    expect(code).toBe(0);
    const put = s3.sent.find((c) => c.command === "PutObjectCommand");
    expect(put?.input.Metadata).toEqual({ "snapshot-id": "snap-1" });
    expect(put?.input.ContentLength).toBe(10);
    expect(fs.readFileSync(`${dump}.snapshot-id`, "utf8").trim()).toBe(
      "snap-1",
    );
    expect(rawCalls).toEqual([]);
  });
});
