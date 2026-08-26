// @ts-nocheck
/**
 * `GET /product/:productUuid/parts` — the nested parts grid on the product
 * detail page.
 *
 * The controller used to pass the route's productUuid to the DAO by assigning
 * it onto `req.query`. Express 5 re-parses `req.query` on every access, so the
 * assignment was discarded, the filter never reached the DAO, and the "parts of
 * this product" grid listed EVERY part in the company — silently, with a 200.
 *
 * The route parameter must therefore reach the DAO as an argument. Asserting on
 * req.query alone would not catch the regression: the bug was that req.query
 * looked right to the code that wrote it and empty to the code that read it.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockGetAllWithFilters = jest.fn();

jest.mock("../../../dao/part/part.dao", () => ({
  PartDAO: function () {
    return {
      getAllWithFilters: (...a) => mockGetAllWithFilters(...a),
    };
  },
}));

import { PartController } from "../../../controllers/part/part.controller";

const PRODUCT_UUID = "33333333-3333-3333-3333-333333333333";

describe("PartController.getAllForProduct", () => {
  let controller;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllWithFilters.mockResolvedValue({ success: true, data: [] });
    controller = new PartController();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it("passes the route's productUuid to the DAO as an argument", async () => {
    const req = { params: { productUuid: PRODUCT_UUID }, query: {} };

    await controller.getAllForProduct(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockGetAllWithFilters).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ productUuid: PRODUCT_UUID }),
    );
  });

  it("does not depend on req.query carrying the filter", async () => {
    // A frozen query object stands in for Express 5's re-parsing getter: any
    // attempt to smuggle the filter through it throws here instead of being
    // silently dropped in production.
    const req = {
      params: { productUuid: PRODUCT_UUID },
      query: Object.freeze({}),
    };

    await controller.getAllForProduct(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
