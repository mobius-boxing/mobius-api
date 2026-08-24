import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { NextFunction, Request, Response } from "express";
import { errorMiddleware } from "../../../middlewares/error/error.middleware";

/**
 * SECURITY regression: knex prefixes every driver error message with the full
 * generated SQL. Any path that echoes `err.message` back to the caller hands
 * them the statement, its joins and its column list.
 *
 * Two escapes were found after the first CLIENT_DATA_EXCEPTIONS pass:
 *   - 22009: a raw out-of-range date STRING (the create/update body path stores
 *     the string verbatim, it never becomes a Date) — PG answers
 *     invalid_time_zone_displacement_value, not 22008.
 *   - 22001: an over-long value for a varchar column (`models.code` is
 *     varchar(100)).
 * Plus the structural fix: an unhandled 5xx never echoes `err.message` at all.
 */
const run = (err: any, req: Partial<Request> = {}) => {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: any) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;

  errorMiddleware(err, req as Request, res, (() => {}) as NextFunction);
  return captured;
};

const leaksSql = (body: any): boolean =>
  /insert into|select /i.test(JSON.stringify(body));

describe("errorMiddleware — client data exceptions", () => {
  it("maps 22009 (out-of-range date string) to 400 without leaking the SQL", () => {
    const err: any = new Error(
      'insert into "sales_orders" ("code", "deliveryDate", "uuid") values ($1, $2, $3) returning * - date/time field value out of range',
    );
    err.code = "22009";

    const out = run(err);

    expect(out.status).toBe(400);
    expect(out.body.code).toBe("INVALID_DATA_TYPE");
    expect(leaksSql(out.body)).toBe(false);
  });

  it("maps 22001 (value too long for a varchar) to 400 without leaking the SQL", () => {
    const err: any = new Error(
      'insert into "models" ("code", "description", "uuid") values ($1, $2, $3) returning * - value too long for type character varying(100)',
    );
    err.code = "22001";

    const out = run(err);

    expect(out.status).toBe(400);
    expect(out.body.code).toBe("INVALID_DATA_TYPE");
    expect(leaksSql(out.body)).toBe(false);
  });
});

describe("errorMiddleware — generic branch", () => {
  const original = process.env.DEBUG_ERRORS;

  beforeEach(() => {
    delete process.env.DEBUG_ERRORS;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DEBUG_ERRORS;
    else process.env.DEBUG_ERRORS = original;
  });

  it("never echoes err.message on an unmapped 5xx, whatever the SQLSTATE", () => {
    const err: any = new Error(
      'select "sales_orders".* from "sales_orders" inner join "customers" ... - boom',
    );
    err.code = "22012"; // division_by_zero: a server-side fault, keeps its 500

    const out = run(err);

    expect(out.status).toBe(500);
    expect(out.body.message).toBe(
      "An unexpected error occurred. Please try again later.",
    );
    expect(leaksSql(out.body)).toBe(false);
    expect(out.body.stack).toBeUndefined();
  });

  it("still echoes deliberate 4xx messages written for the client", () => {
    const out = run(new Error("quantity must be a positive number"), {
      statusCode: 400,
    } as Partial<Request>);

    expect(out.status).toBe(400);
    expect(out.body.message).toBe("quantity must be a positive number");
  });

  it("reveals the detail again when DEBUG_ERRORS is explicitly enabled", () => {
    process.env.DEBUG_ERRORS = "true";

    const out = run(new Error("select 1 - boom"));

    expect(out.status).toBe(500);
    expect(out.body.message).toBe("select 1 - boom");
    expect(out.body.stack).toBeDefined();
  });
});
