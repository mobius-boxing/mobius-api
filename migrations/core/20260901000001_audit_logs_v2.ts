import type { Knex } from "knex";
import {
  AUDIT_FUNCTION_SQL,
  PROTECTION_FUNCTION_SQL,
  attachAudit,
  createAuditLogsV2,
  ensureAuditPartitions,
} from "../../src/database/audit-triggers";

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
 *   5. attach `audit_row_change` to the tables this migration audited as of
 *      2026-09-01 (FROZEN_AUDITED_TABLES below — see its own comment).
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

/**
 * A frozen, literal snapshot of `auditedTablesOf(key)` / `AUDIT_REDACT` /
 * `AUDIT_PARENT` exactly as they read on 2026-09-01, when this migration was
 * authored and first applied (75 `attachAudit` calls over 74 distinct
 * tables — `files` appears twice, once per plane).
 *
 * INVARIANT (db-per-company T6/D-orch-1): an already-applied migration must
 * never derive its DDL from a live registry (`ownership.ts` /
 * `audit-coverage.ts`). Those files grow as later tracks add tables. An
 * already-applied migration never re-runs anywhere it has run, so a later
 * addition cannot change what it already did there — but a brand-new
 * environment replays the full migration history in order, and this
 * migration would then run BEFORE whatever later migration creates that new
 * table. Reading the live registry turned that into `relation "..." does not
 * exist`, discovered when T6 added `db_servers`/`tenant_databases`/
 * `tenant_migration_runs` to `ownership.ts` after this file shipped.
 * Freezing this migration's own view of the world is what makes a
 * from-scratch replay deterministic, independent of anything added since.
 *
 * A later table that also needs `audit_row_change` gets it from ITS OWN
 * migration instead (see `20260913000004_attach_audit_registry_tables.ts`
 * for the pattern: explicit table names, not a live list) — never by
 * teaching this file to look further ahead than 2026-09-01.
 */
const FROZEN_AUDITED_TABLES: ReadonlyArray<{
  table: string;
  exclude?: string[];
  parent?: { parent: string; fk: string; grand?: string; grandFk?: string };
}> = [
  { table: "users", exclude: ["password"] },
  { table: "companies" },
  { table: "invitations", exclude: ["token"] },
  { table: "modules" },
  { table: "company_modules" },
  { table: "roles" },
  { table: "permissions" },
  { table: "role_permissions", parent: { parent: "roles", fk: "roleId" } },
  { table: "files" },
  { table: "countdown_categories" },
  {
    table: "countdown_subcategories",
    parent: { parent: "countdown_categories", fk: "categoryId" },
  },
  { table: "countdown_documents" },
  {
    table: "countdown_document_assignments",
    parent: { parent: "countdown_documents", fk: "documentId" },
  },
  { table: "countdown_groups" },
  {
    table: "countdown_group_members",
    parent: { parent: "countdown_groups", fk: "groupId" },
  },
  { table: "nf_workflows" },
  {
    table: "nf_documents",
    parent: { parent: "nf_workflows", fk: "workflowId" },
  },
  { table: "nf_runs", parent: { parent: "nf_workflows", fk: "workflowId" } },
  {
    table: "nf_credentials",
    exclude: ["secretCiphertext", "secretIv", "secretTag"],
  },
  {
    table: "nf_workflow_credentials",
    parent: { parent: "nf_workflows", fk: "workflowId" },
  },
  { table: "app_config" },
  { table: "box_types" },
  { table: "color_types" },
  { table: "colors" },
  { table: "complements" },
  { table: "consumable_stock" },
  { table: "consumable_supplies" },
  { table: "consumable_types" },
  { table: "corrugation_classes" },
  {
    table: "corrugation_layers",
    parent: { parent: "corrugations", fk: "corrugationId" },
  },
  { table: "corrugations" },
  { table: "customer_categories" },
  { table: "customers" },
  { table: "delivery_locations" },
  {
    table: "delivery_schedules",
    parent: { parent: "customers", fk: "customerId" },
  },
  { table: "delivery_zones" },
  { table: "finished_goods" },
  { table: "flap_types" },
  { table: "flute_types" },
  { table: "fsc_types" },
  { table: "glue_types" },
  { table: "machine_types" },
  { table: "machines" },
  { table: "manufacturers" },
  { table: "models" },
  { table: "order_data" },
  { table: "pallet_types" },
  { table: "palletizations" },
  {
    table: "paper_class_papers",
    parent: { parent: "paper_classes", fk: "paperClassId" },
  },
  { table: "paper_classes" },
  { table: "paper_sheets" },
  { table: "paper_stock" },
  { table: "paper_supplies" },
  { table: "paper_types" },
  { table: "part_approval_events", parent: { parent: "parts", fk: "partId" } },
  { table: "parts" },
  { table: "product_types" },
  { table: "production_orders" },
  {
    table: "production_route_stage_machines",
    parent: {
      parent: "production_route_stages",
      fk: "stageId",
      grand: "production_routes",
      grandFk: "routeId",
    },
  },
  {
    table: "production_route_stage_supplies",
    parent: {
      parent: "production_route_stages",
      fk: "stageId",
      grand: "production_routes",
      grandFk: "routeId",
    },
  },
  {
    table: "production_route_stages",
    parent: { parent: "production_routes", fk: "routeId" },
  },
  { table: "production_routes" },
  { table: "products" },
  {
    table: "sales_order_approval_events",
    parent: { parent: "sales_orders", fk: "salesOrderId" },
  },
  { table: "sales_orders" },
  { table: "sheet_stock" },
  { table: "strapping_types" },
  { table: "suppliers" },
  { table: "tooling_stock" },
  { table: "tooling_types" },
  { table: "toolings" },
  { table: "trace_types" },
  {
    table: "warehouse_locations",
    parent: { parent: "warehouses", fk: "warehouse_id" },
  },
  { table: "warehouses" },
  { table: "files" },
];

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

  for (const { table, exclude, parent } of FROZEN_AUDITED_TABLES) {
    await attachAudit(knex, table, { exclude, parent });
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
