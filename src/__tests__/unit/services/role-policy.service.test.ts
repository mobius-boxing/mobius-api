// @ts-nocheck
/**
 * RolePolicyService — the role-management invariants. Each rule has a
 * case that fails if the rule is removed or its comparison direction is
 * flipped (L-018).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";
import {
  RolePolicyService,
  RolePolicyError,
} from "../../../services/role-policy.service";

describe("RolePolicyService.assertCeiling", () => {
  it("passes when every target code is in the actor's own", () => {
    expect(() =>
      RolePolicyService.assertCeiling(
        "member",
        ["orders.edit", "orders.delete"],
        ["orders.edit"],
      ),
    ).not.toThrow();
  });

  it("throws GRANT_CEILING when a target code is outside the actor's own", () => {
    expect(() =>
      RolePolicyService.assertCeiling(
        "member",
        ["orders.edit"],
        ["orders.delete"],
      ),
    ).toThrow(RolePolicyError);
    try {
      RolePolicyService.assertCeiling(
        "member",
        ["orders.edit"],
        ["orders.delete"],
      );
    } catch (err) {
      expect(err.code).toBe("GRANT_CEILING");
      expect(err.status).toBe(403);
    }
  });

  it("superAdmin is exempt (mutation: forgetting the exemption locks out platform ops)", () => {
    expect(() =>
      RolePolicyService.assertCeiling("superAdmin", [], ["orders.edit"]),
    ).not.toThrow();
  });

  it("an empty target list never throws, regardless of actor codes", () => {
    expect(() =>
      RolePolicyService.assertCeiling("member", [], []),
    ).not.toThrow();
  });
});

describe("RolePolicyService.assertNotOwnRole", () => {
  it("throws OWN_ROLE when actor and target are the same user", () => {
    expect(() => RolePolicyService.assertNotOwnRole("member", 5, 5)).toThrow(
      RolePolicyError,
    );
  });

  it("passes for a different target (mutation: an always-throw breaks every other assignment)", () => {
    expect(() =>
      RolePolicyService.assertNotOwnRole("member", 5, 6),
    ).not.toThrow();
  });

  it("superAdmin is exempt even acting on themselves", () => {
    expect(() =>
      RolePolicyService.assertNotOwnRole("superAdmin", 5, 5),
    ).not.toThrow();
  });
});

describe("RolePolicyService.assertKnownCodes — UNKNOWN_PERMISSION", () => {
  const catalogue = new Set(["orders.edit", "orders.delete"]);

  it("passes when every code is in the catalogue", () => {
    expect(() =>
      RolePolicyService.assertKnownCodes(["orders.edit"], catalogue),
    ).not.toThrow();
  });

  it("throws 400 UNKNOWN_PERMISSION for a code outside the catalogue", () => {
    expect(() =>
      RolePolicyService.assertKnownCodes(["nope.invented"], catalogue),
    ).toThrow(RolePolicyError);
    try {
      RolePolicyService.assertKnownCodes(["nope.invented"], catalogue);
    } catch (err) {
      expect(err.code).toBe("UNKNOWN_PERMISSION");
      expect(err.status).toBe(400);
    }
  });
});

describe("RolePolicyService.assertNotSystemRole", () => {
  it("throws SYSTEM_ROLE when systemKey is set", () => {
    expect(() =>
      RolePolicyService.assertNotSystemRole({ systemKey: "admin" }, "delete"),
    ).toThrow(RolePolicyError);
  });

  it("passes a custom role (mutation: blocking every role makes deletion impossible)", () => {
    expect(() =>
      RolePolicyService.assertNotSystemRole({ systemKey: null }, "delete"),
    ).not.toThrow();
  });
});

let mock: ReturnType<typeof createTableAwareKnexMock>;
beforeEach(() => {
  mock = createTableAwareKnexMock();
});

describe("RolePolicyService.assertNotInUse", () => {
  it("passes when no user and no pending invitation reference the role", async () => {
    mock.fixture("users").firstRows = [{ count: "0" }];
    mock.fixture("invitations").firstRows = [{ count: "0" }];

    await expect(
      RolePolicyService.assertNotInUse(mock.knexMock, 42),
    ).resolves.toBeUndefined();
  });

  it("throws ROLE_IN_USE when a user references the role", async () => {
    mock.fixture("users").firstRows = [{ count: "1" }];

    await expect(
      RolePolicyService.assertNotInUse(mock.knexMock, 42),
    ).rejects.toMatchObject({ code: "ROLE_IN_USE", status: 409 });
  });

  it("throws ROLE_IN_USE when a pending invitation references the role (mutation: users-only check misses this)", async () => {
    mock.fixture("users").firstRows = [{ count: "0" }];
    mock.fixture("invitations").firstRows = [{ count: "1" }];

    await expect(
      RolePolicyService.assertNotInUse(mock.knexMock, 42),
    ).rejects.toMatchObject({ code: "ROLE_IN_USE" });
  });
});

describe("RolePolicyService.assertNotLastAdmin", () => {
  it("is a no-op when the target is not currently an active Admin", async () => {
    await expect(
      RolePolicyService.assertNotLastAdmin(mock.knexMock, 1, false),
    ).resolves.toBeUndefined();
    // Mutation guard: a no-op must not even touch the companies row.
    expect(mock.fixture("companies").whereCalls).toStrictEqual([]);
  });

  it("locks the companies row before counting", async () => {
    mock.fixture("users").firstRows = [{ count: "2" }];

    await RolePolicyService.assertNotLastAdmin(mock.knexMock, 1, true);

    expect(mock.fixture("companies").whereCalls).toStrictEqual([["id", 1]]);
  });

  it("passes when at least 2 admins are active", async () => {
    mock.fixture("users").firstRows = [{ count: "2" }];

    await expect(
      RolePolicyService.assertNotLastAdmin(mock.knexMock, 1, true),
    ).resolves.toBeUndefined();
  });

  it("throws LAST_ADMIN when only 1 admin is active (mutation: a <1 comparison lets the last admin through)", async () => {
    mock.fixture("users").firstRows = [{ count: "1" }];

    await expect(
      RolePolicyService.assertNotLastAdmin(mock.knexMock, 1, true),
    ).rejects.toMatchObject({ code: "LAST_ADMIN", status: 409 });
  });

  it("throws LAST_ADMIN when the count is somehow 0 too", async () => {
    mock.fixture("users").firstRows = [{ count: "0" }];

    await expect(
      RolePolicyService.assertNotLastAdmin(mock.knexMock, 1, true),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });
});
