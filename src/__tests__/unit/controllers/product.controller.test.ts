// @ts-nocheck
/**
 * ProductController — AC-4, AC-5, AC-6, AC-8, AC-13.
 *
 * `parts` is gone (D-1): no `PartDAO`/`PartController` import survives here,
 * and the cascade-to-parts machinery `product-cascade.controller.test.ts`
 * used to cover is replaced by AC-8's `cascade: true` → 400.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { createMockQueryBuilder } from "../../mocks/knex.mock";

const mockProductDAO = {
  create: jest.fn(),
  update: jest.fn(),
  getByUuid: jest.fn(),
  getIdByUuid: jest.fn(),
  getWithDetails: jest.fn(),
  setApproval: jest.fn(),
};
const mockCustomerDAO = { getIdByUuid: jest.fn() };
const mockProductTypeDAO = { getIdByUuid: jest.fn() };
const mockBoxTypeDAO = { getIdByUuid: jest.fn() };

let mockQueryBuilder;
let mockKnex;

jest.mock("../../../dao/product/product.dao", () => ({
  ProductDAO: function () {
    return {
      create: (...a) => mockProductDAO.create(...a),
      update: (...a) => mockProductDAO.update(...a),
      getByUuid: (...a) => mockProductDAO.getByUuid(...a),
      getIdByUuid: (...a) => mockProductDAO.getIdByUuid(...a),
      getWithDetails: (...a) => mockProductDAO.getWithDetails(...a),
      setApproval: (...a) => mockProductDAO.setApproval(...a),
    };
  },
}));
jest.mock("../../../dao/customer/customer.dao", () => ({
  CustomerDAO: function () {
    return { getIdByUuid: (...a) => mockCustomerDAO.getIdByUuid(...a) };
  },
}));
jest.mock("../../../dao/product-type/product-type.dao", () => ({
  ProductTypeDAO: function () {
    return { getIdByUuid: (...a) => mockProductTypeDAO.getIdByUuid(...a) };
  },
}));
jest.mock("../../../dao/box-type/box-type.dao", () => ({
  BoxTypeDAO: function () {
    return { getIdByUuid: (...a) => mockBoxTypeDAO.getIdByUuid(...a) };
  },
}));
jest.mock("../../../services/core-client.service", () => ({
  __esModule: true,
  CoreClient: { companyIdByUuid: async () => 1 },
}));
jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { ProductController } from "../../../controllers/product/product.controller";

const CUSTOMER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CORRUGATION_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => ((res.statusCode = code), res));
  res.json = jest.fn((payload) => ((res.body = payload), res));
  return res;
};

const makeReq = (body = {}, overrides = {}) => ({
  params: { uuid: PRODUCT_UUID },
  body,
  query: {},
  user: { userId: "u-1", email: "a@x", role: "member", companyId: "company-a" },
  companyId: 5,
  ...overrides,
});

// Shaped like ProductDAO.mapToInterface output: no numeric `id` (L-005).
const storedProduct = (overrides = {}) => ({
  uuid: PRODUCT_UUID,
  code: "CAJA-1",
  customerId: 9,
  companyId: 5,
  description: "Existing desc",
  boxSurface: null,
  grammage: null,
  corrugation: null,
  productionRoute: null,
  ...overrides,
});

const controller = new ProductController();

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryBuilder = createMockQueryBuilder();
  mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
  mockKnex.raw = jest.fn().mockReturnValue("");
  mockKnex.fn = { now: jest.fn().mockReturnValue(new Date().toISOString()) };
  mockKnex.transaction = jest.fn(async (cb) => cb(mockKnex));

  mockCustomerDAO.getIdByUuid.mockResolvedValue(9);
  mockProductDAO.getIdByUuid.mockResolvedValue(42);
  mockProductDAO.create.mockResolvedValue(storedProduct());
  mockProductDAO.update.mockResolvedValue(storedProduct());
});

describe("AC-4 — POST /product flat create", () => {
  it("code + customer only is still a valid create (D-14) — exactly one DAO.create call (I-2)", async () => {
    const req = makeReq({ code: "CAJA-1", customerId: CUSTOMER_UUID });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(201);
    expect(mockProductDAO.create).toHaveBeenCalledTimes(1);
    const [payload, options] = mockProductDAO.create.mock.calls[0];
    expect(payload.code).toBe("CAJA-1");
    expect(payload.customerId).toBe(9);
    expect(options).toEqual({ autoAssignRoute: false });
  });

  it("merges a legacy initialPart into the flat body, flat keys winning (D-18, I-22)", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: 77,
      theoreticalGrammage: "500",
    });
    const req = makeReq({
      code: "CAJA-2",
      customerId: CUSTOMER_UUID,
      sheetLength: 500, // flat — must win
      initialPart: {
        sheetLength: 999, // loses to the flat key of the same name
        sheetWidth: 700, // only set here — must still land
        corrugationUuid: CORRUGATION_UUID,
      },
    });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(201);
    const [payload] = mockProductDAO.create.mock.calls[0];
    expect(payload.sheetLength).toBe(500);
    expect(payload.sheetWidth).toBe(700);
    expect(payload.corrugationId).toBe(77);
  });

  it("strips read-only keys silently instead of rejecting them (C-12)", async () => {
    const req = makeReq({
      code: "CAJA-3",
      customerId: CUSTOMER_UUID,
      uuid: "should-be-ignored",
      boxWeight: 999,
      approvalStatus: "approved",
      effectiveGrammage: 123,
      sheetSurface: 456,
    });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(201);
    const [payload] = mockProductDAO.create.mock.calls[0];
    expect(payload.uuid).not.toBe("should-be-ignored");
    expect(payload.boxWeight).toBeUndefined();
    expect(payload).not.toHaveProperty("approvalStatus");
    expect(payload).not.toHaveProperty("effectiveGrammage");
    expect(payload).not.toHaveProperty("sheetSurface");
  });

  it("400s on an unresolvable corrugationUuid, naming corrugations (model.md error text)", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(null);
    const req = makeReq({
      code: "CAJA-4",
      customerId: CUSTOMER_UUID,
      corrugationUuid: CORRUGATION_UUID,
    });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Referenced corrugations not found");
    expect(mockProductDAO.create).not.toHaveBeenCalled();
  });

  it("auto-assigns a route only when corrugationUuid is sent and no route was named (D-14)", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: 77,
      theoreticalGrammage: "500",
    });
    const req = makeReq({
      code: "CAJA-5",
      customerId: CUSTOMER_UUID,
      corrugationUuid: CORRUGATION_UUID,
    });
    const res = makeRes();

    await controller.create(req, res, () => {});

    const [, options] = mockProductDAO.create.mock.calls[0];
    expect(options).toEqual({ autoAssignRoute: true });
  });
});

describe("AC-5 — boxWeight recompute (I-6)", () => {
  it("recomputes boxWeight when boxSurface is sent, using the existing grammage on update", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({
        boxSurface: null,
        grammage: 500,
        corrugation: { uuid: CORRUGATION_UUID, theoreticalGrammage: 500 },
      }),
    );
    const req = makeReq({ boxSurface: 2 }, { params: { uuid: PRODUCT_UUID } });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(200);
    const [, payload] = mockProductDAO.update.mock.calls[0];
    expect(payload.boxWeight).toBe(1); // 2 * 500 / 1000
  });

  it("leaves boxWeight untouched when none of the three trigger keys is sent (I-6)", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(storedProduct());
    const req = makeReq({ clientCode: "CL-1" });
    const res = makeRes();

    await controller.update(req, res, () => {});

    const [, payload] = mockProductDAO.update.mock.calls[0];
    expect(payload).not.toHaveProperty("boxWeight");
  });

  it("a PUT of a calculate response persists the 8 real fields and recomputes the same boxWeight (I-16)", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({
        corrugation: { uuid: CORRUGATION_UUID, theoreticalGrammage: 450 },
      }),
    );
    // Exactly the shape `POST /product/calculate` answers with.
    const calculateResponse = {
      boxLength: 600,
      boxWidth: 400,
      boxHeight: 300,
      externalLength: 604,
      externalWidth: 404,
      externalHeight: 304,
      boxSurface: 2.2042,
      boxWeight: 0.99189, // read-only — must be stripped and recomputed instead
      grammage: null,
      effectiveGrammage: 450, // read-only — must be stripped
    };
    const req = makeReq(calculateResponse);
    const res = makeRes();

    await controller.update(req, res, () => {});

    const [, payload] = mockProductDAO.update.mock.calls[0];
    expect(payload.boxLength).toBe(600);
    expect(payload.boxSurface).toBe(2.2042);
    expect(payload).not.toHaveProperty("effectiveGrammage");
    // Recomputed server-side from boxSurface × effectiveGrammage(null, 450) / 1000.
    expect(payload.boxWeight).toBeCloseTo(0.99189, 5);
  });
});

describe("AC-6 — POST /product/calculate (I-14, stateless)", () => {
  it("400s on a field outside the 8 cascade fields", async () => {
    const req = makeReq({
      corrugationUuid: CORRUGATION_UUID,
      field: "boxWeight",
      value: 1,
      values: {},
    });
    const res = makeRes();

    await controller.calculate(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(mockProductDAO.create).not.toHaveBeenCalled();
    expect(mockProductDAO.update).not.toHaveBeenCalled();
  });

  it("400s on an unknown key inside values", async () => {
    const req = makeReq({
      corrugationUuid: CORRUGATION_UUID,
      field: "boxLength",
      value: 500,
      values: { bogusKey: 1 },
    });
    const res = makeRes();

    await controller.calculate(req, res, () => {});

    expect(res.statusCode).toBe(400);
  });

  it("404s (never 400) for another tenant's corrugation — company-scoped (I-9, L-009)", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(null);
    const req = makeReq({
      corrugationUuid: CORRUGATION_UUID,
      field: "boxLength",
      value: 500,
      values: {},
    });
    const res = makeRes();

    await controller.calculate(req, res, () => {});

    expect(res.statusCode).toBe(404);
  });

  it("returns the derived boxWeight whichever field was edited (I-6, I-16)", async () => {
    mockQueryBuilder.first
      .mockResolvedValueOnce({ id: 77, theoreticalGrammage: "500" }) // corrugation
      .mockResolvedValueOnce(null); // flute
    const req = makeReq({
      corrugationUuid: CORRUGATION_UUID,
      field: "externalLength",
      value: 800,
      values: { boxSurface: 2, grammage: null, boxWeight: null },
    });
    const res = makeRes();

    await controller.calculate(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.body.data.boxWeight).toBe((2 * 500) / 1000);
  });

  it("writes nothing at all — no audit row, no DAO write (I-14)", async () => {
    mockQueryBuilder.first
      .mockResolvedValueOnce({ id: 77, theoreticalGrammage: "500" }) // corrugation
      .mockResolvedValueOnce(null); // flute
    const req = makeReq({
      corrugationUuid: CORRUGATION_UUID,
      field: "boxLength",
      value: 500,
      values: {},
    });
    const res = makeRes();

    await controller.calculate(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(mockProductDAO.create).not.toHaveBeenCalled();
    expect(mockProductDAO.update).not.toHaveBeenCalled();
  });
});

describe("AC-8 — PATCH /product/:uuid/approval, cascade removed (D-18, I-22)", () => {
  it("cascade: true → 400, never reaching the DAO", async () => {
    mockProductDAO.getIdByUuid.mockResolvedValue(42);
    const req = makeReq({ action: "approve", cascade: true });
    const res = makeRes();

    await controller.setApproval(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("cascade is no longer supported");
    expect(mockProductDAO.setApproval).not.toHaveBeenCalled();
  });

  it("cascade absent → 200, with no `cascaded` key on the response", async () => {
    mockProductDAO.getIdByUuid.mockResolvedValue(42);
    mockProductDAO.setApproval.mockResolvedValue(storedProduct());
    const req = makeReq({ action: "approve" });
    const res = makeRes();

    await controller.setApproval(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty("cascaded");
  });

  it("cascade: false → 200, same as absent (D-18 compat)", async () => {
    mockProductDAO.getIdByUuid.mockResolvedValue(42);
    mockProductDAO.setApproval.mockResolvedValue(storedProduct());
    const req = makeReq({ action: "cancel", cascade: false });
    const res = makeRes();

    await controller.setApproval(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(mockProductDAO.setApproval).toHaveBeenCalledWith(
      42,
      "cancel",
      "a@x",
    );
  });
});

describe("company scope (L-009, mutation-check L-018)", () => {
  it("update scopes getByUuid by the caller's company — a mutation dropping the scope would leak cross-company writes", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(storedProduct());
    const req = makeReq({ clientCode: "X" }, { companyId: 5 });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(mockProductDAO.getByUuid).toHaveBeenCalledWith(PRODUCT_UUID, 5);
    expect(mockProductDAO.getIdByUuid).toHaveBeenCalledWith(PRODUCT_UUID, 5);
  });

  it("delete scopes getIdByUuid by the caller's company", async () => {
    mockProductDAO.getIdByUuid.mockResolvedValue(42);
    const req = makeReq({}, { companyId: 5 });
    const res = makeRes();

    await controller.delete(req, res, () => {});

    expect(mockProductDAO.getIdByUuid).toHaveBeenCalledWith(PRODUCT_UUID, 5);
  });

  it("updates by the id from getIdByUuid — the mapped product carries no id (L-005)", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(storedProduct());
    const req = makeReq({ clientCode: "X" });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(mockProductDAO.update).toHaveBeenCalledWith(
      42,
      expect.anything(),
      expect.anything(),
    );
  });

  it("404s update for a product outside the caller's company instead of leaking existence (L-009)", async () => {
    mockProductDAO.getIdByUuid.mockResolvedValue(null);
    mockProductDAO.getByUuid.mockResolvedValue(null);
    const req = makeReq({ clientCode: "X" });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(404);
    expect(mockProductDAO.update).not.toHaveBeenCalled();
  });
});

describe("D-30 (review fix, was unscoped) — recipe-ref resolution is company-scoped (L-009/I-9, mutation-check L-018)", () => {
  it("scopes corrugationUuid resolution to the target company on create — another tenant's uuid 400s the same as a nonexistent one", async () => {
    // Unscoped, the mock would resolve regardless of company; scoped, the
    // query must carry the company predicate — a mutation dropping
    // `applyCompanyScope` here would still pass every other assertion but
    // fail this one, since the WHERE call would go missing.
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: 77,
      theoreticalGrammage: "500",
    });
    const req = makeReq({
      code: "CAJA-SCOPE",
      customerId: CUSTOMER_UUID,
      corrugationUuid: CORRUGATION_UUID,
    });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(201);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      "corrugations.companyId",
      1, // CoreClient.companyIdByUuid is mocked to resolve 1
    );
  });

  it("scopes modelUuid resolution to the caller's company on update — another tenant's uuid answers the same 400 as a nonexistent one", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(storedProduct());
    mockQueryBuilder.first.mockResolvedValueOnce(null); // modelUuid resolves to nothing in this company
    const req = makeReq(
      { modelUuid: "cross-tenant-model-uuid" },
      { companyId: 5 },
    );
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Referenced models not found");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith("models.companyId", 5);
    expect(mockProductDAO.update).not.toHaveBeenCalled();
  });

  it("scopes the legacy customerId resolver to the target company too (same bug class, D-30)", async () => {
    const req = makeReq({ code: "CAJA-SCOPE-3", customerId: CUSTOMER_UUID });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(201);
    expect(mockCustomerDAO.getIdByUuid).toHaveBeenCalledWith(CUSTOMER_UUID, 1);
  });

  it("mutation-check: a corrugationUuid that exists but belongs to another company is rejected the same as a nonexistent one", async () => {
    // Simulates the scoped query finding nothing (as it would for a foreign
    // row): a mutation that dropped scoping would instead resolve it, and
    // this 400 would become a 201 — the case AC-6/I-9 exists to prevent.
    mockQueryBuilder.first.mockResolvedValueOnce(null);
    const req = makeReq({
      code: "CAJA-SCOPE-2",
      customerId: CUSTOMER_UUID,
      corrugationUuid: CORRUGATION_UUID,
    });
    const res = makeRes();

    await controller.create(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Referenced corrugations not found");
    expect(mockProductDAO.create).not.toHaveBeenCalled();
  });
});

describe("I-3/I-15 — PUT writes one UPDATE, plus at most one route (D-32, mutation-check L-018)", () => {
  it("auto-assigns a route when a route-less product first gets a corrugationUuid (I-15 carve-out, D-32)", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({ productionRoute: null, corrugation: null }),
    );
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: 77,
      theoreticalGrammage: "500",
    });
    const req = makeReq({ corrugationUuid: CORRUGATION_UUID });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(mockProductDAO.update).toHaveBeenCalledTimes(1);
    const [, , options] = mockProductDAO.update.mock.calls[0];
    expect(options).toEqual({
      autoAssignRoute: true,
      companyId: 5,
      description: "Existing desc",
    });
  });

  it("does NOT auto-assign when the product already has a route (mutation-check, was the only case before D-32)", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({
        productionRoute: { uuid: "route-uuid", name: "R1" },
        corrugation: null,
      }),
    );
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: 77,
      theoreticalGrammage: "500",
    });
    const req = makeReq({ corrugationUuid: CORRUGATION_UUID });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(200);
    const [, , options] = mockProductDAO.update.mock.calls[0];
    expect(options.autoAssignRoute).toBe(false);
  });

  it("does NOT auto-assign when productionRouteUuid is sent alongside corrugationUuid", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({ productionRoute: null, corrugation: null }),
    );
    mockQueryBuilder.first
      .mockResolvedValueOnce({ id: 77, theoreticalGrammage: "500" }) // corrugation
      .mockResolvedValueOnce({ id: 88 }); // production_routes ref lookup
    const req = makeReq({
      corrugationUuid: CORRUGATION_UUID,
      productionRouteUuid: "route-sent-uuid",
    });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(200);
    const [, , options] = mockProductDAO.update.mock.calls[0];
    expect(options.autoAssignRoute).toBe(false);
  });

  it("rejects clearing corrugationUuid on a product that already has one (model.md PUT contract)", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({ corrugation: { uuid: CORRUGATION_UUID, code: "C1" } }),
    );
    const req = makeReq({ corrugationUuid: null });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("corrugationUuid cannot be empty");
    expect(mockProductDAO.update).not.toHaveBeenCalled();
  });

  it("rejects clearing productionRouteUuid on a product that already has a route", async () => {
    mockProductDAO.getByUuid.mockResolvedValue(
      storedProduct({ productionRoute: { uuid: "route-uuid", name: "R1" } }),
    );
    const req = makeReq({ productionRouteUuid: null });
    const res = makeRes();

    await controller.update(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("productionRouteUuid cannot be empty");
    expect(mockProductDAO.update).not.toHaveBeenCalled();
  });
});
