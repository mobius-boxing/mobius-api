import { DbKey } from "./keys";
import { tablesOf } from "./ownership";

/**
 * Audit coverage — which tables carry `audit_row_change`, what the trigger must
 * never store, and which child rows belong to a parent entity (P2 / §P2.4).
 *
 * This file is *data plus pure functions*. It holds no connection: it is what
 * the migration and the schema test read to decide what to attach and what to
 * check. `ownership.ts` is deliberately not extended with any of it — that file
 * belongs to the database-per-module split.
 *
 * The point of the manifest is that coverage becomes a property of the schema
 * rather than a per-developer discipline: a new table is either audited or
 * explicitly excluded here, or `audit-coverage.schema.test.ts` fails.
 *
 * Verified against the live `traffic_production` schema on 2026-09-01:
 * 83 base tables = 81 application tables (matching `DOMAIN_OWNER` exactly)
 * + knex's 2 bookkeeping tables. 7 application exclusions leave **74 distinct
 * physical tables** carrying the trigger, reached by **76 `attachAudit` calls**
 * because `files` is fanned out to core + erp + countdown (same physical table,
 * and `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` is idempotent).
 */

/**
 * Tables that never get an audit trigger.
 *
 * `knex_migrations` / `knex_migrations_lock` are not in `DOMAIN_OWNER`, so they
 * are inert in `auditedTablesOf`; they are listed because the live half of the
 * schema test enumerates `information_schema` and must account for every base
 * table it finds.
 */
export const AUDIT_EXCLUDED: ReadonlySet<string> = new Set([
  "audit_logs", // the ledger itself — auditing it would recurse
  "knex_migrations", // knex bookkeeping, not application data
  "knex_migrations_lock", // knex bookkeeping, not application data
  "emailTokens", // single-use secrets, transient by design
  "code_sequences", // per-company counters, one UPDATE per generated code
  "countdown_reminder_log", // job output, already an append-only record
  "countdown_reminder_runs", // job output: one claim row per calendar day
  "countdown_reminder_digests", // job output
  "nf_node_runs", // per-node execution log of a run that is itself audited
]);

/**
 * Columns the trigger must strip from `before` / `after` on every row of the
 * table. Re-verified 2026-09-01 with a full sweep of
 * `%password%|%secret%|%token%|%cipher%|%hash%|%credential%` over
 * `information_schema.columns`; the only other matches are
 * `emailTokens.token` (whole table excluded above),
 * `nf_workflow_credentials.credentialId` (an FK, not a secret) and
 * `nf_runs.{tokensIn,tokensOut}` (LLM token counters, **not** secrets).
 */
export const AUDIT_REDACT: Record<string, string[]> = {
  users: ["password"],
  invitations: ["token"],
  // 20260824000006; `headerName` is not a secret.
  nf_credentials: ["secretCiphertext", "secretIv", "secretTag"],
};

/**
 * A child row's owning entity, so the ledger can carry `rootEntity` /
 * `rootUuid` and the child's change shows up in its parent's history.
 *
 * `parent`/`fk`: `fk` is the column **on the child** pointing at `parent`.
 * `grand`/`grandFk`: `grandFk` is the column **on the parent** pointing at
 * `grand` (the two-hop case). Both flat, matching the trigger's positional
 * arguments `(exclude_csv, parent, fk, grand, grand_fk)`.
 *
 * Every table and column below was checked against `information_schema` on
 * 2026-09-01 — a wrong `fk` makes the trigger throw `column does not exist` on
 * every write of that table, in production, on the first save.
 *
 * Deliberately **not** here: `consumable_stock` / `paper_stock` / `sheet_stock`
 * / `tooling_stock` (first-class entities with their own list pages, not parts
 * of a warehouse), `company_modules` (`companyId` already scopes it) and
 * `sales_orders.orderDataId`, which points *at* `order_data` rather than the
 * other way round.
 */
export type AuditParent = {
  parent: string;
  fk: string;
  grand?: string;
  grandFk?: string;
};

export const AUDIT_PARENT: Record<string, AuditParent> = {
  corrugation_layers: { parent: "corrugations", fk: "corrugationId" },
  paper_class_papers: { parent: "paper_classes", fk: "paperClassId" },
  // per-customer weekday windows (20260720000008); `auditlogs.md` §6's
  // "→ delivery_locations" is wrong.
  delivery_schedules: { parent: "customers", fk: "customerId" },
  production_route_stages: { parent: "production_routes", fk: "routeId" },
  production_route_stage_machines: {
    parent: "production_route_stages",
    fk: "stageId",
    grand: "production_routes",
    grandFk: "routeId",
  },
  production_route_stage_supplies: {
    parent: "production_route_stages",
    fk: "stageId",
    grand: "production_routes",
    grandFk: "routeId",
  },
  countdown_group_members: { parent: "countdown_groups", fk: "groupId" },
  countdown_document_assignments: {
    parent: "countdown_documents",
    fk: "documentId",
  },
  nf_workflow_credentials: { parent: "nf_workflows", fk: "workflowId" },
  role_permissions: { parent: "roles", fk: "roleId" },
  // ── R-D (2026-09-01): six real parent/child pairs the handbook missed ─────
  // `warehouse_locations` is snake_case throughout, `warehouse_id` included.
  warehouse_locations: { parent: "warehouses", fk: "warehouse_id" },
  countdown_subcategories: { parent: "countdown_categories", fk: "categoryId" },
  part_approval_events: { parent: "parts", fk: "partId" },
  sales_order_approval_events: { parent: "sales_orders", fk: "salesOrderId" },
  nf_documents: { parent: "nf_workflows", fk: "workflowId" },
  nf_runs: { parent: "nf_workflows", fk: "workflowId" },
};

/**
 * Every table `key`'s database must carry the audit trigger.
 *
 * Keyed from the start (Amendment 2026-09-01, constraint 2) even though all
 * four keys resolve to one physical database today: the split later changes
 * which connection runs the attach, not this code. Counts today are
 * erp 55 · core 9 · countdown 7 · nodefiles 5 = 76 calls over 74 distinct
 * tables (`files` appears under three keys).
 */
export const auditedTablesOf = (key: DbKey): string[] =>
  tablesOf(key).filter((table) => !AUDIT_EXCLUDED.has(table));
