/**
 * AuditPresenterService — the sanitizer contract (audit P3, track T4;
 * AC-5, AC-6, AC-10).
 *
 * The presenter is the single place a ledger row becomes a client shape, so it
 * is the only place that can stop `sanitizeResponse` from quietly deleting the
 * data an auditor came for: it removes the key `id` and every key ending in
 * `Id` whose value is a number, recursively, on every response, and it never
 * errors. A raw snapshot `{"id":41,"customerId":7,"name":"X"}` arrives as
 * `{"name":"X"}` with a 200 status.
 *
 * The load-bearing test here is "survives the sanitizer untouched". It has
 * three legs, and the third is not redundant:
 *
 * 1. **Round trip through the real middleware** — the payload is pushed through
 *    `sanitizeResponse` itself, not through a local re-implementation of its
 *    rule. A test that re-implements the thing it guards agrees with itself.
 * 2. **The literal AC-5 walk** — no key `id`, no key ending in `Id` with a
 *    numeric value, anywhere in the emitted JSON.
 * 3. **No dynamic column name in key position** — the only keys ending in `Id`
 *    are the presenter's own static fields (`requestId`, whose value is always
 *    a uuid string). This is what makes the shape safe *by construction*:
 *    legs 1 and 2 both pass for `diff: {customerId: {before, after}}`, because
 *    the sanitizer only strips numeric values — yet that map is one column type
 *    away (`{customerId: 7}`) from being destroyed silently. Values may be
 *    anything; keys must be ours.
 *
 * Mutation-checked (L-018): building the diff from `Object.keys(after)`,
 * emitting `txId` numerically, and emitting `diff` as a map each flip a named
 * test red — see the report attached to the PR.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import { sanitizeResponse } from "../../../middlewares/sanitize-response.middleware";
import type {
  AuditHistoryGroup,
  AuditRowView,
  IAuditLog,
} from "../../../interfaces/audit-log/audit-log.interfaces";

type LabelRow = { id: number; label: string | null };
type WhereInCall = { table: string; ids: number[] };

/** Rows the fake database answers a label lookup with, per table. */
let mockLabelRows: Record<string, LabelRow[]> = {};
/** Every `whereIn` the resolver issued — one per table per response, or a bug. */
let mockWhereInCalls: WhereInCall[] = [];
let mockDbKeys: string[] = [];

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key: string) => {
    mockDbKeys.push(key);
    const knex = (table: string) => {
      const builder = {
        select: () => builder,
        whereIn: (_column: string, ids: number[]) => {
          mockWhereInCalls.push({ table, ids });
          return Promise.resolve(mockLabelRows[table] ?? []);
        },
      };
      return builder;
    };
    knex.raw = (sql: string) => sql;
    return knex;
  },
}));

import { AuditPresenterService } from "../../../services/audit-presenter.service";

const ROUTE_UUID = "11111111-1111-4111-8111-111111111111";
const STAGE_UUID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const OCCURRED = new Date("2026-09-02T10:00:00.000Z");

/** A `Modificacion` with one FK change, one plain change and one redacted. */
const modificacion = (overrides: Partial<IAuditLog> = {}): IAuditLog => ({
  id: 41,
  uuid: "44444444-4444-4444-8444-444444444444",
  companyId: 7,
  entityName: "users",
  entityId: 90,
  entityUuid: ROUTE_UUID,
  entityCode: "U-1",
  entityDescription: "Ana",
  operation: "Modificacion",
  before: { warehouseId: 3, categoryId: 3, email: "ana@old.test" },
  after: { warehouseId: 8, categoryId: 7, email: "ana@new.test" },
  changedKeys: ["categoryId", "email", "password", "warehouseId"],
  rootEntity: null,
  rootUuid: null,
  action: "user.update",
  source: "api",
  txId: "889911",
  requestId: REQUEST_ID,
  username: "ana@test.com",
  userId: 90,
  actorRole: "admin",
  actorCompanyId: 7,
  context: { ip: "10.0.0.1", ua: "jest", route: "PUT /api/users/:uuid" },
  occurredAt: OCCURRED,
  ...overrides,
});

const service = new AuditPresenterService();

/** Push a payload through the real middleware and return what it emitted. */
const throughSanitizer = (body: unknown): unknown => {
  let captured: unknown;
  const res = {
    json: (value: unknown) => {
      captured = value;
      return res;
    },
  } as unknown as Response;
  sanitizeResponse({} as Request, res, (() => undefined) as NextFunction);
  (res.json as unknown as (value: unknown) => void)(body);
  return captured;
};

