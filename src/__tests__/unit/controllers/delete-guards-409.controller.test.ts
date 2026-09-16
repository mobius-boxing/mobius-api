// @ts-nocheck
/**
 * AC-11 (D-22, C-15) — deleting a model/route/palletization referenced by a
 * product answers 409 (never 23503, never the base class's 400 fk-catch).
 * Mutation-check (L-018): each guard is exercised with count=0 (delete
 * proceeds) AND count>0 (delete is blocked), so a mutation that always skips
 * — or always fires — the guard fails one side or the other.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const modelDAO = {
  getIdByUuid: jest.fn(),
  countProductsReferencing: jest.fn(),
  delete: jest.fn(),
};
const routeDAO = {
  getByUuid: jest.fn(),
  countProductsReferencing: jest.fn(),
  delete: jest.fn(),
};
const palletizationDAO = {
  getIdByUuid: jest.fn(),
  countProductsReferencing: jest.fn(),
  delete: jest.fn(),
};

jest.mock("../../../dao/model/model.dao", () => ({
  ModelDAO: function () {
    return {
      getIdByUuid: (...a) => modelDAO.getIdByUuid(...a),
      countProductsReferencing: (...a) =>
        modelDAO.countProductsReferencing(...a),
      delete: (...a) => modelDAO.delete(...a),
    };
  },
}));
jest.mock("../../../dao/flap-type/flap-type.dao", () => ({
  FlapTypeDAO: function () {
    return {};
  },
}));
jest.mock("../../../dao/complement/complement.dao", () => ({
  ComplementDAO: function () {
    return {};
  },
}));
jest.mock("../../../dao/production-route/production-route.dao", () => ({
  ProductionRouteDAO: function () {
    return {
      getByUuid: (...a) => routeDAO.getByUuid(...a),
      countProductsReferencing: (...a) =>
        routeDAO.countProductsReferencing(...a),
      delete: (...a) => routeDAO.delete(...a),
    };
  },
  SUPPLY_TABLES: {},
}));
jest.mock("../../../dao/machine-type/machine-type.dao", () => ({
  MachineTypeDAO: function () {
    return {};
  },
}));
jest.mock("../../../dao/machine/machine.dao", () => ({
  MachineDAO: function () {
    return {};
  },
}));
jest.mock("../../../dao/palletization/palletization.dao", () => ({
  PalletizationDAO: function () {
    return {
      getIdByUuid: (...a) => palletizationDAO.getIdByUuid(...a),
      countProductsReferencing: (...a) =>
        palletizationDAO.countProductsReferencing(...a),
      delete: (...a) => palletizationDAO.delete(...a),
    };
  },
}));
jest.mock("../../../dao/pallet-type/pallet-type.dao", () => ({
  PalletTypeDAO: function () {
    return {};
  },
}));

import { ModelController } from "../../../controllers/model/model.controller";
import { ProductionRouteController } from "../../../controllers/production-route/production-route.controller";
import { PalletizationController } from "../../../controllers/palletization/palletization.controller";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => ((res.statusCode = code), res));
  res.json = jest.fn((payload) => ((res.body = payload), res));
  return res;
};

const makeReq = () => ({
  params: { uuid: UUID },
  query: {},
  body: {},
  user: { userId: "u-1", role: "member", companyId: "company-a" },
  companyId: 5,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ModelController.delete", () => {
  it("409s with the count and product codes when products reference the model", async () => {
    modelDAO.getIdByUuid.mockResolvedValue(11);
    modelDAO.countProductsReferencing.mockResolvedValue({
      count: 2,
      codes: ["BOX-1", "BOX-2"],
    });
    const req = makeReq();
    const res = makeRes();

    await new ModelController().delete(req, res, () => {});

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, count: 2 });
    expect(res.body.productCodes).toEqual(["BOX-1", "BOX-2"]);
    expect(modelDAO.delete).not.toHaveBeenCalled();
  });

  it("deletes when no product references the model (count = 0)", async () => {
    modelDAO.getIdByUuid.mockResolvedValue(11);
    modelDAO.countProductsReferencing.mockResolvedValue({
      count: 0,
      codes: [],
    });
    modelDAO.delete.mockResolvedValue(true);
    const req = makeReq();
    const res = makeRes();

    await new ModelController().delete(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(modelDAO.delete).toHaveBeenCalledWith(11);
  });
});

describe("ProductionRouteController.delete", () => {
  it("409s with the count and product codes when products reference the route", async () => {
    routeDAO.getByUuid.mockResolvedValue({ id: 22, uuid: UUID });
    routeDAO.countProductsReferencing.mockResolvedValue({
      count: 3,
      codes: ["BOX-3"],
    });
    const req = makeReq();
    const res = makeRes();

    await new ProductionRouteController().delete(req, res, () => {});

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, count: 3 });
    expect(routeDAO.delete).not.toHaveBeenCalled();
  });

  it("deletes when no product references the route (count = 0)", async () => {
    routeDAO.getByUuid.mockResolvedValue({ id: 22, uuid: UUID });
    routeDAO.countProductsReferencing.mockResolvedValue({
      count: 0,
      codes: [],
    });
    routeDAO.delete.mockResolvedValue(true);
    const req = makeReq();
    const res = makeRes();

    await new ProductionRouteController().delete(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(routeDAO.delete).toHaveBeenCalledWith(22);
  });
});

describe("PalletizationController.delete (D-22: FK is SET NULL, so the pre-check IS the guard)", () => {
  it("409s with the count and product codes when products reference the palletization", async () => {
    palletizationDAO.getIdByUuid.mockResolvedValue(33);
    palletizationDAO.countProductsReferencing.mockResolvedValue({
      count: 1,
      codes: ["BOX-4"],
    });
    const req = makeReq();
    const res = makeRes();

    await new PalletizationController().delete(req, res, () => {});

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, count: 1 });
    expect(palletizationDAO.delete).not.toHaveBeenCalled();
  });

  it("deletes when no product references the palletization (count = 0)", async () => {
    palletizationDAO.getIdByUuid.mockResolvedValue(33);
    palletizationDAO.countProductsReferencing.mockResolvedValue({
      count: 0,
      codes: [],
    });
    palletizationDAO.delete.mockResolvedValue(true);
    const req = makeReq();
    const res = makeRes();

    await new PalletizationController().delete(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(palletizationDAO.delete).toHaveBeenCalledWith(33);
  });
});
