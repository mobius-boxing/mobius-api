import { Response } from "express";
import { sanitizeResponse } from "../../../middlewares/sanitize-response.middleware";

/**
 * M3: the middleware wraps res.json to strip internal numeric ids from every response.
 * `run` installs the wrapper, then invokes res.json(payload) and returns what the underlying
 * (original) json received — i.e. the sanitized body the client would actually get.
 */
const run = (payload: any): any => {
  const captured: any[] = [];
  const res = {
    json: ((body: any) => {
      captured.push(body);
      return res;
    }) as any,
  } as Response;
  const next = jest.fn();

  sanitizeResponse({} as any, res, next);
  expect(next).toHaveBeenCalled();

  (res.json as any)(payload);
  return captured[0];
};

describe("sanitizeResponse middleware (M3)", () => {
  it("strips the numeric primary key `id` at every nesting level", () => {
    const out = run({
      id: 1,
      uuid: "u",
      nested: { id: 2, uuid: "n" },
      list: [{ id: 3, uuid: "l" }],
    });
    expect(out).toEqual({
      uuid: "u",
      nested: { uuid: "n" },
      list: [{ uuid: "l" }],
    });
  });

  it("strips numeric foreign-key *Id fields but keeps UUID-string ids", () => {
    expect(
      run({ companyId: 5, salesPersonId: 7, warehouseId: 9, name: "x" }),
    ).toEqual({
      name: "x",
    });
    // Controllers expose relationships as UUID strings — those must survive.
    expect(run({ companyId: "c804-uuid" })).toEqual({ companyId: "c804-uuid" });
  });

  it("keeps string business identifiers ending in Id (e.g. externalSubscriptionId)", () => {
    expect(run({ externalSubscriptionId: "sub_123", uuid: "u" })).toEqual({
      externalSubscriptionId: "sub_123",
      uuid: "u",
    });
  });

  it("preserves Date values untouched", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const out = run({ uuid: "u", createdAt: d });
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.createdAt.getTime()).toBe(d.getTime());
  });

  it("leaves the success envelope + pagination meta intact", () => {
    expect(
      run({
        success: true,
        data: [{ id: 1, uuid: "a", companyId: 2 }],
        page: 1,
        limit: 20,
        count: 1,
        totalCount: 1,
        totalPages: 1,
      }),
    ).toEqual({
      success: true,
      data: [{ uuid: "a" }],
      page: 1,
      limit: 20,
      count: 1,
      totalCount: 1,
      totalPages: 1,
    });
  });

  it("handles null and primitives without throwing", () => {
    expect(run({ a: null, b: 0, c: false, d: "x", uuid: "u" })).toEqual({
      a: null,
      b: 0,
      c: false,
      d: "x",
      uuid: "u",
    });
  });
});
