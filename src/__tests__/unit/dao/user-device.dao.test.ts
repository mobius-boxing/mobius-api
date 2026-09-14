// @ts-nocheck
/**
 * UserDeviceDAO — AC-1-7 (the mapper's key set), AC-1-8 (the re-request update),
 * AC-1-10 (the approve / revoke payloads) and the count query's tenant scope.
 *
 * What each case is built to catch if someone "simplifies" it:
 *   - the wire mapper growing an `id`, `userId` or `tokenHash` key (I-10);
 *   - a re-request that forgets one of the four actor columns, which would leave
 *     a pending row reading "approved by X" (I-4);
 *   - an approve that forgets `revokedAt`/`revokedBy`, which since D-149 (approve
 *     from `revoked`) would list a device as approved AND revoked;
 *   - a count query without the tenant join, whose `totalCount` then counts rows
 *     the page cannot show (L-009).
 *
 * The table-aware thenable knex mock is `sales-order-approval.dao.test.ts`'s,
 * without the transaction half (this DAO opens none).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

let seeds; // { [table]: { firstRows, rows, returningRows } }
let captures; // { [table]: { updateCaptures, insertCaptures, whereCalls, … } }
/** One capture object per `knex(table)` handle, in creation order. */
let builders;

const makeBuilder = (table) => {
  const seed = seeds[table] ?? (seeds[table] = {});
  const shared = captures[table] ?? (captures[table] = {});
  const own = { table };
  builders.push(own);
  const b = {};
  const push = (key, value) => {
    for (const sink of [shared, own]) {
      (sink[key] ?? (sink[key] = [])).push(value);
    }
  };
  const record = (name) =>
    (b[name] = jest.fn((...args) => {
      push(`${name}Calls`, args);
      // `applySearch` groups its ILIKEs in a `where(builder => …)` callback;
      // running it records the columns instead of an opaque function.
      if (typeof args[0] === "function") args[0](b);
      return b;
    }));
  [
    "select",
    "where",
    "orWhere",
    "whereIn",
    "orderBy",
    "limit",
    "offset",
    "join",
    "leftJoin",
    "count",
    "delete",
  ].forEach(record);
  b.update = jest.fn((data) => {
    push("updateCaptures", data);
    return b;
  });
  b.insert = jest.fn((data) => {
    push("insertCaptures", data);
    return b;
  });
  b.returning = jest.fn(() => Promise.resolve(seed.returningRows ?? []));
  b.first = jest.fn(() =>
    Promise.resolve((seed.firstRows ?? []).shift() ?? null),
  );
  b.then = (resolve, reject) =>
    Promise.resolve(seed.rows ?? []).then(resolve, reject);
  return b;
};

let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { UserDeviceDAO } from "../../../dao/user-device/user-device.dao";

/** One joined `user_devices` row as `selectWithRefs` returns it. */
const joinedRow = (overrides = {}) => ({
  id: 41,
  uuid: "device-uuid",
  userId: 7,
  tokenHash: "a".repeat(64),
  status: "pending",
  userAgent: "UA/1.0",
  requestIp: "190.2.14.77",
  requestedAt: "2026-09-12T14:03:11.000Z",
  approvedAt: null,
  approvedBy: null,
  revokedAt: null,
  revokedBy: null,
  createdAt: "2026-09-12T14:03:11.000Z",
  updatedAt: "2026-09-12T14:03:11.000Z",
  deviceUser_uuid: "user-uuid",
  deviceUser_email: "ana@acme.test",
  deviceUser_firstName: "Ana",
  deviceUser_lastName: "Pérez",
  approver_uuid: null,
  approver_email: null,
  approver_firstName: null,
  approver_lastName: null,
  revoker_uuid: null,
  revoker_email: null,
  revoker_firstName: null,
  revoker_lastName: null,
  ...overrides,
});

// `companyId: 7` stands in for what `resolveTenantContext` resolves onto the
// request before a controller ever sees it (db-per-company T1); `user.companyId`
// stays the uuid `getCompanyFilterUuid` reads to decide whether a scope applies
// at all.
const listRequest = (query = {}) => ({
  query,
  user: { role: "admin", companyId: "company-uuid" },
  companyId: 7,
});

beforeEach(() => {
  seeds = {};
  captures = {};
  builders = [];
  mockKnex = jest.fn((table) => makeBuilder(table));
  mockKnex.fn = { now: jest.fn(() => "NOW()") };
  mockKnex.raw = jest.fn((sql) => sql);
});

