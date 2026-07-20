import { Request, Response, NextFunction } from "express";

/**
 * SECURITY (M3): clients only ever address resources by UUID. DAOs return internal numeric
 * primary keys (`id`) and numeric foreign keys (`companyId`, `warehouseId`, ...) which must not
 * leak to clients — sequential ids reveal row/tenant counts and expose internal references.
 *
 * This wraps res.json and recursively removes, from every response body:
 *   - the `id` key (internal primary key), and
 *   - any key ending in `Id` whose value is a number (internal numeric foreign key).
 *
 * String-valued ids are preserved on purpose: controllers expose relationships as UUID strings
 * (e.g. `companyId` set to the company's UUID), and business identifiers like
 * `externalSubscriptionId` are strings. UUIDs (always strings) are therefore never stripped.
 *
 * Dates are returned untouched (recursing into a Date would destroy it).
 */
function stripInternalIds(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stripInternalIds);
  }
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === "id") continue;
      if (key.endsWith("Id") && typeof val === "number") continue;
      out[key] = stripInternalIds(val);
    }
    return out;
  }
  return value;
}

export const sanitizeResponse = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => originalJson(stripInternalIds(body));
  next();
};
