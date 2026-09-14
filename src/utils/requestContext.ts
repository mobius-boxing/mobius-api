import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantHandle } from "../database/tenant-pools";

export type RequestContext = {
  companyId?: number;
  companyUuid?: string;
  isSuperAdmin: boolean;
  coreCache: Map<string, unknown>;
  /**
   * Set once per request by `tenant-context.middleware` after `acquireTenant`
   * succeeds (db-per-company T7, model D-12). `registry.ts`'s `db("tenant")`
   * reads it directly — no second `AsyncLocalStorage` entry needed, because
   * this context is already active for the whole request (T1's `tenantContext`
   * middleware wraps it at the top of the chain).
   */
  tenant?: TenantHandle;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined =>
  storage.getStore();

export const getCompanyId = (): number | undefined =>
  storage.getStore()?.companyId;
