import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { NextFunction, Request, Response } from "express";
import { errorMiddleware } from "../../../middlewares/error/error.middleware";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

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

/**
 * SECURITY (M2) regression for the ONE deliberate exemption to the DEBUG_ERRORS
 * gate: our own `ValidationError` publishes its per-field `errors` array
 * unconditionally, because every message in it is author-written Spanish keyed
 * by a DTO field name the caller just submitted. Anything else merely NAMED
 * "ValidationError" must stay gated — a name is trivially spoofable and a
 * wrapped driver error's `details` can carry column names or knex's generated
 * SQL.
 */
describe("errorMiddleware — ValidationError field detail", () => {
  const original = process.env.DEBUG_ERRORS;

  beforeEach(() => {
    delete process.env.DEBUG_ERRORS;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DEBUG_ERRORS;
    else process.env.DEBUG_ERRORS = original;
  });

  it("publishes our own ValidationError's field errors without DEBUG_ERRORS", () => {
    const out = run(
      new ValidationError([
        { field: "code", message: "El código es obligatorio" },
        { field: "length", message: "El largo debe ser un número" },
      ]),
    );

    expect(out.status).toBe(400);
    expect(out.body.code).toBe("VALIDATION_ERROR");
    expect(out.body.message).toBe("El código es obligatorio");
    expect(out.body.errors).toEqual([
      { field: "code", message: "El código es obligatorio" },
      { field: "length", message: "El largo debe ser un número" },
    ]);
  });

  it("keeps the gate on a foreign error that merely calls itself ValidationError", () => {
    const impostor: any = new Error("boom");
    impostor.name = "ValidationError";
    impostor.isValidationError = true;
    // A POPULATED errors array is the point: if the exemption were keyed on the
    // spoofable `name` instead of `instanceof`, this leaks verbatim.
    impostor.errors = [
      {
        field: "internal_secret_column",
        message: 'insert into "flute_types" ("code") values ($1) - boom',
      },
    ];
    impostor.details = { column: "internal_secret_column" };

    const out = run(impostor);

    expect(out.status).toBe(400);
    expect(out.body.code).toBe("VALIDATION_ERROR");
    expect(out.body.errors).toBeUndefined();
    expect(leaksSql(out.body)).toBe(false);
    expect(JSON.stringify(out.body)).not.toContain("internal_secret_column");
  });

  it("still reveals a foreign ValidationError's detail under DEBUG_ERRORS", () => {
    process.env.DEBUG_ERRORS = "true";

    const impostor: any = new Error("boom");
    impostor.name = "ValidationError";
    impostor.details = { column: "code" };

    const out = run(impostor);

    expect(out.body.errors).toEqual({ column: "code" });
  });
});
