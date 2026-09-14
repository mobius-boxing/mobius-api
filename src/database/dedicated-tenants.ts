import { knex as createKnex, type Knex } from "knex";
import { connectionFor, connectionForTenant } from "./env";
import { resolveCredential } from "./credential-resolver";
import { TenantDatabaseDAO } from "../dao/tenant-database/tenant-database.dao";
import { DbServerDAO } from "../dao/db-server/db-server.dao";
import type {
  IDbServer,
  ITenantDatabase,
} from "../interfaces/tenant/tenant.interfaces";

/**
 * Every dedicated `tenant_*` database, each its own physical server (T9
 * AC-56, T12a). Extracted from `db-check-integrity.ts` so `purgeUser`
 * (company-purge.service.ts) loops the same live fleet a check does, rather
 * than re-deriving it from the registry a second way.
 */
export type DedicatedTenantTarget = {
  row: ITenantDatabase;
  server: IDbServer;
};

/** Live and suspended tenant rows whose database is not the shared/core one. */
export async function listDedicatedTenants(): Promise<DedicatedTenantTarget[]> {
  const coreDatabase = connectionFor("core").database;
  const tenantDAO = new TenantDatabaseDAO();
  const dbServerDAO = new DbServerDAO();
  const rows = (await tenantDAO.listForFleetMigration()).filter(
    (row) => row.databaseName !== coreDatabase,
  );
  const targets: DedicatedTenantTarget[] = [];
  for (const row of rows) {
    const server = await dbServerDAO.getById(row.serverId);
    if (server) targets.push({ row, server });
  }
  return targets;
}

/** A short-lived, one-connection pool onto a dedicated tenant's own database. */
export async function openDedicatedTenant(
  target: DedicatedTenantTarget,
): Promise<Knex> {
  const password = await resolveCredential(
    target.row.credentialRef,
    target.row.credentialCiphertext,
  );
  return createKnex({
    client: "pg",
    connection: connectionForTenant(target.row, target.server, password),
    pool: { min: 0, max: 1 },
  });
}

export const closeDedicatedTenant = (knex: Knex): Promise<void> =>
  knex.destroy();

/** The one dedicated tenant target for a company, or `null` off the shared/core target or unprovisioned (T12a `--company`). */
export async function resolveDedicatedTenant(
  companyId: number,
): Promise<DedicatedTenantTarget | null> {
  const coreDatabase = connectionFor("core").database;
  const row = await new TenantDatabaseDAO().getLiveByCompanyId(companyId);
  if (!row || row.databaseName === coreDatabase) return null;
  const server = await new DbServerDAO().getById(row.serverId);
  return server ? { row, server } : null;
}
