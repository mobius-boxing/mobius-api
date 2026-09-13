/**
 * AC-11 (db-per-company T2): the resolver routes `companies`/`users` through
 * `CoreClient` and every other table through its tenant connection — one
 * payload can carry both — with accepted-input behaviour and error text
 * unchanged. Also the optional company scope AC-95's layer lookups pass.
 *
 * `foreignKeyResolver.connection.test.ts` covers which connection a tenant
 * table picks; this file covers the split and mixed payloads.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

type Row = { uuid: string; id: number; companyId: number };
type TableCall = {
  key: string;
  table: string;
  wheres: unknown[][];
  raws: string[];
};

const mockTableCalls: TableCall[] = [];
const mockTenantRows: Record<string, Row[]> = {};
const mockCoreLookups: Array<[string, string]> = [];
const mockCoreIds: Record<string, number> = {};

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key: string) => (table: string) => {
    const call: TableCall = { key, table, wheres: [], raws: [] };
    mockTableCalls.push(call);
    const builder = {
      select: () => builder,
      where: (...args: unknown[]) => {
        call.wheres.push(args);
        return builder;
      },
      whereRaw: (sql: string) => {
        call.raws.push(sql);
        return builder;
      },
      first: async () => {
        if (call.raws.includes("false")) return undefined;
        return (mockTenantRows[table] ?? []).find((row) =>
          call.wheres.every(
            ([column, value]) =>
              (column === "uuid" ? row.uuid : row.companyId) === value,
          ),
        );
      },
    };
    return builder;
  },
}));

jest.mock("../../../services/core-client.service", () => ({
  __esModule: true,
  CoreClient: {
    companyIdByUuid: async (uuid: string) => {
      mockCoreLookups.push(["companyIdByUuid", uuid]);
      return mockCoreIds[uuid] ?? null;
    },
    userIdByUuid: async (uuid: string) => {
      mockCoreLookups.push(["userIdByUuid", uuid]);
      return mockCoreIds[uuid] ?? null;
    },
  },
}));

import {
  FK_CONFIGS,
  getIdByUuid,
  resolveForeignKeys,
  resolveUuidToId,
  validateUuidExists,
} from "../../../utils/foreignKeyResolver";
import { UNRESOLVED_COMPANY } from "../../../utils/daoScope";

const COMPANY_UUID = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const USER_UUID = "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071";
const WAREHOUSE_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OWN_PAPER_CLASS = "11111111-2222-4333-8444-555555555555";
const FOREIGN_PAPER_CLASS = "22222222-3333-4444-8555-666666666666";
const UNKNOWN_UUID = "99999999-8888-4777-8666-555555555555";

const PAYLOAD_CONFIGS = {
  companyId: FK_CONFIGS.company,
  warehouseId: FK_CONFIGS.warehouse,
};

beforeEach(() => {
  mockTableCalls.length = 0;
  mockCoreLookups.length = 0;
  for (const key of Object.keys(mockTenantRows)) delete mockTenantRows[key];
  for (const key of Object.keys(mockCoreIds)) delete mockCoreIds[key];
  mockCoreIds[COMPANY_UUID] = 7;
  mockCoreIds[USER_UUID] = 42;
  mockTenantRows.warehouses = [{ uuid: WAREHOUSE_UUID, id: 12, companyId: 7 }];
  mockTenantRows.paper_classes = [
    { uuid: OWN_PAPER_CLASS, id: 101, companyId: 7 },
    { uuid: FOREIGN_PAPER_CLASS, id: 201, companyId: 9 },
  ];
});

describe("resolveForeignKeys — a central and a tenant reference in one payload", () => {
  it("resolves the company through CoreClient and the warehouse on its tenant table", async () => {
    const data: Record<string, unknown> = {
      companyId: COMPANY_UUID,
      warehouseId: WAREHOUSE_UUID,
      name: "Depósito",
    };

    await expect(resolveForeignKeys(data, PAYLOAD_CONFIGS)).resolves.toEqual({
      success: true,
    });

    expect(data).toEqual({ companyId: 7, warehouseId: 12, name: "Depósito" });
    expect(mockCoreLookups).toEqual([["companyIdByUuid", COMPANY_UUID]]);
    expect(mockTableCalls.map(({ key, table }) => ({ key, table }))).toEqual([
      { key: "tenant", table: "warehouses" },
    ]);
  });

  it("never asks a connection for `companies` or `users`", async () => {
    await expect(getIdByUuid(USER_UUID, "users")).resolves.toBe(42);
    await expect(getIdByUuid(COMPANY_UUID, "companies")).resolves.toBe(7);
    await expect(validateUuidExists(COMPANY_UUID, "companies")).resolves.toBe(
      true,
    );
    await expect(validateUuidExists(UNKNOWN_UUID, "users")).resolves.toBe(
      false,
    );
    await expect(resolveUuidToId(USER_UUID, FK_CONFIGS.user)).resolves.toEqual({
      success: true,
      id: 42,
    });

    expect(mockTableCalls).toEqual([]);
    expect(mockCoreLookups).toEqual([
      ["userIdByUuid", USER_UUID],
      ["companyIdByUuid", COMPANY_UUID],
      ["companyIdByUuid", COMPANY_UUID],
      ["userIdByUuid", UNKNOWN_UUID],
      ["userIdByUuid", USER_UUID],
    ]);
  });

  it("passes numeric values through untouched, asking nothing", async () => {
    const data: Record<string, unknown> = { companyId: 5, warehouseId: "12" };

    await expect(resolveForeignKeys(data, PAYLOAD_CONFIGS)).resolves.toEqual({
      success: true,
    });

    expect(data).toEqual({ companyId: 5, warehouseId: 12 });
    expect(mockTableCalls).toEqual([]);
    expect(mockCoreLookups).toEqual([]);
  });

  it("treats empty as no value", async () => {
    await expect(resolveUuidToId("", FK_CONFIGS.company)).resolves.toBeNull();
    await expect(resolveUuidToId(null, FK_CONFIGS.company)).resolves.toBeNull();
    const data: Record<string, unknown> = { companyId: "", warehouseId: null };

    await expect(resolveForeignKeys(data, PAYLOAD_CONFIGS)).resolves.toEqual({
      success: true,
    });

    expect(data).toEqual({ companyId: "", warehouseId: null });
    expect(mockTableCalls).toEqual([]);
    expect(mockCoreLookups).toEqual([]);
  });

  it("keeps the error text, and stops at the first failing reference", async () => {
    const unknownCompany = {
      companyId: UNKNOWN_UUID,
      warehouseId: WAREHOUSE_UUID,
    };
    await expect(
      resolveForeignKeys(unknownCompany, PAYLOAD_CONFIGS),
    ).resolves.toEqual({
      success: false,
      error: "Invalid companies reference",
    });
    expect(mockTableCalls).toEqual([]);

    await expect(
      resolveForeignKeys(
        { companyId: COMPANY_UUID, warehouseId: UNKNOWN_UUID },
        PAYLOAD_CONFIGS,
      ),
    ).resolves.toEqual({
      success: false,
      error: "Invalid warehouses reference",
    });

    await expect(
      resolveForeignKeys(
        { companyId: COMPANY_UUID, warehouseId: "not-a-uuid" },
        PAYLOAD_CONFIGS,
      ),
    ).resolves.toEqual({ success: false, error: "Invalid warehouses format" });
  });
});

describe("getIdByUuid — the optional company scope (AC-95)", () => {
  it("resolves the caller's own row", async () => {
    await expect(
      getIdByUuid(OWN_PAPER_CLASS, "paper_classes", 7),
    ).resolves.toBe(101);
    expect(mockTableCalls[0]?.wheres).toContainEqual([
      "paper_classes.companyId",
      7,
    ]);
  });

  it("does not resolve another company's row", async () => {
    await expect(
      getIdByUuid(FOREIGN_PAPER_CLASS, "paper_classes", 7),
    ).resolves.toBeNull();
  });

  it("matches nothing when the named company did not resolve (fail closed)", async () => {
    await expect(
      getIdByUuid(OWN_PAPER_CLASS, "paper_classes", UNRESOLVED_COMPANY),
    ).resolves.toBeNull();
    expect(mockTableCalls[0]?.raws).toEqual(["false"]);
  });

  it("stays unscoped without a scope, as it was", async () => {
    await expect(
      getIdByUuid(FOREIGN_PAPER_CLASS, "paper_classes"),
    ).resolves.toBe(201);
  });
});
