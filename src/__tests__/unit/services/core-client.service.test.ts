/**
 * `CoreClient` — the only door from module code into the central plane
 * (db-per-company T2: AC-9, AC-12).
 *
 * Queries are built by real knex (pg dialect, no connection) and captured as
 * SQL plus bindings at the moment they would be sent, so every security
 * predicate is asserted exactly as Postgres would receive it: dropping the
 * company filter or `isActive` changes the captured text and turns a case red.
 *
 * Run: `npx jest src/__tests__/unit/services/core-client.service.test.ts`
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";

type Captured = { key: string; sql: string; bindings: readonly unknown[] };

const mockQueries: Captured[] = [];
let mockAnswer: (
  sql: string,
  bindings: readonly unknown[],
) => unknown = () => [];
let mockFailure: Error | null = null;

jest.mock("../../../database/registry", () => {
  const { knex } = jest.requireActual<typeof import("knex")>("knex");
  const pg = knex({ client: "pg" });
  class DatabaseNotConnectedError extends Error {}
  const db = (key: string) => {
    const connection = (table: string) => {
      const builder = pg(table);
      Object.assign(builder, {
        then: (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) => {
          const { sql, bindings } = builder.toSQL();
          mockQueries.push({ key, sql, bindings });
          const outcome = mockFailure
            ? Promise.reject(mockFailure)
            : Promise.resolve(mockAnswer(sql, bindings));
          return outcome.then(resolve, reject);
        },
      });
      return builder;
    };
    connection.raw = pg.raw.bind(pg);
    return connection;
  };
  return { __esModule: true, db, DatabaseNotConnectedError };
});

import { KnexTimeoutError } from "knex";
import { DatabaseNotConnectedError } from "../../../database/registry";
import {
  CoreClient,
  CoreUnavailableError,
} from "../../../services/core-client.service";
import { CompanyModuleDAO } from "../../../dao/company-module/company-module.dao";
import {
  getRequestContext,
  runWithContext,
} from "../../../utils/requestContext";
import { requireModule } from "../../../middlewares/module.middleware";
import { errorMiddleware } from "../../../middlewares/error/error.middleware";
import {
  createMockRequest,
  createMockResponse,
} from "../../mocks/express.mock";

const UUID_A = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const UUID_B = "9c8b7a65-4321-4f0e-9d1c-2b3a4c5d6e7f";

const newContext = () => ({ isSuperAdmin: false, coreCache: new Map() });

const connectionRefused = (): Error =>
  Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    code: "ECONNREFUSED",
  });

const onlyQuery = (): Captured => {
  expect(mockQueries).toHaveLength(1);
  const [query] = mockQueries;
  if (!query) throw new Error("no query was captured");
  expect(query.key).toBe("core");
  return query;
};

beforeEach(() => {
  mockQueries.length = 0;
  mockAnswer = () => [];
  mockFailure = null;
});

describe("AC-9 — module enablement", () => {
  it("companyIdsWithModuleEnabled applies exactly isEnabled's predicate", async () => {
    mockAnswer = () => [3, 6];

    await expect(
      CoreClient.companyIdsWithModuleEnabled("countdown"),
    ).resolves.toEqual([3, 6]);
    await new CompanyModuleDAO().isEnabled(3, "countdown");

    const [batch, single] = mockQueries;
    if (!batch || !single) throw new Error("expected two queries");
    for (const clause of [
      `inner join "modules" as "m" on "m"."id" = "cm"."moduleId"`,
      `"m"."slug" = ?`,
      `"cm"."enabled" = ?`,
      `"cm"."subscriptionStatus" not in (?, ?)`,
    ]) {
      expect(batch.sql).toContain(clause);
      expect(single.sql).toContain(clause);
    }
    expect(batch.key).toBe("core");
    expect(batch.sql).toMatch(
      /^select "cm"\."companyId" from "company_modules" as "cm"/,
    );
    expect(batch.bindings).toEqual(
      expect.arrayContaining(["countdown", true, "canceled", "past_due"]),
    );
  });

  it("isModuleEnabled answers from the link row", async () => {
    mockAnswer = () => ({ id: 1 });
    await expect(CoreClient.isModuleEnabled(3, "countdown")).resolves.toBe(
      true,
    );

    mockAnswer = () => undefined;
    await expect(CoreClient.isModuleEnabled(3, "countdown")).resolves.toBe(
      false,
    );
  });
});

describe("AC-9 — users of a company (L-009)", () => {
  it("activeUserIdsForCompany filters on the company AND on active", async () => {
    mockAnswer = () => [4, 5];

    await expect(CoreClient.activeUserIdsForCompany(7)).resolves.toEqual([
      4, 5,
    ]);

    const query = onlyQuery();
    expect(query.sql).toBe(
      `select "id" from "users" where "companyId" = ? and "isActive" = ? order by "id" asc`,
    );
    expect(query.bindings).toEqual([7, true]);
  });

  it("activeUserIdsByCompanies: one query, company AND active AND not superAdmin (null-safe)", async () => {
    mockAnswer = () => [
      { id: 1, companyId: 3 },
      { id: 2, companyId: 6 },
      { id: 4, companyId: 3 },
    ];

    const byCompany = await CoreClient.activeUserIdsByCompanies([3, 6]);

    const query = onlyQuery();
    expect(query.sql).toBe(
      `select "id", "companyId" from "users" where "companyId" in (?, ?) and "isActive" = ? and "role" is distinct from ? order by "id" asc`,
    );
    expect(query.bindings).toEqual([3, 6, true, "superAdmin"]);
    expect(byCompany).toEqual(
      new Map([
        [3, [1, 4]],
        [6, [2]],
      ]),
    );
  });

  it("activeUserIdsByCompanies asks nothing for no companies", async () => {
    await expect(CoreClient.activeUserIdsByCompanies([])).resolves.toEqual(
      new Map(),
    );
    expect(mockQueries).toEqual([]);
  });

  it("activeUserIdsByUuids: one query, the company AND active AND the uuids", async () => {
    mockAnswer = () => [9];

    await expect(
      CoreClient.activeUserIdsByUuids(7, [UUID_A, UUID_B]),
    ).resolves.toEqual([9]);

    const query = onlyQuery();
    expect(query.sql).toBe(
      `select "id" from "users" where "companyId" = ? and "isActive" = ? and "uuid" in (?, ?) order by "id" asc`,
    );
    expect(query.bindings).toEqual([7, true, UUID_A, UUID_B]);
  });

  it("activeUserIdsByUuids asks nothing for no uuids", async () => {
    await expect(CoreClient.activeUserIdsByUuids(7, [])).resolves.toEqual([]);
    expect(mockQueries).toEqual([]);
  });
});

describe("AC-9 — people and hydration", () => {
  it("listCompanyPeople returns only uuid and name, active users of the company, by name", async () => {
    mockAnswer = () => [
      { uuid: UUID_A, firstName: "Ada", lastName: "Lovelace" },
      { uuid: UUID_B, firstName: "Grace", lastName: "" },
    ];

    const people = await CoreClient.listCompanyPeople(7);

    expect(people).toStrictEqual([
      { uuid: UUID_A, name: "Ada Lovelace" },
      { uuid: UUID_B, name: "Grace" },
    ]);
    const query = onlyQuery();
    expect(query.sql).toBe(
      `select "uuid", "firstName", "lastName" from "users" where "companyId" = ? and "isActive" = ? order by "firstName" asc, "lastName" asc`,
    );
    expect(query.bindings).toEqual([7, true]);
  });

  it("usersByIds issues exactly one query for many ids", async () => {
    await CoreClient.usersByIds([7, 8, 9]);

    const query = onlyQuery();
    expect(query.sql).toBe(
      `select "id", "uuid", "email", "firstName", "lastName", "isActive", "companyId", "role" from "users" where "id" in (?, ?, ?) order by "firstName" asc, "lastName" asc, "id" asc`,
    );
    expect(query.bindings).toEqual([7, 8, 9]);
  });

  it("usersByIds asks nothing for no ids", async () => {
    await expect(CoreClient.usersByIds([])).resolves.toEqual([]);
    expect(mockQueries).toEqual([]);
  });

  it("companiesByIds renders the row the way the replaced join did", async () => {
    const company = { id: 3, uuid: UUID_A, name: "Acme" };
    mockAnswer = () => [{ company }];

    await expect(CoreClient.companiesByIds([3])).resolves.toEqual([company]);

    const query = onlyQuery();
    expect(query.sql).toBe(
      `select to_jsonb(companies.*) as company from "companies" where "id" in (?)`,
    );
    expect(query.bindings).toEqual([3]);
  });

  it("companyIdByUuid and userIdByUuid answer the id, or null on a miss", async () => {
    mockAnswer = () => ({ id: 5 });
    await expect(CoreClient.companyIdByUuid(UUID_A)).resolves.toBe(5);
    await expect(CoreClient.userIdByUuid(UUID_B)).resolves.toBe(5);

    mockAnswer = () => undefined;
    await expect(CoreClient.companyIdByUuid(UUID_A)).resolves.toBeNull();
    await expect(CoreClient.userIdByUuid(UUID_B)).resolves.toBeNull();

    expect(mockQueries.map(({ sql, bindings }) => [sql, bindings])).toEqual([
      [`select "id" from "companies" where "uuid" = ? limit ?`, [UUID_A, 1]],
      [`select "id" from "users" where "uuid" = ? limit ?`, [UUID_B, 1]],
      [`select "id" from "companies" where "uuid" = ? limit ?`, [UUID_A, 1]],
      [`select "id" from "users" where "uuid" = ? limit ?`, [UUID_B, 1]],
    ]);
  });
});

describe("AC-9 — the per-request cache", () => {
  it("a second call inside one request issues no second query", async () => {
    mockAnswer = () => [4];

    await runWithContext(newContext(), async () => {
      await CoreClient.activeUserIdsForCompany(7);
      await CoreClient.activeUserIdsForCompany(7);
    });

    expect(mockQueries).toHaveLength(1);
  });

  it("two concurrent requests never observe each other's entry, even under the same key", async () => {
    let answered = 0;
    mockAnswer = () => [++answered];
    let releaseA: () => void = () => undefined;
    let releaseB: () => void = () => undefined;
    const gateA = new Promise<void>((resolve) => (releaseA = resolve));
    const gateB = new Promise<void>((resolve) => (releaseB = resolve));

    const request = (gate: Promise<void>) =>
      runWithContext(newContext(), async () => {
        const first = await CoreClient.activeUserIdsForCompany(7);
        await gate;
        const second = await CoreClient.activeUserIdsForCompany(7);
        return {
          first,
          second,
          keys: [...(getRequestContext()?.coreCache.keys() ?? [])],
        };
      });

    const a = request(gateA);
    await new Promise((resolve) => setImmediate(resolve));
    const b = request(gateB);
    await new Promise((resolve) => setImmediate(resolve));
    releaseB();
    releaseA();

    await expect(a).resolves.toEqual({
      first: [1],
      second: [1],
      keys: ["activeUserIdsForCompany:[7]"],
    });
    await expect(b).resolves.toEqual({
      first: [2],
      second: [2],
      keys: ["activeUserIdsForCompany:[7]"],
    });
    expect(mockQueries).toHaveLength(2);
  });

  it("outside any request, every call goes to core", async () => {
    expect(getRequestContext()).toBeUndefined();

    await CoreClient.activeUserIdsForCompany(7);
    await CoreClient.activeUserIdsForCompany(7);

    expect(mockQueries).toHaveLength(2);
  });
});

describe("AC-12 — a core outage", () => {
  it("wraps a connection failure in CoreUnavailableError, keeping the cause", async () => {
    const failure = connectionRefused();
    mockFailure = failure;

    const outcome = CoreClient.usersByIds([7]);

    await expect(outcome).rejects.toBeInstanceOf(CoreUnavailableError);
    await expect(outcome).rejects.toHaveProperty("cause", failure);
  });

  it("wraps a pool timeout and an unconnected registry too", async () => {
    mockFailure = new KnexTimeoutError("Knex: Timeout acquiring a connection.");
    await expect(CoreClient.usersByIds([7])).rejects.toBeInstanceOf(
      CoreUnavailableError,
    );

    mockFailure = new DatabaseNotConnectedError("core");
    await expect(CoreClient.usersByIds([7])).rejects.toBeInstanceOf(
      CoreUnavailableError,
    );
  });

  it("never wraps a query error, which keeps its own mapping", async () => {
    const failure = Object.assign(new Error("invalid input syntax"), {
      code: "22P02",
    });
    mockFailure = failure;

    await expect(CoreClient.companyIdByUuid(UUID_A)).rejects.toBe(failure);
  });

  it("evicts a failed entry, so the next call in the request retries", async () => {
    mockAnswer = () => [4];

    await runWithContext(newContext(), async () => {
      mockFailure = connectionRefused();
      await expect(
        CoreClient.activeUserIdsForCompany(7),
      ).rejects.toBeInstanceOf(CoreUnavailableError);
      mockFailure = null;
      await expect(CoreClient.activeUserIdsForCompany(7)).resolves.toEqual([4]);
    });

    expect(mockQueries).toHaveLength(2);
  });

  it("answers 503 through the error middleware, with a body that names nothing internal", () => {
    const res = createMockResponse() as Response;

    errorMiddleware(
      new CoreUnavailableError(connectionRefused()),
      {} as Request,
      res,
      jest.fn() as unknown as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Core database unavailable",
    });
  });

  it("requireModule fails closed: the outage reaches next(err), never the route", async () => {
    mockFailure = connectionRefused();
    const req = createMockRequest({
      user: {
        userId: UUID_B,
        email: "member@acme.test",
        role: "member",
        companyId: UUID_A,
      },
      companyId: 7,
    } as Partial<Request>) as Request;
    const res = createMockResponse() as Response;
    const next = jest.fn();

    await requireModule("countdown")(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(CoreUnavailableError);
    expect(res.status).not.toHaveBeenCalled();
  });
});
