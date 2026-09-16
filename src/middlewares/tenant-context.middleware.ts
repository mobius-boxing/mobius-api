import type { NextFunction, Request, Response } from "express";
import { CoreClient } from "../services/core-client.service";
import { getCompanyScope } from "../utils/companyScope";
import { getRequestContext, runWithContext } from "../utils/requestContext";
import {
  acquireTenant,
  COMPANY_REQUIRED_BODY,
  TENANT_ERROR_RESPONSES,
} from "../database/tenant-pools";

/** RFC 4122 shape only — a malformed uuid would make Postgres throw, not answer. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPANY_NOT_FOUND_BODY = {
  success: false,
  code: "COMPANY_NOT_FOUND",
  message: "The selected company no longer exists.",
} as const;

/**
 * Which plane a `src/routes/*` folder belongs to (db-per-company T7, model
 * D-14, D-61). `central` never acquires a tenant and never answers a
 * `TENANT_*`/`COMPANY_REQUIRED` code — the model's own enumeration
 * (`/auth/*`, `/companies`, `/users`, `/invitations`, `/modules`, `/public/*`)
 * plus `health`, which authenticates nobody. `mixed` (`audit-logs`, T3/D-108's
 * fan-out) acquires when a company IS selected, but does not pre-emptively
 * refuse `COMPANY_REQUIRED` when none is — the central half of its ledger is
 * always readable; a later `db("tenant")` call with nothing acquired throws
 * `TenantNotResolvedError`, which the error middleware still maps to 400
 * `COMPANY_REQUIRED`. Every other folder is `tenant`: it must resolve a
 * company before its handler runs.
 *
 * The architecture test requires every folder under `src/routes/` to appear
 * here, so a new route folder cannot silently default to either extreme.
 */
export const ROUTE_PLANE: Record<string, "central" | "tenant" | "mixed"> = {
  "app-config": "tenant",
  "audit-logs": "mixed",
  auth: "central",
  "box-type": "tenant",
  color: "tenant",
  "color-type": "tenant",
  companies: "central",
  complement: "tenant",
  "consumable-stock": "tenant",
  "consumable-supply": "tenant",
  "consumable-type": "tenant",
  corrugation: "tenant",
  "corrugation-class": "tenant",
  countdown: "tenant",
  customer: "tenant",
  "customer-category": "tenant",
  // db-per-company T10 (known amendment, brief HANDOFF "T10/T11 launch
  // notes"): a new central-plane route folder needs an explicit entry — the
  // architecture test forces every folder to be classified.
  "db-servers": "central",
  "delivery-locations": "tenant",
  "delivery-zones": "tenant",
  // Device approval (feat/device-approval): `user_devices` is a `core` table
  // joined only to `users` (also `core`, model D-10) — no tenant DB involved.
  devices: "central",
  files: "tenant",
  "finished-goods": "tenant",
  "flap-type": "tenant",
  "flute-type": "tenant",
  "fsc-type": "tenant",
  "glue-type": "tenant",
  health: "central",
  invitations: "central",
  machine: "tenant",
  "machine-type": "tenant",
  manufacturer: "tenant",
  models: "tenant",
  modules: "central",
  "node-files": "tenant",
  "pallet-types": "tenant",
  palletizations: "tenant",
  "paper-class": "tenant",
  "paper-sheet": "tenant",
  "paper-stock": "tenant",
  "paper-supply": "tenant",
  "paper-type": "tenant",
  permissions: "tenant",
  product: "tenant",
  "product-type": "tenant",
  "production-orders": "tenant",
  "production-routes": "tenant",
  public: "central",
  roles: "tenant",
  "sales-orders": "tenant",
  "sheet-stock": "tenant",
  "strapping-type": "tenant",
  supplier: "tenant",
  tooling: "tenant",
  "tooling-stock": "tenant",
  "tooling-type": "tenant",
  "trace-type": "tenant",
  users: "central",
  warehouse: "tenant",
  warehouseLocation: "tenant",
};

/**
 * The route folder mounted for this request — `req.baseUrl` is `/api/<folder>`
 * for every route-level middleware (`IndexRouter` mounts each router at
 * `/<folder>` under `/api`; `authenticate` runs inside that router, never at
 * app level — L-005). `undefined` for anything that does not match, which
 * `routePlaneFor` treats as `central` (no company, no acquisition) rather
 * than refuse a request the router table itself never routed.
 */
