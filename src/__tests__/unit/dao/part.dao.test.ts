// @ts-nocheck
/**
 * PartDAO — code generation (MAX+1 anchored regex) and approval semantics,
 * INCLUDING the two sanctioned Procusto bulk quirks (08-approvals.md):
 *   - bulkApprove does NOT clear cancellation columns
 *   - bulkUnapprove nulls approvals leaving PENDING (never stamps cancellation)
 * If a refactor "fixes" either quirk, these tests MUST scream — the quirks are
 * parity requirements, not bugs.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// ── Table-aware thenable knex mock ──────────────────────────────────────────
let fixtures; // { [table]: { firstRows: [], rows: [], updateCaptures: [], insertCaptures: [] } }

const makeBuilder = (table) => {
  const f = fixtures[table] ?? (fixtures[table] = {});
  const b = {};
  const chain = (name) => (b[name] = jest.fn(() => b));
  [
    "select", "where", "whereIn", "whereNull", "whereNotNull", "orderBy",
    "modify", "forUpdate", "leftJoin", "join", "limit", "offset", "groupBy",
  ].forEach(chain);
  b.first = jest.fn(() => Promise.resolve((f.firstRows ?? []).shift() ?? null));
  b.update = jest.fn((data) => {
    (f.updateCaptures ?? (f.updateCaptures = [])).push(data);
    return b;
  });
  b.insert = jest.fn((data) => {
    (f.insertCaptures ?? (f.insertCaptures = [])).push(data);
    return b;
  });
  b.delete = jest.fn(() => Promise.resolve(f.deleteCount ?? 1));
  b.returning = jest.fn(() => Promise.resolve(f.returningRows ?? []));
  b.count = jest.fn(() => b);
  b.then = (resolve, reject) => Promise.resolve(f.rows ?? []).then(resolve, reject);
  return b;
};

let mockKnex;

jest.mock("../../../database/KnexConnection", () => ({
  __esModule: true,
  default: { getConnection: () => mockKnex },
}));

import { PartDAO } from "../../../dao/part/part.dao";

beforeEach(() => {
  fixtures = {};
  mockKnex = jest.fn((table) => makeBuilder(table));
  mockKnex.transaction = async (cb) => cb(mockKnex);
  mockKnex.fn = { now: jest.fn(() => "NOW()") };
  mockKnex.raw = jest.fn((s) => s);
});

afterEach(() => jest.restoreAllMocks());

describe("PartDAO.generateCode (09-code-generation.md MAX+1, anchored)", () => {
  it("takes MAX of strictly-matching suffixes +1, skipping foreign-shaped codes", async () => {
    fixtures.products = { firstRows: [{ code: "BOX(A)" }] };
    fixtures.parts = {
      rows: [
        { code: "BOX(A)/1" },
        { code: "BOX(A)/2x" }, // junk suffix — must be skipped
        { code: "BOX(A)/3-old" }, // foreign-shaped — skipped
        { code: "OTHER/9" }, // different product — skipped
        { code: "BOX(A)/2" },
        { code: null },
      ],
    };
    const dao = new PartDAO();
    // Product code contains regex metachars — the escape must hold.
    expect(await dao.generateCode(42)).toBe("BOX(A)/3");
  });

  it("starts at /1 for the first part", async () => {
    fixtures.products = { firstRows: [{ code: "P100" }] };
    fixtures.parts = { rows: [] };
    const dao = new PartDAO();
    expect(await dao.generateCode(42)).toBe("P100/1");
  });
});

describe("PartDAO.setApproval (pair semantics)", () => {
  it("approve stamps the pair and NULLS the cancellation", async () => {
    fixtures.parts = { returningRows: [{ uuid: "u1" }] };
    const dao = new PartDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "u1" });
    await dao.setApproval(7, "dimensions", "approve", "user@x");
    const update = fixtures.parts.updateCaptures[0];
    expect(update.dimensionsApprovalAt).toBe("NOW()");
    expect(update.dimensionsApprovalBy).toBe("user@x");
    expect(update.dimensionsCancelledAt).toBeNull();
    expect(update.dimensionsCancelledBy).toBeNull();
    const event = fixtures.part_approval_events.insertCaptures[0];
    expect(event).toMatchObject({ partId: 7, stateMachine: "dimensions", action: "approve" });
  });

  it("cancel stamps the cancellation and NULLS the approval", async () => {
    fixtures.parts = { returningRows: [{ uuid: "u1" }] };
    const dao = new PartDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "u1" });
    await dao.setApproval(7, "part", "cancel", "user@x");
    const update = fixtures.parts.updateCaptures[0];
    expect(update.partCancelledAt).toBe("NOW()");
    expect(update.partCancelledBy).toBe("user@x");
    expect(update.partApprovalAt).toBeNull();
    expect(update.partApprovalBy).toBeNull();
  });
});

describe("PartDAO bulk quirks (sanctioned Procusto parity — do NOT 'fix')", () => {
  it("bulkApprove sets the 3 machines but NEVER clears cancellations, never sketch", async () => {
    const dao = new PartDAO();
    await dao.bulkApprove([1, 2], "user@x");
    const update = fixtures.parts.updateCaptures[0];
    for (const m of ["dimensions", "technical", "part"]) {
      expect(update[`${m}ApprovalAt`]).toBe("NOW()");
      expect(update[`${m}ApprovalBy`]).toBe("user@x");
      // THE QUIRK: cancellation columns untouched (a cancelled part becomes
      // both-set — exactly what Procusto's Listar.Aprobar does).
      expect(update).not.toHaveProperty(`${m}CancelledAt`);
      expect(update).not.toHaveProperty(`${m}CancelledBy`);
    }
    expect(update).not.toHaveProperty("sketchApprovalAt");
    const events = fixtures.part_approval_events.insertCaptures.flat();
    expect(events).toHaveLength(6); // 2 parts × 3 machines
    expect(events.every((e) => e.action === "approve")).toBe(true);
    expect(events.some((e) => e.stateMachine === "sketch")).toBe(false);
  });

  it("bulkUnapprove nulls approvals (PENDING), leaves cancellations, logs 'unapprove'", async () => {
    const dao = new PartDAO();
    await dao.bulkUnapprove([5], "user@x");
    const update = fixtures.parts.updateCaptures[0];
    for (const m of ["dimensions", "technical", "part"]) {
      expect(update[`${m}ApprovalAt`]).toBeNull();
      expect(update[`${m}ApprovalBy`]).toBe("");
      // THE QUIRK: cancellations untouched — state is PENDING, not CANCELLED.
      expect(update).not.toHaveProperty(`${m}CancelledAt`);
    }
    const events = fixtures.part_approval_events.insertCaptures.flat();
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.action === "unapprove")).toBe(true);
  });
});