type KeyHit = { key: string; value: unknown };

/** Every key/value pair in the payload, recursing objects and arrays. */
const collectKeys = (value: unknown, hits: KeyHit[] = []): KeyHit[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, hits);
    return hits;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      hits.push({ key, value: val });
      collectKeys(val, hits);
    }
  }
  return hits;
};

/** As the client receives it: `undefined` properties are gone. */
const overTheWire = (payload: unknown): unknown =>
  JSON.parse(JSON.stringify(payload));

/** The presenter's own fields that end in `Id`; their values are uuid strings. */
const STATIC_ID_KEYS = new Set(["requestId"]);

const assertSanitizerProof = (payload: unknown): void => {
  const wire = overTheWire(payload);

  // Leg 1 — the real middleware changes nothing.
  expect(throughSanitizer(wire)).toEqual(wire);

  const hits = collectKeys(wire);
  expect(hits.length).toBeGreaterThan(0);
  for (const hit of hits) {
    // Leg 2 — AC-5, literally.
    expect(hit.key).not.toBe("id");
    if (hit.key.endsWith("Id")) {
      expect(typeof hit.value).not.toBe("number");
      // Leg 3 — no column name ever sits in key position.
      expect(STATIC_ID_KEYS.has(hit.key)).toBe(true);
    }
  }
};

beforeEach(() => {
  mockLabelRows = {};
  mockWhereInCalls = [];
  mockDbKeys = [];
});

describe("AuditPresenterService — the sanitizer contract (AC-5)", () => {
  it("emits a list row the sanitizer cannot touch", async () => {
    mockLabelRows.warehouses = [
      { id: 3, label: "Almacén central" },
      { id: 8, label: "Almacén norte" },
    ];

    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    assertSanitizerProof(view);
  });

  it("emits a detail row — diff plus both snapshots — the sanitizer cannot touch", async () => {
    mockLabelRows.warehouses = [{ id: 3, label: "Almacén central" }];

    const view = await service.presentOne(
      modificacion({
        operation: "Alta",
        before: null,
        after: { id: 41, companyId: 7, warehouseId: 3, email: "ana@new.test" },
        changedKeys: null,
      }),
    );

    // The snapshot of an `Alta` carries `id` and `companyId`; both become
    // entries whose *key* is a value, so nothing is stripped and no number
    // escapes.
    expect(view.afterFields?.map((field) => field.key)).toEqual([
      "companyId",
      "email",
      "id",
      "warehouseId",
    ]);
    assertSanitizerProof(view);
  });

  it("emits a history page the sanitizer cannot touch", async () => {
    const entries = await service.presentHistory(
      [historyGroup()],
      "production_routes",
      ROUTE_UUID,
    );

    assertSanitizerProof(entries);
  });

  it("emits transactionRef as a string, whichever way the pg parser hands over the bigint", async () => {
    const rows = [
      modificacion({ txId: "889911" }),
      // A pg parser configured to cast int8 gives a number here; a field named
      // `txId` carrying it would be deleted in flight.
      modificacion({ txId: 889911 as unknown as string }),
    ];

    const views = await service.presentList(rows);

    expect(views.map((view) => view.transactionRef)).toEqual([
      "889911",
      "889911",
    ]);
    expect(views.every((view) => typeof view.transactionRef === "string")).toBe(
      true,
    );
    assertSanitizerProof(views);
  });

  it("emits diff as an array of entries, never a map keyed by column", async () => {
    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    expect(Array.isArray(view.diff)).toBe(true);
    expect(view.diff?.map((entry) => entry.key)).toEqual([
      "categoryId",
      "email",
      "password",
      "warehouseId",
    ]);
  });

  it("omits diff and the snapshots unless they were asked for (AC-10)", async () => {
    const [view] = await service.presentList([modificacion()]);

    expect(view).not.toHaveProperty("diff");
    expect(view).not.toHaveProperty("beforeFields");
    expect(view).not.toHaveProperty("afterFields");
    expect(view).not.toHaveProperty("before");
    expect(view).not.toHaveProperty("after");
    expect(view).not.toHaveProperty("context");
  });

  it("never selects the numeric columns into a view", async () => {
    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    for (const forbidden of [
      "id",
      "userId",
      "companyId",
      "actorCompanyId",
      "entityId",
      "entityLegacyId",
      "legacyId",
    ]) {
      expect(view).not.toHaveProperty(forbidden);
      expect(view.actor).not.toHaveProperty(forbidden);
    }
  });
});

