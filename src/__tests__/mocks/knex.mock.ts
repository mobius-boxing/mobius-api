// @ts-nocheck - Disable type checking for mock utilities
/**
 * Knex Database Mock
 * Provides a mock implementation of Knex for unit testing
 */

import { jest } from "@jest/globals";
import { DB_KEYS } from "../../database/keys";

// Type for mock functions that can accept any value
type MockFn = ReturnType<typeof jest.fn>;

// Interface for mock query builder with proper typing
export interface MockQueryBuilder {
  select: MockFn;
  where: MockFn;
  whereIn: MockFn;
  whereNotNull: MockFn;
  whereNull: MockFn;
  andWhere: MockFn;
  orWhere: MockFn;
  first: MockFn;
  insert: MockFn;
  update: MockFn;
  delete: MockFn;
  del: MockFn;
  returning: MockFn;
  count: MockFn;
  orderBy: MockFn;
  limit: MockFn;
  offset: MockFn;
  leftJoin: MockFn;
  innerJoin: MockFn;
  join: MockFn;
  groupBy: MockFn;
  raw: MockFn;
  fn: {
    now: MockFn;
  };
  then: MockFn;
}

// Create a chainable mock query builder
export const createMockQueryBuilder = (): MockQueryBuilder => {
  const queryBuilder: any = {};

  // Create chainable methods that return the queryBuilder
  queryBuilder.select = jest.fn(() => queryBuilder);
  queryBuilder.where = jest.fn(() => queryBuilder);
  queryBuilder.whereIn = jest.fn(() => queryBuilder);
  queryBuilder.whereNotNull = jest.fn(() => queryBuilder);
  queryBuilder.whereNull = jest.fn(() => queryBuilder);
  queryBuilder.andWhere = jest.fn(() => queryBuilder);
  queryBuilder.orWhere = jest.fn(() => queryBuilder);
  queryBuilder.first = jest.fn().mockResolvedValue(null);
  queryBuilder.insert = jest.fn(() => queryBuilder);
  queryBuilder.update = jest.fn(() => queryBuilder);
  queryBuilder.delete = jest.fn().mockResolvedValue(0);
  queryBuilder.del = jest.fn().mockResolvedValue(0);
  queryBuilder.returning = jest.fn().mockResolvedValue([]);
  queryBuilder.count = jest.fn(() => queryBuilder);
  queryBuilder.orderBy = jest.fn(() => queryBuilder);
  queryBuilder.limit = jest.fn(() => queryBuilder);
  queryBuilder.offset = jest.fn(() => queryBuilder);
  queryBuilder.leftJoin = jest.fn(() => queryBuilder);
  queryBuilder.innerJoin = jest.fn(() => queryBuilder);
  queryBuilder.join = jest.fn(() => queryBuilder);
  queryBuilder.groupBy = jest.fn(() => queryBuilder);
  queryBuilder.raw = jest.fn().mockReturnValue("");
  queryBuilder.fn = {
    now: jest.fn().mockReturnValue(new Date().toISOString()),
  };
  queryBuilder.then = jest.fn();

  return queryBuilder as MockQueryBuilder;
};

// Create main knex mock
export const createKnexMock = () => {
  const queryBuilder = createMockQueryBuilder();

  const knexMock = jest.fn().mockReturnValue(queryBuilder);
  (knexMock as any).raw = jest.fn().mockReturnValue("");
  (knexMock as any).fn = {
    now: jest.fn().mockReturnValue(new Date().toISOString()),
  };
  (knexMock as any).schema = {
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    hasTable: jest.fn().mockResolvedValue(true),
  };

  return { knexMock, queryBuilder };
};

/**
 * Registry mock that routes by database key.
 *
 * One independent knex mock per key, so `core` and `erp` can be stubbed with
 * different return values and a query issued on the wrong connection lands in
 * the wrong mock instead of quietly answering (AC-7). Pass `dbMock` as the
 * `db` export of a `jest.mock('.../database/registry')` factory.
 */
export const mockRegistry = () => {
  const mocks: Record<string, any> = {};
  const queryBuilders: Record<string, MockQueryBuilder> = {};

  for (const key of DB_KEYS) {
    const { knexMock, queryBuilder } = createKnexMock();
    mocks[key] = knexMock;
    queryBuilders[key] = queryBuilder;
  }

  const dbMock = jest.fn((key: string) => mocks[key]);

  return { dbMock, mocks, queryBuilders };
};

// Test data generators
export const generateTestUuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export const generateTestDate = () => new Date().toISOString();