const deviceBuilders = () =>
  builders.filter((builder) => builder.table === "user_devices");

describe("the wire mapper (AC-1-7, I-10)", () => {
  it("emits exactly the view's keys — no id, userId or tokenHash", async () => {
    seeds.user_devices = { firstRows: [joinedRow()] };

    const view = await new UserDeviceDAO().getViewByUuid("device-uuid");

    expect(Object.keys(view).sort()).toEqual(
      [
        "approvedAt",
        "approvedBy",
        "createdAt",
        "requestIp",
        "requestedAt",
        "revokedAt",
        "revokedBy",
        "status",
        "updatedAt",
        "user",
        "userAgent",
        "uuid",
      ].sort(),
    );
    expect(JSON.stringify(view)).not.toContain("a".repeat(64));
  });

  it("builds the three user refs as objects, null when the FK is null", async () => {
    seeds.user_devices = {
      firstRows: [
        joinedRow({
          status: "approved",
          approvedAt: "2026-09-12T14:05:40.000Z",
          approvedBy: 3,
          approver_uuid: "admin-uuid",
          approver_email: "admin@acme.test",
          approver_firstName: "Admin",
          approver_lastName: "Acme",
        }),
      ],
    };

    const view = await new UserDeviceDAO().getViewByUuid("device-uuid");

    expect(view.user).toEqual({
      uuid: "user-uuid",
      email: "ana@acme.test",
      firstName: "Ana",
      lastName: "Pérez",
    });
    expect(view.approvedBy).toEqual({
      uuid: "admin-uuid",
      email: "admin@acme.test",
      firstName: "Admin",
      lastName: "Acme",
    });
    expect(view.revokedBy).toBeNull();
  });

  it("maps a list page through the same mapper", async () => {
    seeds.user_devices = {
      rows: [joinedRow(), joinedRow({ uuid: "second" })],
      firstRows: [{ count: "2" }],
    };

    const page = await new UserDeviceDAO().getAllWithFilters(listRequest());

    expect(page.data.map((device) => device.uuid)).toEqual([
      "device-uuid",
      "second",
    ]);
    expect(JSON.stringify(page.data)).not.toContain("tokenHash");
    expect(page.totalCount).toBe(2);
  });

  it("scopes and searches the COUNT query exactly like the page (D-52, L-009)", async () => {
    seeds.user_devices = { rows: [joinedRow()], firstRows: [{ count: "1" }] };

    await new UserDeviceDAO().getAllWithFilters(
      listRequest({ search: "ana", status: "pending" }),
    );

    const [page, count] = deviceBuilders();
    expect(count).toBeDefined();
    // A count query without the scope and the search reports another
    // company's rows in `totalCount` while the page shows none of them.
    for (const builder of [page, count]) {
      expect(builder.joinCalls).toEqual(
        expect.arrayContaining([["users", "user_devices.userId", "users.id"]]),
      );
      // db-per-company T1/AC-7: a local predicate on `users.companyId`, no join
      // to `companies` — the caller already holds the numeric id.
      expect(builder.whereCalls).toEqual(
        expect.arrayContaining([
          ["users.companyId", 7],
          ["users.email", "ILIKE", "%ana%"],
        ]),
      );
      expect(builder.orWhereCalls).toEqual([
        ["users.firstName", "ILIKE", "%ana%"],
        ["users.lastName", "ILIKE", "%ana%"],
      ]);
      expect(builder.whereInCalls).toEqual([
        ["user_devices.status", ["pending"]],
      ]);
    }
  });

  it.each([
    ["no sortOrder", undefined, "desc"],
    ["an unparseable sortOrder", "bogus", "desc"],
    ["sortOrder=ASC", "ASC", "asc"],
    ["sortOrder=desc", "desc", "desc"],
  ])(
    "orders with %s (%p) by requestedAt %s",
    async (_label, sortOrder, expected) => {
      seeds.user_devices = { rows: [], firstRows: [{ count: "0" }] };

      await new UserDeviceDAO().getAllWithFilters(
        listRequest(
          sortOrder === undefined
            ? { sortBy: "requestedAt" }
            : { sortBy: "requestedAt", sortOrder },
        ),
      );

      const [page] = deviceBuilders();
      expect(page.orderByCalls).toEqual([
        ["user_devices.requestedAt", expected],
      ]);
    },
  );

  it("keeps the internal row whole — id included — for the transition paths", async () => {
    seeds.user_devices = { firstRows: [joinedRow()] };

    const row = await new UserDeviceDAO().getByUuid("device-uuid", 7);

    // The numeric id is what `approve`/`revoke` update by, so uuid→id is
    // resolved here rather than guessed from a stripped mapper (L-005).
    expect(row).toMatchObject({
      id: 41,
      userId: 7,
      tokenHash: "a".repeat(64),
      status: "pending",
    });
  });
});

