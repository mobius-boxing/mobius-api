// @ts-nocheck
/**
 * AuditLogDAO — the read layer (audit P3, track T3; AC-3, AC-4, AC-8).
 *
 * These tests assert the *shape of the SQL the DAO asks for*, not the rows a
 * database would answer with, because every defect this track can ship is a
 * defect of the query:
 * - a filter that is configured but never reaches `where` is accepted and
 *   ignored (L-007) — the endpoint answers 200 with the wrong rows;
 * - `changedKey` bound as a string instead of a `text[]` degrades `@>` into
 *   either an error or a no-op, and is the one filter whose failure is silent;
 * - the history query written as `entityUuid = :u OR rootUuid = :u` returns the
 *   same rows as the UNION on a 2 900-row dev database and seq-scans every
 *   partition in production (§4a). Only the SQL text distinguishes them here;
 *   `src/__tests__/db/audit-read.db.test.ts` (T7) proves the plan.
 *
 * Mutation-checked per L-018: dropping the `rootUuid` leg of the UNION flips
 * "both legs carry an index prefix" red, and deleting the `changedKey` filter
 * config flips "changedKey binds an array" red.
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
let mockDbKeys;
let mockCalls;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key) => {
    mockDbKeys.push(key);
    return mockKnex;
  },
}));

import {
  AuditLogDAO,
  AUDIT_EXPORT_ROW_CAP,
  HISTORY_ROWS_PER_ENTRY_CAP,
} from "../../../dao/audit-log/audit-log.dao";

const TABLE = "audit_logs";
const COMPANY_UUID = "11111111-1111-4111-8111-111111111111";
const RECORD_UUID = "22222222-2222-4222-8222-222222222222";
const CHILD_UUID = "33333333-3333-4333-8333-333333333333";

/** Every filter the endpoint documents, in one request. */
const ALL_FILTERS = {
  entityName: "machines",
  entityUuid: RECORD_UUID,
  rootUuid: RECORD_UUID,
  operation: "Modificacion",
  action: "machine.update",
  source: "api",
  username: "ana",
  requestId: "44444444-4444-4444-8444-444444444444",
  transactionRef: "889911",
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-02-01T00:00:00.000Z",
  changedKey: "name",
  search: "ACME",
};

const asAdmin = (query = {}) => ({
  query,
  user: { role: "admin", companyId: COMPANY_UUID },
});

const asSuperAdmin = (query = {}) => ({ query, user: { role: "superAdmin" } });

/**
 * `createTableAwareKnexMock` records `where`/`orderBy` but hands out a fresh,
 * unrecorded builder per `knex(table)` call, so `limit`, `offset` and `join`
 * leave no trace — and the export cap *is* a `limit`. Decorate each builder
 * here rather than touching the shared mock, which other suites depend on.
 */
const instrument = (base) => {
  const wrapped = (table) => {
    const builder = base(table);
    for (const method of ["limit", "offset", "join", "select"]) {
      const original = builder[method];
      builder[method] = jest.fn((...args) => {
        mockCalls[method].push(args);
        return original(...args);
      });
    }
    return builder;
  };
  wrapped.fn = base.fn;
  wrapped.transaction = base.transaction;
  wrapped.schema = base.schema;
  return wrapped;
};

/** Every `where`/`whereIn` argument list the DAO issued against the ledger. */
const whereCalls = () => mock.fixture(TABLE).whereCalls;

/**
 * The data query and the count query apply the same filters, and both builders
 * share one per-table record, so every predicate is recorded twice. Compare the
 * distinct ones when the assertion is about the *set* of predicates.
 */
