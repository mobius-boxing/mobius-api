import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  companyId?: number;
  companyUuid?: string;
  isSuperAdmin: boolean;
  coreCache: Map<string, unknown>;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined =>
  storage.getStore();

export const getCompanyId = (): number | undefined =>
  storage.getStore()?.companyId;