describe("AuditPresenterService — the diff (AC-6)", () => {
  it("keeps a redacted column visible, named and valueless", async () => {
    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    const password = view.diff?.find((entry) => entry.key === "password");
    // `changedKeys` names it; the trigger stored no value on either side. Built
    // from `Object.keys(after)` this entry would not exist at all and a
    // password change would render as an empty edit.
    expect(password).toEqual({
      key: "password",
      label: "password",
      redacted: true,
      before: undefined,
      after: undefined,
    });
    const wire = overTheWire(password) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(["key", "label", "redacted"]);
  });

  it("replaces a mapped foreign key with its label on both sides", async () => {
    mockLabelRows.warehouses = [
      { id: 3, label: "Almacén central" },
      { id: 8, label: "Almacén norte" },
    ];

    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    expect(view.diff?.find((entry) => entry.key === "warehouseId")).toEqual({
      key: "warehouseId",
      label: "warehouseId",
      before: "Almacén central",
      after: "Almacén norte",
      resolved: true,
    });
  });

  it("withholds an unmapped foreign key instead of leaking the number", async () => {
    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    // `categoryId` is deliberately absent from `AUDIT_FK_TABLE` (two tables
    // claim it), so no label can be built — and the raw 3 -> 7 is withheld.
    expect(view.diff?.find((entry) => entry.key === "categoryId")).toEqual({
      key: "categoryId",
      label: "categoryId",
      before: null,
      after: null,
      resolved: false,
    });
  });

  it("withholds a mapped foreign key whose row no longer exists", async () => {
    mockLabelRows.warehouses = [];

    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    expect(view.diff?.find((entry) => entry.key === "warehouseId")).toEqual({
      key: "warehouseId",
      label: "warehouseId",
      before: null,
      after: null,
      resolved: false,
    });
  });

  it("passes non-key values through untouched and flags nothing", async () => {
    const [view] = await service.presentList([modificacion()], {
      includeDiff: true,
    });

    expect(view.diff?.find((entry) => entry.key === "email")).toEqual({
      key: "email",
      label: "email",
      before: "ana@old.test",
      after: "ana@new.test",
    });
  });

  it("falls back to the snapshot keys on an Alta, where the trigger writes no changedKeys", async () => {
    const [view] = await service.presentList(
      [
        modificacion({
          operation: "Alta",
          before: null,
          after: { email: "ana@new.test", isActive: true },
          changedKeys: null,
        }),
      ],
      { includeDiff: true },
    );

    expect(view.diff).toEqual([
      { key: "email", label: "email", before: null, after: "ana@new.test" },
      { key: "isActive", label: "isActive", before: null, after: true },
    ]);
  });
});

