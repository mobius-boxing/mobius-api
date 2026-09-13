/**
 * AC-95 (db-per-company T2; L-009, D-99): the client-supplied uuids the tooling,
 * corrugation and colour controllers resolve are scoped to the caller's company.
 *
 * The DAO and resolver doubles honour the scope argument the way
 * `applyCompanyScope` does (a number filters, `UNRESOLVED_COMPANY` matches
 * nothing, `undefined` is unscoped), so each case fails if a controller stops
 * passing the scope: the foreign uuid would resolve and the 400 never happen.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { createMockResponse } from "../../mocks/express.mock";

type Row = { uuid: string; id: number; companyId: number };

const mockRows: Record<string, Row[]> = {};
const mockLookup =
  (table: string) =>
  async (uuid: string, scope?: unknown): Promise<number | null> =>
    (mockRows[table] ?? []).find(
      (row) =>
        row.uuid === uuid && (scope === undefined || scope === row.companyId),
    )?.id ?? null;

const mockDao = (table?: string) =>
  function Dao() {
    return table
      ? {
          getIdByUuid: (uuid: string, scope?: unknown) =>
            mockLookup(table)(uuid, scope),
        }
      : {};
  };

jest.mock("../../../dao/tooling/tooling.dao", () => ({
  ToolingDAO: mockDao(),
}));
jest.mock("../../../dao/tooling-type/tooling-type.dao", () => ({
  ToolingTypeDAO: mockDao("tooling_types"),
}));
jest.mock("../../../dao/manufacturer/manufacturer.dao", () => ({
  ManufacturerDAO: mockDao("manufacturers"),
}));
jest.mock("../../../dao/supplier/supplier.dao", () => ({
  SupplierDAO: mockDao("suppliers"),
}));
jest.mock("../../../dao/corrugation/corrugation.dao", () => ({
  CorrugationDAO: mockDao(),
}));
jest.mock("../../../dao/corrugation-class/corrugation-class.dao", () => ({
  CorrugationClassDAO: mockDao("corrugation_classes"),
}));
jest.mock("../../../dao/color/color.dao", () => ({ ColorDAO: mockDao() }));
jest.mock("../../../dao/color-type/color-type.dao", () => ({
  ColorTypeDAO: mockDao("color_types"),
}));
jest.mock("../../../utils/foreignKeyResolver", () => ({
  getIdByUuid: (uuid: string, table: string, scope?: unknown) =>
    mockLookup(table)(uuid, scope),
}));
jest.mock("../../../services/core-client.service", () => ({
  __esModule: true,
  CoreClient: { companyIdByUuid: async () => 7 },
}));

import { ToolingController } from "../../../controllers/tooling/tooling.controller";
import { CorrugationController } from "../../../controllers/corrugation/corrugation.controller";
import { ColorController } from "../../../controllers/color/color.controller";

const OWN_COMPANY = 7;
const FOREIGN_COMPANY = 9;
const OWN_COMPANY_UUID = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";

const TABLES = [
  "tooling_types",
  "manufacturers",
  "suppliers",
  "corrugation_classes",
  "paper_classes",
  "flute_types",
  "color_types",
];

type Hooks = {
  beforeCreate(payload: unknown, req: Request, res: Response): Promise<unknown>;
  beforeUpdate(
    payload: unknown,
    existingId: number,
    req: Request,
    res: Response,
  ): Promise<unknown>;
};

/** Every uuid the caller's own company owns, except `foreignTable`'s. */
type UuidOf = (table: string) => string;

type Case = {
  lookup: string;
  table: string;
  message: string;
  run: (uuidOf: UuidOf, req: Request, res: Response) => Promise<unknown>;
  /** Set on a create that must name its company: refused before any lookup. */
  refusesSuperAdminWithNoCompany?: string;
};

const hooks = (controller: object): Hooks => controller as unknown as Hooks;

const toolingPayload = (uuidOf: UuidOf) => ({
  code: "T-1",
  name: "Troquel",
  toolingTypeUuid: uuidOf("tooling_types"),
  manufacturerUuid: uuidOf("manufacturers"),
  supplierUuid: uuidOf("suppliers"),
});

const corrugationPayload = (uuidOf: UuidOf) => ({
  code: "C-1",
  corrugationClassUuid: uuidOf("corrugation_classes"),
  layers: [
    {
      paperClassUuid: uuidOf("paper_classes"),
      fluteTypeUuid: uuidOf("flute_types"),
    },
  ],
});