/**
 * Table-aware, write-counting knex mock (brief D4).
 *
 * `createMockQueryBuilder` above hands the same builder to every table, so a
 * write on `production_route_stages` is indistinguishable from a write on
 * `production_route_stage_supplies`, and its `delete` records nothing at all.
 * The diff-and-upsert DAOs (audit P1b) are specified in exactly those terms —
 * "one UPDATE on the stages table, zero DELETE, zero INSERT anywhere else" —
 * so `writeLog` exists to make that assertable: every `insert`, `update` and
 * `delete` pushes a marker, per table and into one global ordered log (order
 * matters: the vacate UPDATE must precede the renumber UPDATEs).
 *
 * Each `knex(table)` call returns a fresh builder, but all builders for the
 * same table share one record — a DAO that queries a table twice accumulates
 * into one place. Fixtures are set per table before exercising the DAO:
 *
 *   const knexMock = createTableAwareKnexMock();
 *   knexMock.fixture("production_routes").returningQueue = [[{ id: 10 }]];
 *   knexMock.fixture("production_route_stages").rows = [{ id: 5, number: 1 }];
 *   ...
 *   expect(knexMock.writeCounts("production_route_stage_supplies"))
 *     .toStrictEqual({ insert: 1, update: 0, delete: 0 });
 *
 * Deliberately NOT retrofitted onto `part.dao.test.ts` (local closure) or
 * `corrugation.dao.test.ts` (hand-wired second builder): migrating those is a
 * refactor for another day. New DAO tests use this one — do not write a fourth
 * copy.
 */

/** Per-table fixtures + capture record. All fields are settable by the test. */
export const createTableRecord = () => ({
  /** Shifted one at a time by `.first()`; empty ⇒ null. */
  firstRows: [],
  /** Resolved when the builder itself is awaited (thenable). */
  rows: [],
  /** Result of every `.returning()` call, unless `returningQueue` has one. */
  returningRows: [],
  /** Shifted per `.returning()` call — one entry per expected insert. */
  returningQueue: [],
  /** Resolved by `.delete()` / `.del()` (rows affected). */
  deleteCount: 1,

  /** Payload of every `.insert()` / `.update()`, in call order. */
  insertCaptures: [],
  updateCaptures: [],
  /** Ordered write markers for this table: { op, data }. */
  writeLog: [],
  /** Arguments of every `.orderBy()` call, e.g. [["position", "asc"]]. */
  orderByCalls: [],
  /** Arguments of every `.where()` / `.whereIn()` call. */
  whereCalls: [],
});

export const createTableAwareKnexMock = () => {
  const tables: Record<string, ReturnType<typeof createTableRecord>> = {};
  /** Every write across every table, in the order the DAO issued them. */
  const writeLog: Array<{ table: string; op: string; data?: unknown }> = [];

  const fixture = (table: string) =>
    tables[table] ?? (tables[table] = createTableRecord());

  const makeBuilder = (table: string) => {
    const f = fixture(table);
    const b: any = {};
    const chain = (name: string) => (b[name] = jest.fn(() => b));
    [
      "select",
      "whereNull",
      "whereNotNull",
      "andWhere",
      "orWhere",
      "modify",
      "forUpdate",
      "leftJoin",
      "innerJoin",
      "join",
      "limit",
      "offset",
      "groupBy",
      "count",
    ].forEach(chain);

    const record = (op: string, data?: unknown) => {
      f.writeLog.push({ op, data });
      writeLog.push({ table, op, data });
    };

    b.where = jest.fn((...args: unknown[]) => {
      f.whereCalls.push(args);
      return b;
    });
    b.whereIn = jest.fn((...args: unknown[]) => {
      f.whereCalls.push(args);
      return b;
    });
    b.orderBy = jest.fn((...args: unknown[]) => {
      f.orderByCalls.push(args);
      return b;
    });
    b.first = jest.fn(() => Promise.resolve(f.firstRows.shift() ?? null));
    b.insert = jest.fn((data: unknown) => {
      f.insertCaptures.push(data);
      record("insert", data);
      return b;
    });
    b.update = jest.fn((data: unknown) => {
      f.updateCaptures.push(data);
      record("update", data);
      return b;
    });
    b.delete = jest.fn(() => {
      record("delete");
      return Promise.resolve(f.deleteCount);
    });
    b.del = b.delete;
    b.returning = jest.fn(() =>
      Promise.resolve(
        f.returningQueue.length ? f.returningQueue.shift() : f.returningRows,
      ),
    );
    b.then = (resolve: any, reject: any) =>
      Promise.resolve(f.rows).then(resolve, reject);
    return b;
  };

  const knexMock: any = jest.fn((table: string) => makeBuilder(table));
  knexMock.transaction = jest.fn(async (cb: any) => cb(knexMock));
  knexMock.fn = { now: jest.fn(() => "NOW()") };
  knexMock.raw = jest.fn((sql: unknown) => sql);
  knexMock.schema = {
    hasTable: jest.fn().mockResolvedValue(true),
    hasColumn: jest.fn().mockResolvedValue(true),
  };

  /** Insert payloads for a table, flattened (bulk inserts pass an array). */
  const insertedRows = (table: string) =>
    fixture(table).insertCaptures.flatMap((payload: any) =>
      Array.isArray(payload) ? payload : [payload],
    );

  const writeCounts = (table: string) => {
    const log = fixture(table).writeLog;
    return {
      insert: log.filter((w: any) => w.op === "insert").length,
      update: log.filter((w: any) => w.op === "update").length,
      delete: log.filter((w: any) => w.op === "delete").length,
    };
  };

  return {
    knexMock,
    /** Fixtures + captures for one table; creates the record on first touch. */
    fixture,
    tables,
    /** Global ordered write log across all tables. */
    writeLog,
    /** `{ insert, update, delete }` counts for one table. */
    writeCounts,
    insertedRows,
    orderByCalls: (table: string) => fixture(table).orderByCalls,
  };
};
