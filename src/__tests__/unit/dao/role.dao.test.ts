// @ts-nocheck
/**
 * RoleDAO.setPermissions — grant diffing (audit P1b, track T5, AC-7 / AC-9).
 *
 * `role_permissions` is a pure join table, so the method is one `diffSets`
 * call: one bulk DELETE for revoked grants, one bulk INSERT for new ones, and
 * nothing at all when the grid did not change. These tests count statements
 * per table with the shared table-aware knex mock (brief D4) — the "unchanged
 * grid writes nothing" case is the one that fails if the old delete-all-and-
 * reinsert ever comes back (mutation-checked per L-018).
 *
 * The DELETE scope is asserted explicitly: a diff bug that dropped the
 * `roleId` predicate would revoke other roles' permissions, which is a
 * security defect, not a tidiness one.
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

import { RoleDAO } from "../../../dao/role/role.dao";

const GRANTS = "role_permissions";
const PERMISSIONS = "permissions";
const ROLE_ID = 7;
const COMPANY_ID = 3;

/** The company's catalogue, as `permissions` answers the code lookup. */
const catalogue = {
  "orders.view": 11,
  "orders.edit": 12,
  "orders.delete": 13,
};

/** Stub the two SELECTs: resolvable codes, and the role's stored grants. */
const givenGrid = (catalogueCodes, storedPermissionIds) => {
  mock.fixture(PERMISSIONS).rows = catalogueCodes.map((code) => ({
    id: catalogue[code],
    code,
  }));
  mock.fixture(GRANTS).rows = storedPermissionIds.map((permissionId) => ({
    permissionId,
  }));
};

const setPermissions = (codes) =>
  new RoleDAO().setPermissions(ROLE_ID, COMPANY_ID, codes);

const noWrites = { insert: 0, update: 0, delete: 0 };

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("RoleDAO.setPermissions — unchanged grid writes nothing (AC-7)", () => {
  it("issues zero statements when the payload matches the stored grants", async () => {
    givenGrid(["orders.view", "orders.edit"], [11, 12]);

    const applied = await setPermissions(["orders.view", "orders.edit"]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual(noWrites);
    expect(mock.writeLog).toStrictEqual([]);
    expect(applied).toStrictEqual(["orders.view", "orders.edit"]);
  });

  it("issues zero statements when an empty payload meets an empty grid", async () => {
    givenGrid([], []);

    const applied = await setPermissions([]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual(noWrites);
    expect(applied).toStrictEqual([]);
  });

  it("ignores the order the codes arrive in", async () => {
    givenGrid(["orders.view", "orders.edit"], [12, 11]);

    await setPermissions(["orders.edit", "orders.view"]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual(noWrites);
  });
});

describe("RoleDAO.setPermissions — one grant, one revocation (AC-7)", () => {
  it("granting one permission is exactly one bulk INSERT and no DELETE", async () => {
    givenGrid(["orders.view", "orders.edit"], [11]);

    const applied = await setPermissions(["orders.view", "orders.edit"]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(mock.insertedRows(GRANTS)).toStrictEqual([
      { roleId: ROLE_ID, permissionId: 12, companyId: COMPANY_ID },
    ]);
    expect(applied).toStrictEqual(["orders.view", "orders.edit"]);
  });

  it("revoking one permission is exactly one bulk DELETE and no INSERT", async () => {
    givenGrid(["orders.view"], [11, 12]);

    const applied = await setPermissions(["orders.view"]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(applied).toStrictEqual(["orders.view"]);
  });

  it("granting one and revoking one is one INSERT and one DELETE", async () => {
    givenGrid(["orders.view", "orders.delete"], [11, 12]);

    await setPermissions(["orders.view", "orders.delete"]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
    expect(mock.insertedRows(GRANTS)).toStrictEqual([
      { roleId: ROLE_ID, permissionId: 13, companyId: COMPANY_ID },
    ]);
    expect(mock.fixture(GRANTS).whereCalls).toContainEqual([
      "permissionId",
      [12],
    ]);
  });
});

describe("RoleDAO.setPermissions — the edges of the grid (AC-7)", () => {
  it("revoking every permission is one bulk DELETE listing them all", async () => {
    givenGrid([], [11, 12, 13]);

    const applied = await setPermissions([]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(mock.fixture(GRANTS).whereCalls).toContainEqual([
      "permissionId",
      [11, 12, 13],
    ]);
    expect(applied).toStrictEqual([]);
  });

  it("granting onto an empty grid is one bulk INSERT of every row", async () => {
    givenGrid(["orders.view", "orders.edit", "orders.delete"], []);

    await setPermissions(["orders.view", "orders.edit", "orders.delete"]);

    expect(mock.writeCounts(GRANTS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(mock.fixture(GRANTS).insertCaptures).toStrictEqual([
      [
        { roleId: ROLE_ID, permissionId: 11, companyId: COMPANY_ID },
        { roleId: ROLE_ID, permissionId: 12, companyId: COMPANY_ID },
        { roleId: ROLE_ID, permissionId: 13, companyId: COMPANY_ID },
      ],
    ]);
  });

  it("carries companyId on every inserted row", async () => {
    givenGrid(["orders.view", "orders.edit", "orders.delete"], [11]);

    await setPermissions(["orders.view", "orders.edit", "orders.delete"]);

    const inserted = mock.insertedRows(GRANTS);
    expect(inserted).toHaveLength(2);
    inserted.forEach((row) => expect(row.companyId).toBe(COMPANY_ID));
  });
});

describe("RoleDAO.setPermissions — scoping and resolution (AC-9, L-009)", () => {
  it("scopes both the read and the DELETE to this role", async () => {
    givenGrid(["orders.view"], [11, 12]);

    await setPermissions(["orders.view"]);

    // SELECT grants (roleId), then DELETE (roleId + the revoked ids).
    expect(mock.fixture(GRANTS).whereCalls).toStrictEqual([
      ["roleId", ROLE_ID],
      ["roleId", ROLE_ID],
      ["permissionId", [12]],
    ]);
  });

  it("resolves codes against this company's catalogue only", async () => {
    givenGrid(["orders.view"], []);

    await setPermissions(["orders.view"]);

    expect(mock.fixture(PERMISSIONS).whereCalls).toStrictEqual([
      ["companyId", COMPANY_ID],
      ["code", ["orders.view"]],
    ]);
    expect(mock.writeCounts(PERMISSIONS)).toStrictEqual(noWrites);
  });

  it("writes only resolved permission ids — an unknown code is dropped, not inserted", async () => {
    givenGrid(["orders.view"], []);

    const applied = await setPermissions(["orders.view", "nope.invented"]);

    expect(mock.insertedRows(GRANTS)).toStrictEqual([
      { roleId: ROLE_ID, permissionId: 11, companyId: COMPANY_ID },
    ]);
    expect(applied).toStrictEqual(["orders.view"]);
  });

  it("writes nothing outside role_permissions", async () => {
    givenGrid(["orders.view", "orders.delete"], [11, 12]);

    await setPermissions(["orders.view", "orders.delete"]);

    expect(mock.writeLog.map((write) => write.table)).toStrictEqual([
      GRANTS,
      GRANTS,
    ]);
  });
});
