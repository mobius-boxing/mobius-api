// @ts-nocheck
/**
 * CountdownAssignmentDAO.replace — assignments are diffed, not rewritten
 * (audit P1b, track T4; AC-3, AC-7, AC-8, AC-9).
 *
 * `replace()` used to delete every assignment of a document and re-insert the
 * four incoming arrays wholesale, so changing one watcher group rewrote the
 * resolvers too. Under P2's triggers that reads as "everyone was unassigned and
 * reassigned" on every save. The properties pinned here: an identical payload
 * writes **nothing**, a changed one writes one bulk statement per direction and
 * touches nothing else, and the method never issues an UPDATE (an assignment
 * row *is* its key — there is no column to update).
 *
 * The subtle part is the key. The table carries two **partial** unique indexes,
 * `("documentId", kind, "userId") where "userId" is not null` and the same for
 * `"groupId"`, and the "a row is a user assignment or a group assignment"
 * invariant has no CHECK behind it. So the key is `"<kind>|u:<id>"` /
 * `"<kind>|g:<id>"` and the disjointness of those two spaces is asserted
 * directly — with one key space, assigning user 5 and group 5 as resolvers
 * would silently drop one of them.
 *
 * Uses the shared table-aware, write-counting knex mock (brief D4): its
 * `delete` records a marker, which is what makes "zero DELETE" assertable.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";

let mock;
let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { CountdownAssignmentDAO } from "../../../dao/countdown/countdown-assignment.dao";

const ASSIGNMENTS = "countdown_document_assignments";
const DOCUMENT_ID = 77;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The service always passes all four arrays; absent ones arrive empty. */
const input = (overrides = {}) => ({
  resolverUserIds: [],
  resolverGroupIds: [],
  watcherUserIds: [],
  watcherGroupIds: [],
  ...overrides,
});

/** A stored row as `replace()` reads it back. */
const userRow = (id, kind, userId) => ({ id, kind, userId, groupId: null });
const groupRow = (id, kind, groupId) => ({ id, kind, userId: null, groupId });

/** ids named in the bulk delete, from the mock's captured `whereIn`. */
const deletedIds = () => {
  const call = mock
    .fixture(ASSIGNMENTS)
    .whereCalls.find((args) => args[0] === "id");
  return call ? call[1] : [];
};

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("CountdownAssignmentDAO.replace — unchanged sets write nothing (AC-3)", () => {
  it("issues zero INSERT, UPDATE and DELETE for an identical assignment set", async () => {
    mock.fixture(ASSIGNMENTS).rows = [
      userRow(1, "resolver", 5),
      groupRow(2, "resolver", 9),
      userRow(3, "watcher", 6),
      groupRow(4, "watcher", 8),
    ];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({
        resolverUserIds: [5],
        resolverGroupIds: [9],
        watcherUserIds: [6],
        watcherGroupIds: [8],
      }),
    );

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
    expect(mock.writeLog).toStrictEqual([]);
  });

  it("writes nothing when the document has, and keeps having, no assignments", async () => {
    mock.fixture(ASSIGNMENTS).rows = [];

    await new CountdownAssignmentDAO().replace(DOCUMENT_ID, input());

    expect(mock.writeLog).toStrictEqual([]);
  });

  it("reads the stored assignments scoped to this document", async () => {
    mock.fixture(ASSIGNMENTS).rows = [];

    await new CountdownAssignmentDAO().replace(DOCUMENT_ID, input());

    expect(mock.fixture(ASSIGNMENTS).whereCalls).toStrictEqual([
      [{ documentId: DOCUMENT_ID }],
    ]);
  });
});

describe("CountdownAssignmentDAO.replace — one bulk statement per direction (AC-7)", () => {
  it("adding one watcher issues exactly one bulk INSERT and no DELETE", async () => {
    mock.fixture(ASSIGNMENTS).rows = [userRow(1, "resolver", 5)];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [5], watcherUserIds: [6] }),
    );

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(
      mock.insertedRows(ASSIGNMENTS).map((row) => [row.kind, row.userId]),
    ).toStrictEqual([["watcher", 6]]);
  });

  it("removing one resolver issues exactly one bulk DELETE and no INSERT", async () => {
    mock.fixture(ASSIGNMENTS).rows = [
      userRow(1, "resolver", 5),
      userRow(2, "resolver", 6),
    ];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [5] }),
    );

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(deletedIds()).toStrictEqual([2]);
  });

  it("adding and removing at once issues exactly one of each, delete first", async () => {
    mock.fixture(ASSIGNMENTS).rows = [groupRow(4, "watcher", 8)];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ watcherGroupIds: [9] }),
    );

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
    expect(mock.writeLog.map((write) => write.op)).toStrictEqual([
      "delete",
      "insert",
    ]);
    expect(deletedIds()).toStrictEqual([4]);
    expect(
      mock.insertedRows(ASSIGNMENTS).map((row) => [row.kind, row.groupId]),
    ).toStrictEqual([["watcher", 9]]);
  });

  it("changing only the watcher groups leaves every resolver row untouched", async () => {
    mock.fixture(ASSIGNMENTS).rows = [
      userRow(1, "resolver", 5),
      userRow(2, "resolver", 6),
      groupRow(3, "resolver", 9),
      groupRow(4, "watcher", 8),
    ];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({
        resolverUserIds: [5, 6],
        resolverGroupIds: [9],
        watcherGroupIds: [8, 11],
      }),
    );

    // One INSERT for the new watcher group, and no DELETE at all: ids 1, 2 and
    // 3 are never named, so the resolvers keep their ids and their uuids.
    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(
      mock.insertedRows(ASSIGNMENTS).map((row) => [row.kind, row.groupId]),
    ).toStrictEqual([["watcher", 11]]);
  });

  it("never issues an UPDATE — an assignment row is its own key", async () => {
    mock.fixture(ASSIGNMENTS).rows = [userRow(1, "resolver", 5)];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ watcherUserIds: [5] }),
    );

    expect(mock.writeLog.some((write) => write.op === "update")).toBe(false);
  });

  it("clearing every assignment deletes them all in one statement", async () => {
    mock.fixture(ASSIGNMENTS).rows = [
      userRow(1, "resolver", 5),
      groupRow(2, "watcher", 8),
    ];

    await new CountdownAssignmentDAO().replace(DOCUMENT_ID, input());

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(deletedIds()).toStrictEqual([1, 2]);
  });
});

