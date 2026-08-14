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
