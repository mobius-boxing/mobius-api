// @ts-nocheck
/**
 * RbacService.isAllowed — the single decision point behind `requirePermission`
 * and every controller-level `userHasPermission` check.
 *
 * The `!hasRole -> role==='admin'` legacy fallback stays, but every allow it
 * grants must be logged at warn (`rbac.legacy_fallback_allow`). Each leg
 * below has a case that fails if only that leg breaks (L-018): denying
 * admins-without-a-role would lock out the transition population; logging on
 * every call (not just the fallback) would flood the log; logging BUT still
 * denying would silently break write access for the same population.
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
  it("passes regardless of codes or hasRole", () => {
    expect(RbacService.isAllowed("superAdmin", false, [], "orders.edit")).toBe(
      true,
    );
    expect(RbacService.isAllowed("superAdmin", true, [], "orders.edit")).toBe(
      true,
    );
  });
});

describe("RbacService.isAllowed — a user with a role", () => {
  it("passes when the RW code is granted", () => {
    expect(
      RbacService.isAllowed("member", true, ["orders.edit"], "orders.edit"),
    ).toBe(true);
  });

  it("denies when neither the code nor its readonly sibling is granted", () => {
    expect(RbacService.isAllowed("member", true, [], "orders.edit")).toBe(
      false,
    );
  });

  it("denies the readonly sibling unless allowReadOnly is set (mutation: an unguarded reader)", () => {
    expect(
      RbacService.isAllowed(
        "member",
        true,
        ["orders.edit.readonly"],
        "orders.edit",
      ),
    ).toBe(false);
  });

  it("passes the readonly sibling when allowReadOnly is set", () => {
    expect(
      RbacService.isAllowed(
        "member",
        true,
        ["orders.edit.readonly"],
        "orders.edit",
        { allowReadOnly: true },
      ),
    ).toBe(true);
  });
});

describe("RbacService.isAllowed — the roleless-admin fallback", () => {
  it("allows an admin with no roleId (mutation: denying breaks the transition population)", () => {
    expect(RbacService.isAllowed("admin", false, [], "orders.edit")).toBe(true);
  });

  it("denies a roleless member (mutation: the fallback must not widen to every role)", () => {
    expect(RbacService.isAllowed("member", false, [], "orders.edit")).toBe(
      false,
    );
  });

  it("logs rbac.legacy_fallback_allow with userUuid/code/path exactly when the fallback allows", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    RbacService.isAllowed("admin", false, [], "orders.edit", undefined, {
      userUuid: "u-1",
      path: "/api/orders",
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0];
    expect(line).toContain("rbac.legacy_fallback_allow");
    expect(line).toContain("userUuid=u-1");
    expect(line).toContain("code=orders.edit");
    expect(line).toContain("path=/api/orders");
  });

  it("does not log when the fallback denies (mutation: logging unconditionally hides the signal)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    RbacService.isAllowed("member", false, [], "orders.edit");

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not log a normal grid decision — only the fallback leg logs", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    RbacService.isAllowed("member", true, ["orders.edit"], "orders.edit");

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
      .mockResolvedValue({ hasRole: true, codes: ["orders.edit"] });

    await expect(
      RbacService.userHasPermission("u-1", "member", "orders.edit"),
    ).resolves.toBe(true);
    await expect(
      RbacService.userHasPermission("u-1", "member", "orders.delete"),
    ).resolves.toBe(false);
  });
});

describe("RbacService.authzForUserUuid", () => {
  it("returns hasRole=false and no codes when the user has no roleId", async () => {
    mock.fixture("users").firstRows = [{ roleId: null }];

    await expect(RbacService.authzForUserUuid("u-1")).resolves.toEqual({
      hasRole: false,
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
      hasRole: true,
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
