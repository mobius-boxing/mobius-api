import { v4 as uuidv4 } from "uuid";
import { db } from "../database/registry";
import { connectionFor } from "../database/env";
import { CompanyDAO } from "../dao/company/company.dao";
import { DbServerDAO } from "../dao/db-server/db-server.dao";
import { TenantDatabaseDAO } from "../dao/tenant-database/tenant-database.dao";
import { TENANT_DATABASE_LIVE_STATUSES } from "../interfaces/tenant/tenant.interfaces";
import { readSnapshotFile, type Checked } from "./purge-snapshot.service";

/**
 * `registerShared` — state C1 (db-per-company model D-21/D-31, brief D-69,
 * AC-46/AC-85). Registers one `active` `tenant_databases` row per existing
 * company, all pointing at the shared server with the core connection's own
 * identity, so the pool layer dedupes them onto the core instance (D-13) and
 * C1 is bit-identical to today. This is the ONLY write `tenant-provisioning
 * .service.ts` ships in T7 — `provision`/`decommission`/`move` are T9.
 *
 * Reads `db("core")` directly for `tenant_databases`/`db_servers` (neither is
 * a CENTRAL_TABLE per AC-10 — only `companies`/`users`/RBAC/`modules`/
 * `invitations`/`emailTokens` are), so this file needs no CoreClient route.
 * It DOES hold a connection directly (the `pg_roles` introspection and the
 * `db_servers` admin-fields write), hence the `architecture.test.ts`
 * `PERMANENT_NON_DAO_HOLDERS` entry.
 */

type RawTenantDatabaseRow = {
  companyId: number;
  databaseName: string;
  status: string;
};

export type RegisterSharedResult = {
  registered: number;
  alreadyRegistered: number;
};

const sortedNumbers = (values: readonly number[]): number[] =>
  [...values].sort((a, b) => a - b);

const sameIdSet = (a: readonly number[], b: readonly number[]): boolean => {
  const left = sortedNumbers(a);
  const right = sortedNumbers(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
};

/**
 * D-32: fills the shared server's admin identity in on first success, only
 * when the connected role can actually provision (`CREATEDB`+`CREATEROLE`).
 * A no-op once `adminUser` is already set, or when the role still lacks it —
 * a later, more-privileged run of this same command completes it then.
 */
async function grantServerAdminIfPossible(serverId: number): Promise<void> {
  const server = await new DbServerDAO().getById(serverId);
  if (!server || server.adminUser) return;
  const knex = db("core");
  const role = await knex.raw(
    `select rolcreatedb and rolcreaterole as allowed from pg_roles where rolname = current_user`,
  );
  const allowed: boolean = role.rows[0]?.allowed === true;
  if (!allowed) return;
  await knex("db_servers")
    .where("id", serverId)
    .update({
      adminUser: connectionFor("core").user,
      adminCredentialRef: "env:SQL_PASSWORD",
      updatedAt: knex.fn.now(),
    });
}

export async function registerShared(
  snapshotPath: string,
): Promise<Checked<RegisterSharedResult>> {
  const snapshot = readSnapshotFile(snapshotPath);
  if (!snapshot.ok) return snapshot;

  const all = await new CompanyDAO().getAll(1, 1_000_000);
  const companyIds = all.data
    .map((company) => company.id)
    .filter((id): id is number => id !== undefined);

  if (!sameIdSet(companyIds, snapshot.value.keeperIds)) {
    return {
      ok: false,
      reason:
        `companies (${companyIds.length}) do not match the snapshot's ` +
        `keeperIds (${snapshot.value.keeperIds.length}) — AC-85(b)`,
    };
  }

  const server = await new DbServerDAO().getDefaultPlacement();
  if (!server) {
    return { ok: false, reason: "no default-placement db_servers row" };
  }

  const coreConnection = connectionFor("core");
  const existingRows: RawTenantDatabaseRow[] = await db("core")(
    "tenant_databases",
  ).select("companyId", "databaseName", "status");
  const liveRows = existingRows.filter((row) =>
    TENANT_DATABASE_LIVE_STATUSES.includes(
      row.status as (typeof TENANT_DATABASE_LIVE_STATUSES)[number],
    ),
  );
  const movedAway = liveRows.filter(
    (row) => row.databaseName !== coreConnection.database,
  );
  if (movedAway.length > 0) {
    return {
      ok: false,
      reason:
        `${movedAway.length} tenant_databases row(s) already point at a ` +
        `dedicated server — register-shared refuses once any C2 move has ` +
        `happened (AC-85(c), D-71)`,
    };
  }

  const alreadyRegistered = new Set(liveRows.map((row) => row.companyId));
  const tenantDAO = new TenantDatabaseDAO();
  let registered = 0;
  for (const company of all.data) {
    if (company.id === undefined || alreadyRegistered.has(company.id)) {
      continue;
    }
    const created = await tenantDAO.create({
      uuid: uuidv4(),
      companyId: company.id,
      serverId: server.id,
      databaseName: coreConnection.database,
      dbUser: coreConnection.user ?? "",
      credentialRef: "env:SQL_PASSWORD",
      credentialCiphertext: null,
    });
    await tenantDAO.transition(created.id, "provisioning", "active", {
      migrationState: "current",
      provisionedAt: new Date(),
    });
    registered += 1;
  }

  await grantServerAdminIfPossible(server.id);

  return {
    ok: true,
    value: { registered, alreadyRegistered: alreadyRegistered.size },
  };
}
