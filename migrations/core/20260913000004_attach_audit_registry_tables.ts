import type { Knex } from "knex";
import { attachAudit, detachAudit } from "../../src/database/audit-triggers";

/**
 * db-per-company T6 — attaches `audit_row_change` to the three registry
 * tables (model: "all three tables are audited by the existing... trigger").
 * `credentialCiphertext`/`adminCredentialCiphertext` are excluded exactly
 * like `nf_credentials.secret*` (AC-35, `AUDIT_REDACT`): the event is
 * recorded, the ciphertext value never is.
 */
export async function up(knex: Knex): Promise<void> {
  await attachAudit(knex, "db_servers", {
    exclude: ["adminCredentialCiphertext"],
  });
  await attachAudit(knex, "tenant_databases", {
    exclude: ["credentialCiphertext"],
  });
  await attachAudit(knex, "tenant_migration_runs");
}

export async function down(knex: Knex): Promise<void> {
  await detachAudit(knex, "tenant_migration_runs");
  await detachAudit(knex, "tenant_databases");
  await detachAudit(knex, "db_servers");
}
