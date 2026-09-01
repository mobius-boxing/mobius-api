import type { Knex } from "knex";
import { DB_KEYS } from "../src/database/keys";
import {
  AUDIT_PARENT,
  AUDIT_REDACT,
  auditedTablesOf,
} from "../src/database/audit-coverage";
import {
  AUDIT_FUNCTION_SQL,
  PROTECTION_FUNCTION_SQL,
  attachAudit,
  createAuditLogsV2,
  ensureAuditPartitions,
} from "../src/database/audit-triggers";

/**
 * Audit P2 / track T4a — the cutover: `audit_logs` v2 plus the row triggers
 * that replace the application's audit path.
 *
 * This migration and the deletion of `AuditService` are ONE deploy and cannot
 * be separated. v2 has no `snapshot` column, so the old `AuditLogDAO.insert`
 * would fail against it, and under P1's ambient transaction a failed insert
 * aborts the request's transaction (`25P02`) and answers 500 COMMIT_FAILED for
 * every mutating request. The deploy order happens to be safe: containers swap
 * ~30 s BEFORE migrations run, and in that window the new code writes no audit
 * rows from the application at all — capture is simply off, with no errors.
 *
 * Steps, in this order:
 *   1. drop the v1 table, but only if it is v1 (it has a `snapshot` column).
 *      Its ~2.9 k dev / 142 prod rows are pre-launch test data (decision Q-R1).
 *   2. create the v2 partitioned ledger, its DEFAULT partition and its indexes.
 *   3. create 13 months of monthly partitions from this month forward.
 *   4. create both plpgsql functions.
 *   5. attach `audit_row_change` to every audited table of every key.
 *   6. install the append-only protection trigger LAST — after T3's
 *      `purgeCompany` is in place, so there is already a sanctioned door for
 *      removing a tenant's trail.
 *
 * Idempotent throughout (`IF NOT EXISTS` / `CREATE OR REPLACE` /
 * `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`): all four keys resolve to one
 * physical database today, so `files` is attached three times and the whole
 * migration must be re-runnable against each new database at the split's
 * cutover (Amendment 2026-09-01, constraint 1).
 *
 * `down()` exists for local dev only. Production is roll-forward only (L-003),
 * and a `git revert` of this phase is NOT a rollback: the application code that
 * writes `snapshot` is gone, and bringing it back against a v2 table 500s every
 * mutating request. The emergency stop is SQL, not git —
 * `DROP FUNCTION public.audit_row_change() CASCADE` drops all 74 triggers in
 * one statement and leaves the ledger in place with capture off.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'audit_logs'
           AND column_name = 'snapshot'
      ) THEN
        DROP TABLE public.audit_logs;
      END IF;
    END $migration$;
  `);

  await createAuditLogsV2(knex);
  await ensureAuditPartitions(knex, 13);

  await knex.raw(AUDIT_FUNCTION_SQL);

  for (const key of DB_KEYS) {
    for (const table of auditedTablesOf(key)) {
      await attachAudit(knex, table, {
        exclude: AUDIT_REDACT[table],
        parent: AUDIT_PARENT[table],
      });
    }
  }

  // Last: everything above writes nothing to the ledger, and the protection
  // trigger must not be able to block a step of this migration.
  await knex.raw(PROTECTION_FUNCTION_SQL);
}

export async function down(): Promise<void> {
  // Roll-forward only (L-003): intentionally empty. Prod never rolls back —
  // the manual kill switch is `DROP FUNCTION public.audit_row_change() CASCADE`
  // plus `DROP TRIGGER audit_logs_protect ON audit_logs`, which stops capture
  // without touching the rows already written.
}