const CASES: Case[] = [
  ...[
    ["tooling_types", "Tooling type not found"],
    ["manufacturers", "Manufacturer not found"],
    ["suppliers", "Supplier not found"],
  ].flatMap(([table = "", message = ""]): Case[] => [
    {
      lookup: `tooling create → ${table}`,
      table,
      message,
      run: (uuidOf, req, res) =>
        hooks(new ToolingController()).beforeCreate(
          toolingPayload(uuidOf),
          req,
          res,
        ),
    },
    {
      lookup: `tooling update → ${table}`,
      table,
      message,
      run: (uuidOf, req, res) =>
        hooks(new ToolingController()).beforeUpdate(
          toolingPayload(uuidOf),
          1,
          req,
          res,
        ),
    },
  ]),
  ...[
    ["corrugation_classes", "Corrugation class not found"],
    ["paper_classes", "Layer 1: paper class not found"],
    ["flute_types", "Layer 1: flute type not found"],
  ].flatMap(([table = "", message = ""]): Case[] => [
    {
      lookup: `corrugation create → ${table}`,
      table,
      message,
      run: (uuidOf, req, res) =>
        hooks(new CorrugationController()).beforeCreate(
          corrugationPayload(uuidOf),
          req,
          res,
        ),
    },
    {
      lookup: `corrugation update → ${table}`,
      table,
      message,
      run: (uuidOf, req, res) =>
        hooks(new CorrugationController()).beforeUpdate(
          corrugationPayload(uuidOf),
          1,
          req,
          res,
        ),
    },
  ]),
  {
    lookup: "color create → color_types",
    table: "color_types",
    message: "Color type not found",
    refusesSuperAdminWithNoCompany: "SuperAdmin must specify a company",
    run: (uuidOf, req, res) =>
      hooks(new ColorController()).beforeCreate(
        { code: "R", name: "Rojo", colorTypeUuid: uuidOf("color_types") },
        req,
        res,
      ),
  },
  {
    lookup: "color update → color_types",
    table: "color_types",
    message: "Color type not found",
    run: (uuidOf, req, res) =>
      hooks(new ColorController()).beforeUpdate(
        { name: "Rojo", colorTypeUuid: uuidOf("color_types") },
        1,
        req,
        res,
      ),
  },
];

const own = (table: string) => `own-${table}`;
const foreign = (table: string) => `foreign-${table}`;
const withForeign =
  (foreignTable: string): UuidOf =>
  (table) =>
    table === foreignTable ? foreign(table) : own(table);

const member = (companyId: number | undefined): Request =>
  ({
    user: {
      userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      email: "member@acme.test",
      role: "member",
      companyId: OWN_COMPANY_UUID,
    },
    companyId,
    query: {},
    body: {},
    params: {},
  }) as unknown as Request;

/** A superAdmin operating as the own company through `body.companyId`, as T1 resolves it. */
const superAdminOperatingAsOwnCompany = (): Request =>
  ({
    user: {
      userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      email: "root@acme.test",
      role: "superAdmin",
    },
    companyId: OWN_COMPANY,
    query: {},
    body: { companyId: OWN_COMPANY_UUID },
    params: {},
  }) as unknown as Request;

/** Names a company in the body that no longer exists, so T1 left `req.companyId` unset. */
const superAdminNamingUnresolvedCompany = (): Request =>
  ({
    user: {
      userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      email: "root@acme.test",
      role: "superAdmin",
    },
    query: {},
    body: { companyId: "11111111-2222-4333-8444-555555555555" },
    params: {},
  }) as unknown as Request;

const superAdminWithNoCompany = (): Request =>
  ({
    user: {
      userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      email: "root@acme.test",
      role: "superAdmin",
    },
    query: {},
    body: {},
    params: {},
  }) as unknown as Request;

beforeEach(() => {
  for (const table of TABLES) {
    mockRows[table] = [
      { uuid: own(table), id: 101, companyId: OWN_COMPANY },
      { uuid: foreign(table), id: 201, companyId: FOREIGN_COMPANY },
    ];
  }
});

/** With an unresolved company every lookup misses, so each controller's first lookup answers. */
const FIRST_REFUSAL: Record<string, string> = {
  "tooling create": "Tooling type not found",
  "tooling update": "Tooling type not found",
  "corrugation create": "Corrugation class not found",
  // An update resolves its layers before the class.
  "corrugation update": "Layer 1: paper class not found",
  "color create": "Color type not found",
  "color update": "Color type not found",
};

describe.each(CASES)("AC-95 — $lookup", ({ lookup, table, message, run }) => {
  it("answers the existing 400 for another company's uuid", async () => {
    const res = createMockResponse() as Response;

    const result = await run(withForeign(table), member(OWN_COMPANY), res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message });
  });

  it("resolves the caller's own uuid", async () => {
    const res = createMockResponse() as Response;

    const result = await run(own, member(OWN_COMPANY), res);

    expect(result).not.toBeNull();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("matches nothing for a member whose company did not resolve", async () => {
    const res = createMockResponse() as Response;

    const result = await run(own, member(undefined), res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("answers the 400 when a superAdmin operating as one company names another's uuid", async () => {
    const res = createMockResponse() as Response;

    const result = await run(
      withForeign(table),
      superAdminOperatingAsOwnCompany(),
      res,
    );

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message });
  });

  it("answers the 400 when a superAdmin names a company that does not resolve", async () => {
    const res = createMockResponse() as Response;

    const result = await run(own, superAdminNamingUnresolvedCompany(), res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: FIRST_REFUSAL[lookup.split(" → ")[0] ?? ""],
    });
  });
});

describe.each(CASES.filter((c) => !c.refusesSuperAdminWithNoCompany))(
  "AC-95 — $lookup, superAdmin with no company",
  ({ table, run }) => {
    it("keeps a superAdmin with no company at all unscoped until T7", async () => {
      const res = createMockResponse() as Response;

      const result = await run(
        withForeign(table),
        superAdminWithNoCompany(),
        res,
      );

      expect(result).not.toBeNull();
      expect(res.status).not.toHaveBeenCalled();
    });
  },
);

describe.each(CASES.filter((c) => c.refusesSuperAdminWithNoCompany))(
  "AC-95 — $lookup, superAdmin with no company",
  ({ table, run, refusesSuperAdminWithNoCompany }) => {
    it("refuses a create before any lookup when the superAdmin names no company", async () => {
      const res = createMockResponse() as Response;

      const result = await run(
        withForeign(table),
        superAdminWithNoCompany(),
        res,
      );

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: refusesSuperAdminWithNoCompany,
      });
    });
  },
);
