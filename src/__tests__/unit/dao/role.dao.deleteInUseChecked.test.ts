// @ts-nocheck
/**
 * RoleDAO.deleteInUseChecked — detaching non-pending invitations before the
 * DELETE.
 *
 * `invitations.roleId` is `ON DELETE RESTRICT`, so a used or expired
 * invitation still pointing at a role blocks the DELETE at the database even
 * though `assertNotInUse` (correctly) never treats a used/expired invitation
 * as "in use". Without the detach step below, deleting a role whose only
 * remaining references are stale invitations 500s instead of succeeding.
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

let mock: ReturnType<typeof createTableAwareKnexMock>;
let mockKnex: any;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { RoleDAO } from "../../../dao/role/role.dao";

const ROLE_ID = 9;

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
  mock.fixture("users").firstRows = [{ count: "0" }];
  mock.fixture("invitations").firstRows = [{ count: "0" }];
});

afterEach(() => jest.restoreAllMocks());

describe("RoleDAO.deleteInUseChecked — detaches stale invitations, then deletes", () => {
  it("nulls roleId on the role's non-pending invitations before deleting it", async () => {
    await new RoleDAO().deleteInUseChecked(ROLE_ID);

    expect(mock.writeCounts("invitations")).toStrictEqual({
      insert: 0,
      update: 1,
      delete: 0,
    });
    expect(mock.fixture("invitations").updateCaptures).toStrictEqual([
      { roleId: null },
    ]);
    expect(mock.writeCounts("roles")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
  });

  it("detaches invitations before deleting the role, not after (FK order)", async () => {
    await new RoleDAO().deleteInUseChecked(ROLE_ID);

    const tables = mock.writeLog.map((w) => w.table);
    expect(tables.indexOf("invitations")).toBeLessThan(tables.indexOf("roles"));
  });

  it("still blocks the whole transaction when a user references the role (ROLE_IN_USE) — no detach, no delete", async () => {
    mock.fixture("users").firstRows = [{ count: "1" }];

    await expect(
      new RoleDAO().deleteInUseChecked(ROLE_ID),
    ).rejects.toMatchObject({ code: "ROLE_IN_USE" });

    expect(mock.writeCounts("invitations")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
    expect(mock.writeCounts("roles")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });

  it("still blocks on a pending invitation (ROLE_IN_USE) before ever touching a stale one", async () => {
    mock.fixture("invitations").firstRows = [{ count: "1" }];

    await expect(
      new RoleDAO().deleteInUseChecked(ROLE_ID),
    ).rejects.toMatchObject({ code: "ROLE_IN_USE" });

    expect(mock.writeCounts("invitations")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });
});
