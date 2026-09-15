// @ts-nocheck
/**
 * RbacService.isAllowed — the single decision point behind `requirePermission`
 * and every controller-level `userHasPermission` check.
 *
 * The `!hasRole -> role==='admin'` legacy fallback (and its
 * `rbac.legacy_fallback_allow` warn log) was removed once the backfill
 * migration put every company user on a role and prod logs showed zero
 * fallback hits for a week: a roleless user — admin or member — now gets no
 * permissions.
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

import { RbacService } from "../../../services/rbac.service";

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("RbacService.isAllowed — superAdmin bypass", () => {
  it("passes regardless of codes", () => {
    expect(RbacService.isAllowed("superAdmin", [], "orders.edit")).toBe(true);
    expect(
      RbacService.isAllowed("superAdmin", ["orders.edit"], "orders.edit"),
    ).toBe(true);
  });
});

describe("RbacService.isAllowed — a user with a role", () => {
  it("passes when the RW code is granted", () => {
    expect(
      RbacService.isAllowed("member", ["orders.edit"], "orders.edit"),
    ).toBe(true);
  });

  it("denies when neither the code nor its readonly sibling is granted", () => {
    expect(RbacService.isAllowed("member", [], "orders.edit")).toBe(false);
  });

  it("denies the readonly sibling unless allowReadOnly is set (mutation: an unguarded reader)", () => {
    expect(
      RbacService.isAllowed("member", ["orders.edit.readonly"], "orders.edit"),
    ).toBe(false);
  });

  it("passes the readonly sibling when allowReadOnly is set", () => {
    expect(
      RbacService.isAllowed("member", ["orders.edit.readonly"], "orders.edit", {
        allowReadOnly: true,
      }),
    ).toBe(true);
  });
});

describe("RbacService.isAllowed — a roleless user (legacy fallback removed)", () => {
  it("denies a roleless admin (mutation: reintroducing the fallback would grant everyone)", () => {
    expect(RbacService.isAllowed("admin", [], "orders.edit")).toBe(false);
  });

  it("denies a roleless member", () => {
    expect(RbacService.isAllowed("member", [], "orders.edit")).toBe(false);
  });

  it("never logs rbac.legacy_fallback_allow — the log line is gone with the fallback", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    RbacService.isAllowed("admin", [], "orders.edit");
    RbacService.isAllowed("member", [], "orders.edit");
    RbacService.isAllowed("member", ["orders.edit"], "orders.edit");

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("RbacService.userHasPermission", () => {
  it("passes superAdmin without a lookup", async () => {
    const spy = jest.spyOn(RbacService, "authzForUserUuid");
    const allowed = await RbacService.userHasPermission(
      "u-1",
      "superAdmin",
      "orders.edit",
    );
    expect(allowed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves through authzForUserUuid + isAllowed for everyone else", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockResolvedValue({ codes: ["orders.edit"] });

    await expect(
      RbacService.userHasPermission("u-1", "member", "orders.edit"),
    ).resolves.toBe(true);
    await expect(
      RbacService.userHasPermission("u-1", "member", "orders.delete"),
    ).resolves.toBe(false);
  });
});

describe("RbacService.authzForUserUuid", () => {
  it("returns no codes when the user has no roleId", async () => {
    mock.fixture("users").firstRows = [{ roleId: null }];

    await expect(RbacService.authzForUserUuid("u-1")).resolves.toEqual({
      codes: [],
    });
  });

  it("joins role_permissions -> permissions for the user's role", async () => {
    mock.fixture("users").firstRows = [{ roleId: 9 }];
    mock.fixture("role_permissions").rows = [
      { code: "orders.edit" },
      { code: "orders.delete" },
    ];

    await expect(RbacService.authzForUserUuid("u-1")).resolves.toEqual({
      codes: ["orders.edit", "orders.delete"],
    });
  });
});

describe("RbacService mirror/lookup helpers", () => {
  it("mirrorRoleFor: 'admin' iff systemKey is 'admin'", () => {
    expect(RbacService.mirrorRoleFor("admin")).toBe("admin");
    expect(RbacService.mirrorRoleFor("member")).toBe("member");
    expect(RbacService.mirrorRoleFor(null)).toBe("member");
  });

  it("roleForUserUuid returns null when the user has no role", async () => {
    mock.fixture("users").firstRows = [null];
    await expect(RbacService.roleForUserUuid("u-1")).resolves.toBeNull();
  });

  it("roleForUserUuid returns the joined role's uuid/name", async () => {
    mock.fixture("users").firstRows = [
      { roleUuid: "role-uuid-1", roleName: "Admin" },
    ];
    await expect(RbacService.roleForUserUuid("u-1")).resolves.toEqual({
      roleUuid: "role-uuid-1",
      roleName: "Admin",
    });
  });
});