describe("CountdownAssignmentDAO.replace — the user and group key spaces are disjoint", () => {
  it("does not confuse user 5 with group 5 under the same kind", async () => {
    mock.fixture(ASSIGNMENTS).rows = [userRow(1, "resolver", 5)];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [5], resolverGroupIds: [5] }),
    );

    // The stored user row survives; only the group is new.
    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(
      mock
        .insertedRows(ASSIGNMENTS)
        .map((row) => [row.kind, row.userId, row.groupId]),
    ).toStrictEqual([["resolver", null, 5]]);
  });

  it("does not confuse the same user across the two kinds", async () => {
    mock.fixture(ASSIGNMENTS).rows = [userRow(1, "resolver", 5)];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [5], watcherUserIds: [5] }),
    );

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(
      mock.insertedRows(ASSIGNMENTS).map((row) => [row.kind, row.userId]),
    ).toStrictEqual([["watcher", 5]]);
  });

  it("cleans up a stored row that has neither subject — no CHECK enforces the XOR", async () => {
    mock.fixture(ASSIGNMENTS).rows = [
      { id: 1, kind: "resolver", userId: null, groupId: null },
    ];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverGroupIds: [9] }),
    );

    // The orphan keys on a null group, which no incoming target can produce, so
    // it is deleted rather than silently kept.
    expect(deletedIds()).toStrictEqual([1]);
    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
  });
});

describe("CountdownAssignmentDAO.replace — all three call shapes (AC-8)", () => {
  it("runs in its own transaction when no trx is passed (setAssignments)", async () => {
    mock.fixture(ASSIGNMENTS).rows = [userRow(1, "resolver", 5)];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [6] }),
    );

    expect(mockKnex.transaction).toHaveBeenCalledTimes(1);
    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
  });

  it("uses the caller's trx and opens none of its own (renewal copy)", async () => {
    const outer = createTableAwareKnexMock();
    outer.fixture(ASSIGNMENTS).rows = [];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [5], watcherGroupIds: [8] }),
      outer.knexMock,
    );

    expect(mockKnex.transaction).not.toHaveBeenCalled();
    // Every statement landed on the passed transaction, none on the pool.
    expect(outer.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(mock.writeLog).toStrictEqual([]);
    expect(outer.insertedRows(ASSIGNMENTS)).toHaveLength(2);
  });

  it("inserts the whole set, and deletes nothing, for a brand-new document (create)", async () => {
    mock.fixture(ASSIGNMENTS).rows = [];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({
        resolverUserIds: [5, 6],
        resolverGroupIds: [9],
        watcherUserIds: [7],
        watcherGroupIds: [8],
      }),
    );

    expect(mock.writeCounts(ASSIGNMENTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(
      mock
        .insertedRows(ASSIGNMENTS)
        .map((row) => [row.documentId, row.kind, row.userId, row.groupId]),
    ).toStrictEqual([
      [DOCUMENT_ID, "resolver", 5, null],
      [DOCUMENT_ID, "resolver", 6, null],
      [DOCUMENT_ID, "resolver", null, 9],
      [DOCUMENT_ID, "watcher", 7, null],
      [DOCUMENT_ID, "watcher", null, 8],
    ]);
  });
});

describe("CountdownAssignmentDAO.replace — server-generated uuids (AC-9)", () => {
  it("mints a distinct uuidv4 for every inserted assignment row", async () => {
    mock.fixture(ASSIGNMENTS).rows = [];

    await new CountdownAssignmentDAO().replace(
      DOCUMENT_ID,
      input({ resolverUserIds: [5, 6], watcherGroupIds: [8] }),
    );

    const uuids = mock.insertedRows(ASSIGNMENTS).map((row) => row.uuid);
    expect(uuids).toHaveLength(3);
    uuids.forEach((uuid) => expect(uuid).toMatch(UUID_V4));
    expect(new Set(uuids).size).toBe(3);
  });
});