const distinctWhereOn = (column) => {
  const seen = new Set();
  return whereCalls()
    .filter((args) => args[0] === `${TABLE}.${column}`)
    .filter((args) => {
      const key = JSON.stringify(args);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const whereFor = (column) =>
  whereCalls().find((args) => args[0] === `${TABLE}.${column}`);

/**
 * `applySearch` passes a callback to `where`; the mock never invokes it, so
 * run it against a probe builder to see the OR group it would have built.
 */
const searchGroup = () => {
  const call = whereCalls().find(
    (args) => args.length === 1 && typeof args[0] === "function",
  );
  if (!call) return [];
  const captured = [];
  const probe = {
    where: (...args) => {
      captured.push(args);
      return probe;
    },
    orWhere: (...args) => {
      captured.push(args);
      return probe;
    },
  };
  call[0](probe);
  return captured;
};

const rawCalls = () => mockKnex.raw.mock.calls;

/** The three history statements, identified by what each one selects. */
const historySql = () => ({
  txPage: rawCalls().find(([sql]) => sql.includes("GROUP BY")),
  count: rawCalls().find(([sql]) => sql.includes("count(DISTINCT")),
  rows: rawCalls().find(([sql]) => sql.includes("row_number()")),
});

const ledgerRow = (overrides = {}) => ({
  id: "1",
  uuid: "55555555-5555-4555-8555-555555555555",
  entityName: "production_routes",
  entityUuid: RECORD_UUID,
  operation: "Modificacion",
  txId: "889911",
  occurredAt: new Date("2026-02-01T10:00:00.000Z"),
  ...overrides,
});

/** Answer each history statement with the fixture it asks for. */
const givenHistory = ({ txRows, count, rows }) => {
  mockKnex.raw = jest.fn((sql) => {
    if (sql.includes("count(DISTINCT")) {
      return Promise.resolve({ rows: [{ count: String(count) }] });
    }
    if (sql.includes("GROUP BY")) return Promise.resolve({ rows: txRows });
    return Promise.resolve({ rows });
  });
};

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockDbKeys = [];
  mockCalls = { limit: [], offset: [], join: [], select: [] };
  mockKnex = instrument(mock.knexMock);
  mockKnex.raw = jest.fn(() => Promise.resolve({ rows: [] }));
  mock.fixture(TABLE).firstRows = [{ count: "7" }];
});

afterEach(() => jest.restoreAllMocks());

describe("AuditLogDAO.getAllWithFilters — the filter set (AC-3)", () => {
  it("binds every documented filter to its column and operator", async () => {
    await new AuditLogDAO().getAllWithFilters(asAdmin(ALL_FILTERS));

    expect(whereFor("entityName")).toEqual([
      `${TABLE}.entityName`,
      "=",
      "machines",
    ]);
    expect(whereFor("entityUuid")).toEqual([
      `${TABLE}.entityUuid`,
      "=",
      RECORD_UUID,
    ]);
    expect(whereFor("rootUuid")).toEqual([
      `${TABLE}.rootUuid`,
      "=",
      RECORD_UUID,
    ]);
    expect(whereFor("operation")).toEqual([
      `${TABLE}.operation`,
      "=",
      "Modificacion",
    ]);
    expect(whereFor("action")).toEqual([
      `${TABLE}.action`,
      "=",
      "machine.update",
    ]);
    expect(whereFor("source")).toEqual([`${TABLE}.source`, "=", "api"]);
    expect(whereFor("username")).toEqual([
      `${TABLE}.username`,
      "ILIKE",
      "%ana%",
    ]);
    expect(whereFor("requestId")).toEqual([
      `${TABLE}.requestId`,
      "=",
      ALL_FILTERS.requestId,
    ]);
    // `transactionRef` is the wire name; `txId` is the column (§0.2-6).
    expect(whereFor("txId")).toEqual([`${TABLE}.txId`, "=", "889911"]);
  });

  it("maps from/to onto occurredAt as a closed range", async () => {
    await new AuditLogDAO().getAllWithFilters(asAdmin(ALL_FILTERS));

    expect(distinctWhereOn("occurredAt")).toEqual([
      [`${TABLE}.occurredAt`, ">=", ALL_FILTERS.from],
      [`${TABLE}.occurredAt`, "<=", ALL_FILTERS.to],
    ]);
  });

  it("binds changedKey as an array, so `@>` compares text[] to text[]", async () => {
    await new AuditLogDAO().getAllWithFilters(asAdmin({ changedKey: "name" }));

    const call = whereFor("changedKeys");
    expect(call).toBeDefined();
    expect(call[1]).toBe("@>");
    // The whole point: a bare string here makes the operator a no-op or an
    // error, and nothing else in the response would show it.
    expect(Array.isArray(call[2])).toBe(true);
    expect(call[2]).toEqual(["name"]);
  });

  it("collapses a repeated changedKey instead of asking whereIn", async () => {
    await new AuditLogDAO().getAllWithFilters(
      asAdmin({ changedKey: ["name", "code"] }),
    );

    expect(whereFor("changedKeys")).toEqual([
      `${TABLE}.changedKeys`,
      "@>",
      ["code"],
    ]);
  });

  it("searches entityCode and entityDescription", async () => {
    await new AuditLogDAO().getAllWithFilters(asAdmin(ALL_FILTERS));

    expect(searchGroup()).toEqual([
      [`${TABLE}.entityCode`, "ILIKE", "%ACME%"],
      [`${TABLE}.entityDescription`, "ILIKE", "%ACME%"],
    ]);
  });

  it("drops an unknown filter without erroring (schema is not leaked)", async () => {
    await new AuditLogDAO().getAllWithFilters(
      asAdmin({ userId: "3", entityName: "machines" }),
    );

    expect(whereFor("userId")).toBeUndefined();
    expect(whereFor("entityName")).toBeDefined();
  });

  it("sorts by occurredAt only, ignoring the sort keys P2 exposed", async () => {
    await new AuditLogDAO().getAllWithFilters(
      asAdmin({ sortBy: "username", sortOrder: "asc" }),
    );

    expect(mock.orderByCalls(TABLE)).toEqual([[`${TABLE}.occurredAt`, "desc"]]);
  });

  it("paginates and reports the paginator shape", async () => {
    const result = await new AuditLogDAO().getAllWithFilters(
      asAdmin({ page: "3", limit: "25" }),
    );

    expect(mockCalls.limit).toEqual([[25]]);
    expect(mockCalls.offset).toEqual([[50]]);
    expect(result).toMatchObject({
      success: true,
      page: 3,
      limit: 25,
      totalCount: 7,
      totalPages: 1,
    });
  });
});

describe("AuditLogDAO — tenant scoping (L-009, §0.2-8)", () => {
  it("joins companies on the token-derived uuid", async () => {
    await new AuditLogDAO().getAllWithFilters(asAdmin());

    expect(mockCalls.join).toContainEqual([
      "companies",
      `${TABLE}.companyId`,
      "companies.id",
    ]);
    expect(whereCalls()).toContainEqual(["companies.uuid", COMPANY_UUID]);
  });

  it("never takes the company from the request body", async () => {
    const req = asAdmin();
    req.body = { companyId: "99999999-9999-4999-8999-999999999999" };

    await new AuditLogDAO().getAllWithFilters(req);

    expect(whereCalls()).toContainEqual(["companies.uuid", COMPANY_UUID]);
  });

  it("applies no company predicate for a superAdmin with no ?companyId", async () => {
    await new AuditLogDAO().getAllWithFilters(asSuperAdmin());

    expect(mockCalls.join).toEqual([]);
    expect(whereCalls().some((args) => args[0] === "companies.uuid")).toBe(
      false,
    );
  });

  it("scopes a superAdmin who selected a company", async () => {
    const other = "66666666-6666-4666-8666-666666666666";
    await new AuditLogDAO().getAllWithFilters(
      asSuperAdmin({ companyId: other }),
    );

    expect(whereCalls()).toContainEqual(["companies.uuid", other]);
  });
});

describe("AuditLogDAO — the default date window (§4c)", () => {
  const ninetyDaysAgo = () => {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 90);
    return since;
  };

  it("defaults from to now-90d when neither company nor dates are given", async () => {
    const result = await new AuditLogDAO().getAllWithFilters(asSuperAdmin());

    const bound = whereFor("occurredAt");
    expect(bound[1]).toBe(">=");
    expect(
      Math.abs(new Date(bound[2]).getTime() - ninetyDaysAgo().getTime()),
    ).toBeLessThan(60_000);
    expect(result.appliedFrom).toBe(bound[2]);
    expect(result.appliedTo).toBeNull();
  });

  it("applies no default when the caller is scoped to a company", async () => {
    const result = await new AuditLogDAO().getAllWithFilters(asAdmin());

    expect(whereFor("occurredAt")).toBeUndefined();
    expect(result.appliedFrom).toBeNull();
    expect(result.appliedTo).toBeNull();
  });

  it("applies no default when a date bound is given, and echoes it", async () => {
    const result = await new AuditLogDAO().getAllWithFilters(
      asSuperAdmin({ to: "2026-03-01T00:00:00.000Z" }),
    );

    expect(distinctWhereOn("occurredAt")).toEqual([
      [`${TABLE}.occurredAt`, "<=", "2026-03-01T00:00:00.000Z"],
    ]);
    expect(result).toMatchObject({
      appliedFrom: null,
      appliedTo: "2026-03-01T00:00:00.000Z",
    });
  });
});