describe("AuditPresenterService — the actor (§0.4)", () => {
  it("marks a cross-company actor as support, and nobody else", async () => {
    const views = await service.presentList([
      modificacion({ companyId: 7, actorCompanyId: 7 }),
      modificacion({ companyId: 7, actorCompanyId: 99 }),
      modificacion({ companyId: 7, actorCompanyId: null }),
    ]);

    expect(views.map((view) => view.actor.isSupport)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("reports an unattributed row rather than emitting a blank name", async () => {
    const [view] = await service.presentList([
      modificacion({
        source: "sql",
        username: null,
        actorRole: null,
        userId: null,
        actorCompanyId: null,
      }),
    ]);

    expect(view.actor).toEqual({
      username: null,
      role: null,
      isSupport: false,
      attributed: false,
    });
    expect(view.source).toBe("sql");
  });

  it("marks an attributed row as attributed", async () => {
    const [view] = await service.presentList([modificacion()]);

    expect(view.actor).toEqual({
      username: "ana@test.com",
      role: "admin",
      isSupport: false,
      attributed: true,
    });
  });
});

describe("AuditPresenterService — foreign-key batching (R-4)", () => {
  it("issues one whereIn per table per response, whatever the row count", async () => {
    mockLabelRows.warehouses = [{ id: 3, label: "Almacén central" }];
    mockLabelRows.customers = [{ id: 5, label: "ACME" }];

    const rows = Array.from({ length: 50 }, (_, index) =>
      modificacion({
        before: { warehouseId: 3, customerId: 5 },
        after: { warehouseId: 3, customerId: 5 },
        changedKeys: ["customerId", "warehouseId"],
        uuid: `row-${index}`,
      }),
    );

    const views = await service.presentList(rows, { includeDiff: true });

    expect(views).toHaveLength(50);
    expect(mockWhereInCalls).toHaveLength(2);
    expect(
      [...mockWhereInCalls].sort((a, b) => a.table.localeCompare(b.table)),
    ).toEqual([
      { table: "customers", ids: [5] },
      { table: "warehouses", ids: [3] },
    ]);
  });

  it("asks no database at all when nothing needs a label", async () => {
    await service.presentList([
      modificacion({
        before: { email: "a@test.com" },
        after: { email: "b@test.com" },
        changedKeys: ["email"],
      }),
    ]);

    expect(mockWhereInCalls).toHaveLength(0);
    expect(mockDbKeys).toHaveLength(0);
  });

  it("resolves each table through auditDbFor", async () => {
    mockLabelRows.warehouses = [{ id: 3, label: "Almacén central" }];

    await service.presentList([modificacion()], { includeDiff: true });

    expect(mockDbKeys).toEqual(["erp"]);
  });
});

/** A route save that also edited one of its stages, as the DAO groups it. */
const historyGroup = (): AuditHistoryGroup => ({
  txId: "889911",
  occurredAt: OCCURRED,
  rows: [
    // Deliberately child-first: the presenter must not depend on the DAO's
    // ordering to answer "the record's own row first".
    modificacion({
      entityName: "production_route_stages",
      entityUuid: STAGE_UUID,
      entityCode: "S-1",
      operation: "Modificacion",
      rootEntity: "production_routes",
      rootUuid: ROUTE_UUID,
      before: { position: 1 },
      after: { position: 2 },
      changedKeys: ["position"],
    }),
    modificacion({
      entityName: "production_routes",
      entityUuid: ROUTE_UUID,
      entityCode: "R-1",
      operation: "Modificacion",
      before: { description: "vieja" },
      after: { description: "nueva" },
      changedKeys: ["description"],
    }),
  ],
  truncated: false,
});

describe("AuditPresenterService — history grouping", () => {
  it("puts the record's own row first and its children after", async () => {
    const [entry] = await service.presentHistory(
      [historyGroup()],
      "production_routes",
      ROUTE_UUID,
    );

    expect(entry.rows.map((row: AuditRowView) => row.entityName)).toEqual([
      "production_routes",
      "production_route_stages",
    ]);
    expect(entry.rows[1].rootUuid).toBe(ROUTE_UUID);
  });

  it("carries the transaction's ref, actor and truncation flag", async () => {
    const [entry] = await service.presentHistory(
      [historyGroup()],
      "production_routes",
      ROUTE_UUID,
    );

    expect(entry.transactionRef).toBe("889911");
    expect(entry.occurredAt).toBe(OCCURRED.toISOString());
    expect(entry.action).toBe("user.update");
    expect(entry.actor.username).toBe("ana@test.com");
    expect(entry.truncated).toBe(false);
  });

  it("summarises the entry from the rows it actually has", async () => {
    const [entry] = await service.presentHistory(
      [historyGroup()],
      "production_routes",
      ROUTE_UUID,
    );

    expect(entry.summary).toBe(
      "Modificación de production_routes (1 campo) — production_route_stages: 1 modificación",
    );
  });

  it("summarises a creation with no children", async () => {
    const group: AuditHistoryGroup = {
      txId: "5",
      occurredAt: OCCURRED,
      rows: [
        modificacion({
          entityName: "warehouses",
          entityUuid: ROUTE_UUID,
          operation: "Alta",
          before: null,
          after: { code: "W-1" },
          changedKeys: null,
        }),
      ],
      truncated: false,
    };

    const [entry] = await service.presentHistory(
      [group],
      "warehouses",
      ROUTE_UUID,
    );

    expect(entry.summary).toBe("Alta de warehouses");
  });

  it("summarises children alone when the record's own row is not in the transaction", async () => {
    const group: AuditHistoryGroup = {
      txId: "6",
      occurredAt: OCCURRED,
      rows: [
        modificacion({
          entityName: "production_route_stages",
          entityUuid: STAGE_UUID,
          operation: "Alta",
          rootEntity: "production_routes",
          rootUuid: ROUTE_UUID,
          before: null,
          after: { position: 1 },
          changedKeys: null,
        }),
        modificacion({
          entityName: "production_route_stages",
          entityUuid: "77777777-7777-4777-8777-777777777777",
          operation: "Alta",
          rootEntity: "production_routes",
          rootUuid: ROUTE_UUID,
          before: null,
          after: { position: 2 },
          changedKeys: null,
        }),
      ],
      truncated: true,
    };

    const [entry] = await service.presentHistory(
      [group],
      "production_routes",
      ROUTE_UUID,
    );

    expect(entry.summary).toBe("production_route_stages: 2 altas");
    expect(entry.truncated).toBe(true);
  });
});
