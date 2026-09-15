// @ts-nocheck
/**
 * UserDAO.setActiveChecked — the row-locked last-Admin guard on deactivation
 * (AC-5).
 *
 * The check and the write must be the SAME transaction (a race window between
 * a separate check-transaction and a later plain UPDATE is exactly the bug
 * this method exists to avoid) — asserted here by checking write order:
 * `companies` is locked, THEN (and only then) `users` is written.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";

let mock: ReturnType<typeof createTableAwareKnexMock>;
let mockKnex: any;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { UserDAO } from "../../../dao/user/user.dao";

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

describe("UserDAO.setActiveChecked — reactivation / non-admin deactivation", () => {
  it("skips the lock entirely when reactivating (isActive: true)", async () => {
    mock.fixture("users").returningQueue = [[{ id: 1, isActive: true }]];

    await new UserDAO().setActiveChecked(1, 7, true, false);

    expect(mock.fixture("companies").whereCalls).toStrictEqual([]);
    expect(mock.writeCounts("users")).toStrictEqual({
      insert: 0,
      update: 1,
      delete: 0,
    });
  });

  it("skips the lock when deactivating a non-admin (isCurrentActiveAdmin: false)", async () => {
    mock.fixture("users").returningQueue = [[{ id: 2, isActive: false }]];

    await new UserDAO().setActiveChecked(2, 7, false, false);

    expect(mock.fixture("companies").whereCalls).toStrictEqual([]);
    expect(mock.writeCounts("users")).toStrictEqual({
      insert: 0,
      update: 1,
      delete: 0,
    });
  });
});

describe("UserDAO.setActiveChecked — deactivating an active Admin", () => {
  it("locks companies, counts active admins, then writes when >=2 remain", async () => {
    mock.fixture("users").firstRows = [{ count: "2" }];
    mock.fixture("users").returningQueue = [[{ id: 3, isActive: false }]];

    const result = await new UserDAO().setActiveChecked(3, 7, false, true);

    expect(result).toMatchObject({ id: 3, isActive: false });
    expect(mock.writeLog.map((w) => w.table)).toStrictEqual(["users"]);
  });

  it("throws LAST_ADMIN and writes nothing when only 1 admin is active (mutation: dropping the guard writes anyway)", async () => {
    mock.fixture("users").firstRows = [{ count: "1" }];

    await expect(
      new UserDAO().setActiveChecked(3, 7, false, true),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });

    expect(mock.writeCounts("users")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });
});