describe("AuditLogDAO — auditDbFor chooses the database (R-3)", () => {
  it("reads the owning database of the filtered entity", async () => {
    await new AuditLogDAO().getAllWithFilters(
      asAdmin({ entityName: "countdown_documents" }),
    );

    expect(new Set(mockDbKeys)).toEqual(new Set(["countdown"]));
  });

  it("falls back to erp when no entityName narrows the read", async () => {
    await new AuditLogDAO().getAllWithFilters(asAdmin());

    expect(new Set(mockDbKeys)).toEqual(new Set(["erp"]));
  });

  it("falls back to erp when entityName names several tables", async () => {
    await new AuditLogDAO().getAllWithFilters(
      asAdmin({ entityName: ["machines", "countdown_documents"] }),
    );

    expect(new Set(mockDbKeys)).toEqual(new Set(["erp"]));
  });

  it("reads the entity's database for a history request", async () => {
    givenHistory({ txRows: [], count: 0, rows: [] });

    await new AuditLogDAO().getHistory(
      "countdown_documents",
      RECORD_UUID,
      1,
      20,
      asAdmin(),
    );

    expect(new Set(mockDbKeys)).toEqual(new Set(["countdown"]));
  });
});

describe("AuditLogDAO.getHistory — the UNION (§4a, AC-4)", () => {
  beforeEach(() => {
    givenHistory({
      txRows: [{ txId: "889911", at: new Date("2026-02-01T10:00:00.000Z") }],
      count: 3,
      rows: [
        ledgerRow({
          id: "9",
          entityName: "production_route_stages",
          entityUuid: CHILD_UUID,
          rootEntity: "production_routes",
          rootUuid: RECORD_UUID,
        }),
        ledgerRow({ id: "8" }),
      ],
    });
  });

  const runHistory = (req = asAdmin()) =>
    new AuditLogDAO().getHistory("production_routes", RECORD_UUID, 1, 20, req);

  it("asks for two index-prefixed legs, not an OR", async () => {
    await runHistory();
    const { txPage } = historySql();

    expect(txPage[0]).toContain("UNION ALL");
    expect(txPage[0]).toContain('l."entityName" = :entityName');
    expect(txPage[0]).toContain('l."entityUuid" = :entityUuid');
    expect(txPage[0]).toContain('l."rootEntity" = :entityName');
    expect(txPage[0]).toContain('l."rootUuid" = :entityUuid');
    // An OR over the two columns is what the UNION exists to avoid.
    expect(txPage[0]).not.toMatch(/\bOR\b/);
    expect(txPage[1]).toMatchObject({
      entityName: "production_routes",
      entityUuid: RECORD_UUID,
      companyUuid: COMPANY_UUID,
    });
  });

  it("keeps companyId as an equality on both legs", async () => {
    await runHistory();
    const { txPage } = historySql();

    const legs = txPage[0].split("UNION ALL");
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg).toContain(
        'l."companyId" IN (SELECT c.id FROM companies c WHERE c.uuid = :companyUuid)',
      );
    }
  });

  it("applies no company predicate for an unscoped superAdmin", async () => {
    await runHistory(asSuperAdmin());
    const { txPage } = historySql();

    expect(txPage[0]).not.toContain("companies");
    expect(txPage[1].companyUuid).toBeUndefined();
  });

  it("never date-defaults a history (a record's history is complete)", async () => {
    await runHistory(asSuperAdmin());
    const { txPage, count, rows } = historySql();

    for (const [sql, bindings] of [txPage, count, rows]) {
      expect(sql).not.toContain(">=");
      expect(bindings.from).toBeUndefined();
    }
  });

  it("pages over transactions, not rows", async () => {
    await new AuditLogDAO().getHistory(
      "production_routes",
      RECORD_UUID,
      3,
      10,
      asAdmin(),
    );
    const { txPage, count } = historySql();

    expect(txPage[0]).toContain('GROUP BY s."txId"');
    expect(txPage[0]).toContain('ORDER BY "at" DESC, s."txId" DESC');
    expect(txPage[0]).toContain("LIMIT :limit OFFSET :offset");
    expect(txPage[1]).toMatchObject({ limit: 10, offset: 20 });
    expect(count[0]).toContain('count(DISTINCT s."txId")');
  });

  it("clamps the page size to the shared 100 ceiling", async () => {
    await new AuditLogDAO().getHistory(
      "production_routes",
      RECORD_UUID,
      1,
      500,
      asAdmin(),
    );

    expect(historySql().txPage[1].limit).toBe(100);
  });

  it("fetches the page's rows by txId, capped per entry", async () => {
    await runHistory();
    const { rows } = historySql();

    expect(rows[0]).toContain('WHERE s."txId" = ANY(:txIds)');
    expect(rows[0]).toContain("WHERE r.rn <= :rowCap");
    expect(rows[0]).toContain('ORDER BY r."occurredAt" DESC, r."id" DESC');
    expect(rows[1]).toMatchObject({
      txIds: ["889911"],
      rowCap: HISTORY_ROWS_PER_ENTRY_CAP,
    });
    expect(HISTORY_ROWS_PER_ENTRY_CAP).toBe(200);
  });

  it("groups the rows into one entry per transaction, own row first", async () => {
    const result = await runHistory();

    expect(result).toMatchObject({
      success: true,
      page: 1,
      limit: 20,
      count: 1,
      totalCount: 3,
      totalPages: 1,
    });
    expect(result.data).toHaveLength(1);
    const [entry] = result.data;
    expect(entry.txId).toBe("889911");
    expect(entry.truncated).toBe(false);
    // The route's own row, then the stage the same save touched (AC-4).
    expect(entry.rows.map((row) => row.entityName)).toEqual([
      "production_routes",
      "production_route_stages",
    ]);
    expect(entry.rows[1].rootUuid).toBe(RECORD_UUID);
  });

  it("does not ask for rows when no transaction matched", async () => {
    givenHistory({ txRows: [], count: 0, rows: [] });

    const result = await runHistory();

    expect(historySql().rows).toBeUndefined();
    expect(result).toMatchObject({ data: [], count: 0, totalCount: 0 });
  });
});