const routeFolder = (req: Request): string | undefined =>
  req.baseUrl?.split("/")[2];

const routePlaneFor = (req: Request): "central" | "tenant" | "mixed" =>
  ROUTE_PLANE[routeFolder(req) ?? ""] ?? "central";

/**
 * Opens the per-request context every request runs in. It cannot resolve the
 * company itself: `authenticate` is mounted inside each router, so `req.user`
 * does not exist yet at app level. `resolveTenantContext` fills this context in
 * once `authenticate` has set the user.
 */
export const tenantContext = (
  _req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  runWithContext({ isSuperAdmin: false, coreCache: new Map() }, next);
};

/**
 * SECURITY: the uuid→id lookup goes through `CoreClient`, never a bare DAO
 * (T2 review note). A core outage then surfaces as `CoreUnavailableError`,
 * which `authenticate`'s `catch` hands to `next(error)` and the error
 * middleware answers 503 — never a 500 or a silently-unscoped request.
 */
const lookupCompanyId = async (uuid: unknown): Promise<number | undefined> => {
  if (typeof uuid !== "string" || !UUID_RE.test(uuid)) return undefined;
  return (await CoreClient.companyIdByUuid(uuid)) ?? undefined;
};

/**
 * Resolves the effective company once per request, with `getCompanyScope`
 * precedence (superAdmin: `?companyId`, then `body.companyId`; everyone else:
 * the token), sets `req.companyId` plus the request context, and — for a
 * `tenant`/`mixed` route — resolves a tenant handle or answers before the
 * handler runs (db-per-company T7, model D-12/D-14/D-45/D-61, AC-42/AC-92).
 *
 * A superAdmin targets a tenant with `?companyId=<uuid>` (the SPA's company
 * switcher, which remembers its choice in localStorage). If that company has
 * since been deleted, every scoped list answers 200 with zero rows and the app
 * reads as EMPTY rather than STALE — on every screen at once, with nothing
 * pointing at the switcher. Answer 404 so the caller can tell the difference.
 *
 * Only superAdmins can supply this: for everyone else parseQueryParams ignores
 * the parameter entirely and uses the token's company.
 *
 * @returns false when it has already answered; the caller must not call next().
 */
export const resolveTenantContext = async (
  req: Request,
  res: Response,
): Promise<boolean> => {
  const selected = req.query.companyId;
  const selectsCompany =
    req.user?.role === "superAdmin" && typeof selected === "string";

  if (selectsCompany && !UUID_RE.test(selected)) {
    res.status(404).json(COMPANY_NOT_FOUND_BODY);
    return false;
  }

  const scope = getCompanyScope(req);
  const companyId = await lookupCompanyId(scope.companyUuid);

  if (selectsCompany && companyId === undefined) {
    res.status(404).json(COMPANY_NOT_FOUND_BODY);
    return false;
  }

  req.companyId = companyId;

  const context = getRequestContext();
  if (context) {
    context.isSuperAdmin = scope.isSuperAdmin;
    if (companyId !== undefined) {
      context.companyId = companyId;
      context.companyUuid = scope.companyUuid;
    }
  }

  const plane = routePlaneFor(req);
  if (plane === "central") return true;

  if (companyId === undefined) {
    // AC-92 (I-9, D-67, D-93): this is the ONLY gate a NULL-company
    // non-superAdmin meets — no DAO call happens before it, so a list
    // endpoint can never fall back to "no scoping" again.
    if (plane === "mixed") return true;
    res.status(400).json(COMPANY_REQUIRED_BODY);
    return false;
  }

  const resolution = await acquireTenant(companyId);
  if (resolution.kind === "ok") {
    resolution.handle.companyUuid = scope.companyUuid ?? "";
    if (context) context.tenant = resolution.handle;
    return true;
  }

  const mapped = TENANT_ERROR_RESPONSES[resolution.kind];
  if (mapped.retryAfter !== undefined) {
    res.set("Retry-After", String(mapped.retryAfter));
  }
  res.status(mapped.status).json({
    success: false,
    code: mapped.code,
    message: mapped.message,
  });
  return false;
};
