// @ts-nocheck
/**
 * CountdownGroupDAO.setMembers — membership is diffed, not rewritten
 * (audit P1b, track T4; AC-3, AC-7, AC-9).
 *
 * The method used to delete every membership row and re-insert the whole list,
 * so saving a group without touching it churned every row's identity and, once
 * P2's triggers land, would log "N deleted, N created" for a no-op. What is
 * asserted here is exactly the property that made that visible and that a
 * careless "simplification" would undo: **an unchanged member set issues zero
 * write statements**, and a changed one issues one bulk statement per direction.
 *
 * `countdown_group_members` is a pure set — beyond `(groupId, userId)` the row
 * holds only its uuid and timestamps — so there is nothing to compare and no
 * UPDATE may ever appear on this table.
 *
 * Uses the shared table-aware, write-counting knex mock (brief D4), which is
 * the only mock in this repo that can prove a *zero*: its `delete` records a
 * marker, so "no DELETE was issued" is assertable rather than assumed.
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

import { CountdownGroupDAO } from "../../../dao/countdown/countdown-group.dao";

const MEMBERS = "countdown_group_members";
const GROUP_ID = 42;

/** RFC 4122 v4, as `uuidv4()` emits it — version nibble 4, variant 8/9/a/b. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Stored membership rows; the DAO only ever reads back `userId`. */
const stored = (...userIds) => userIds.map((userId) => ({ userId }));

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("CountdownGroupDAO.setMembers — unchanged sets write nothing (AC-3)", () => {
  it("issues zero INSERT, UPDATE and DELETE when the member set is identical", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8, 9);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7, 8, 9]);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
    expect(mock.writeLog).toStrictEqual([]);
  });

  it("ignores the order the members arrive in — a set has none", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8, 9);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [9, 7, 8]);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });

  it("reads the existing membership scoped to this group only", async () => {
    mock.fixture(MEMBERS).rows = stored(7);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7]);

    expect(mock.fixture(MEMBERS).whereCalls).toStrictEqual([
      [{ groupId: GROUP_ID }],
    ]);
  });
});

describe("CountdownGroupDAO.setMembers — one bulk statement per direction (AC-7)", () => {
  it("adding one member issues exactly one bulk INSERT and no DELETE", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7, 8, 9]);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(
      mock.insertedRows(MEMBERS).map((row) => [row.groupId, row.userId]),
    ).toStrictEqual([[GROUP_ID, 9]]);
  });

  it("removing one member issues exactly one bulk DELETE and no INSERT", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8, 9);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7, 9]);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    // The delete names the leaver and nobody else: scoped to the group, then
    // narrowed to the removed userIds.
    expect(mock.fixture(MEMBERS).whereCalls).toStrictEqual([
      [{ groupId: GROUP_ID }],
      [{ groupId: GROUP_ID }],
      ["userId", [8]],
    ]);
  });

  it("adding and removing at once issues exactly one of each, delete first", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7, 9]);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
    expect(mock.writeLog.map((write) => write.op)).toStrictEqual([
      "delete",
      "insert",
    ]);
    expect(mock.insertedRows(MEMBERS).map((row) => row.userId)).toStrictEqual([
      9,
    ]);
  });

  it("emptying the group deletes every member in one statement", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8, 9);

    await new CountdownGroupDAO().setMembers(GROUP_ID, []);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(mock.fixture(MEMBERS).whereCalls).toContainEqual([
      "userId",
      [7, 8, 9],
    ]);
  });

  it("filling an empty group inserts every member in one statement", async () => {
    mock.fixture(MEMBERS).rows = [];

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7, 8]);

    expect(mock.writeCounts(MEMBERS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(mock.insertedRows(MEMBERS)).toHaveLength(2);
  });

  it("never issues an UPDATE — the row has no updatable column", async () => {
    mock.fixture(MEMBERS).rows = stored(7, 8);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [8, 9]);

    expect(mock.writeLog.some((write) => write.op === "update")).toBe(false);
  });
});

describe("CountdownGroupDAO.setMembers — server-generated uuids (AC-9)", () => {
  it("mints a distinct uuidv4 for every inserted membership row", async () => {
    mock.fixture(MEMBERS).rows = [];

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7, 8, 9]);

    const uuids = mock.insertedRows(MEMBERS).map((row) => row.uuid);
    expect(uuids).toHaveLength(3);
    uuids.forEach((uuid) => expect(uuid).toMatch(UUID_V4));
    expect(new Set(uuids).size).toBe(3);
  });

  it("writes only the key columns and the uuid", async () => {
    mock.fixture(MEMBERS).rows = [];

    await new CountdownGroupDAO().setMembers(GROUP_ID, [7]);

    expect(Object.keys(mock.insertedRows(MEMBERS)[0]).sort()).toStrictEqual([
      "groupId",
      "userId",
      "uuid",
    ]);
  });
});

describe("CountdownGroupDAO.setMembers — transaction (unchanged by P1b)", () => {
  it("still runs the whole diff inside its own transaction", async () => {
    mock.fixture(MEMBERS).rows = stored(7);

    await new CountdownGroupDAO().setMembers(GROUP_ID, [8]);

    expect(mockKnex.transaction).toHaveBeenCalledTimes(1);
  });
});