describe("AuditLogDAO.listForExport (AC-8)", () => {
  it("caps the export at 10 000 rows and reports truncation", async () => {
    mock.fixture(TABLE).rows = [ledgerRow()];

    const result = await new AuditLogDAO().listForExport(
      asAdmin({ entityName: "machines", limit: "1000" }),
    );

    expect(AUDIT_EXPORT_ROW_CAP).toBe(10000);
    expect(mockCalls.limit).toEqual([[AUDIT_EXPORT_ROW_CAP]]);
    expect(mockCalls.offset).toEqual([[0]]);
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("flags truncation when the cap is reached exactly", async () => {
    mock.fixture(TABLE).rows = new Array(AUDIT_EXPORT_ROW_CAP).fill(
      ledgerRow(),
    );

    const result = await new AuditLogDAO().listForExport(asAdmin());

    expect(result.truncated).toBe(true);
  });

  it("uses the same filters, scope and default window as the list", async () => {
    const result = await new AuditLogDAO().listForExport(
      asSuperAdmin({ changedKey: "name", operation: "Baja" }),
    );

    expect(whereFor("changedKeys")[2]).toEqual(["name"]);
    expect(whereFor("operation")).toEqual([`${TABLE}.operation`, "=", "Baja"]);
    expect(whereFor("occurredAt")[1]).toBe(">=");
    expect(result.appliedFrom).toBe(whereFor("occurredAt")[2]);
  });
});

describe("AuditLogDAO.getByUuid", () => {
  it("returns the row with its before/after payload", async () => {
    const row = ledgerRow({
      before: { name: "old" },
      after: { name: "new" },
      changedKeys: ["name"],
    });
    mock.fixture(TABLE).firstRows = [row];

    const found = await new AuditLogDAO().getByUuid(row.uuid, COMPANY_UUID);

    expect(found).toBe(row);
    expect(whereCalls()).toContainEqual([`${TABLE}.uuid`, row.uuid]);
    expect(whereCalls()).toContainEqual(["companies.uuid", COMPANY_UUID]);
    expect(mockDbKeys).toEqual(["erp"]);
  });

  it("returns null rather than undefined when nothing matches", async () => {
    mock.fixture(TABLE).firstRows = [];

    expect(await new AuditLogDAO().getByUuid(RECORD_UUID)).toBeNull();
  });
});