describe("createPending", () => {
  it("inserts a pending row with the browser's context and nothing else", async () => {
    seeds.user_devices = { returningRows: [joinedRow()] };

    await new UserDeviceDAO().createPending({
      userId: 7,
      tokenHash: "b".repeat(64),
      userAgent: "UA/1.0",
      requestIp: "190.2.14.77",
    });

    // `requestedAt`/`createdAt`/`updatedAt` are the column defaults, and the four
    // actor columns must stay NULL on a fresh request (I-4).
    expect(captures.user_devices.insertCaptures[0]).toEqual({
      userId: 7,
      tokenHash: "b".repeat(64),
      status: "pending",
      userAgent: "UA/1.0",
      requestIp: "190.2.14.77",
    });
  });
});

describe("rerequest — revoked → pending (AC-1-8, I-4)", () => {
  it("resets the request and nulls all four actor columns", async () => {
    seeds.user_devices = { returningRows: [joinedRow()] };

    await new UserDeviceDAO().rerequest(41, {
      userAgent: "UA/2.0",
      requestIp: "10.0.0.9",
    });

    const update = captures.user_devices.updateCaptures[0];
    expect(update.status).toBe("pending");
    expect(update.requestedAt).toBe("NOW()");
    // All four, explicitly: leaving any one set makes a pending row read as
    // approved-or-revoked, which the audit history then shows as a device that
    // was approved while waiting for approval.
    expect(update.approvedAt).toBeNull();
    expect(update.approvedBy).toBeNull();
    expect(update.revokedAt).toBeNull();
    expect(update.revokedBy).toBeNull();
    expect(update.userAgent).toBe("UA/2.0");
    expect(update.requestIp).toBe("10.0.0.9");
    expect(captures.user_devices.whereCalls).toEqual([["id", 41]]);
  });
});

describe("approve / revoke (AC-1-10)", () => {
  it("approve stamps the actor and clears the revoke pair", async () => {
    seeds.user_devices = { returningRows: [joinedRow()] };

    await new UserDeviceDAO().approve(41, 3);

    const update = captures.user_devices.updateCaptures[0];
    expect(update).toEqual({
      status: "approved",
      approvedAt: "NOW()",
      approvedBy: 3,
      revokedAt: null,
      revokedBy: null,
      updatedAt: "NOW()",
    });
  });

  it("approves a REVOKED row into a clean approved row (D-149)", async () => {
    // The row the controller just read is revoked; the same single UPDATE has to
    // undo both stamps, or the response lists a device approved and revoked at
    // once — the case D-63 was written for before D-149 made it reachable.
    seeds.user_devices = {
      returningRows: [
        joinedRow({
          status: "revoked",
          revokedAt: "2026-09-12T15:00:00.000Z",
          revokedBy: 3,
        }),
      ],
    };

    await new UserDeviceDAO().approve(41, 9);

    const update = captures.user_devices.updateCaptures[0];
    expect(update.status).toBe("approved");
    expect(update.approvedBy).toBe(9);
    expect(update.revokedAt).toBeNull();
    expect(update.revokedBy).toBeNull();
    expect(captures.user_devices.whereCalls).toEqual([["id", 41]]);
  });

  it("revoke stamps the actor and keeps the approval history", async () => {
    seeds.user_devices = { returningRows: [joinedRow()] };

    await new UserDeviceDAO().revoke(41, 3);

    const update = captures.user_devices.updateCaptures[0];
    expect(update).toEqual({
      status: "revoked",
      revokedAt: "NOW()",
      revokedBy: 3,
      updatedAt: "NOW()",
    });
    // Who approved this browser stays readable after a revoke.
    expect(update).not.toHaveProperty("approvedAt");
    expect(update).not.toHaveProperty("approvedBy");
  });
});
