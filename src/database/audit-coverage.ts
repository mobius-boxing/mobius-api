import { DbKey } from "./keys";
import { ownerOf, tablesOf } from "./ownership";

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
 * physical tables** carrying the trigger, reached by **75 `attachAudit` calls**
 * because `files` exists in both planes (same physical table today, and
 * `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` is idempotent).
 *
 * db-per-company T6 adds `db_servers`, `tenant_databases` and
 * `tenant_migration_runs` — all `core`, all audited, none excluded, none
 * fanned out: 84 application tables, 77 distinct audited tables, 78
 * `attachAudit` calls. `user_devices` (device approval, 2026-09-12) adds one
 * more `core` table, audited, none excluded, none fanned out. Removing the
 * parts tables leaves **83 application tables, 76 distinct audited tables,
 * 77 `attachAudit` calls.**
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
  // The hash is not the device secret, but it is still an offline
  // credential-matching value and costs nothing to strip (D-9).
  user_devices: ["tokenHash"],
  // 20260824000006; `headerName` is not a secret.
  nf_credentials: ["secretCiphertext", "secretIv", "secretTag"],
  // db-per-company T6, AC-35: same treatment, one packed bytea column each
  // instead of nf_credentials' three text columns (model D-33).
  db_servers: ["adminCredentialCiphertext"],
  tenant_databases: ["credentialCiphertext"],
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
  // A device approval is part of that user's history (I-11).
  user_devices: { parent: "users", fk: "userId" },
  // ── R-D (2026-09-01): six real parent/child pairs the handbook missed ─────
  // `warehouse_locations` is snake_case throughout, `warehouse_id` included.
  warehouse_locations: { parent: "warehouses", fk: "warehouse_id" },
  countdown_subcategories: { parent: "countdown_categories", fk: "categoryId" },
  sales_order_approval_events: { parent: "sales_orders", fk: "salesOrderId" },
  nf_documents: { parent: "nf_workflows", fk: "workflowId" },
  nf_runs: { parent: "nf_workflows", fk: "workflowId" },
  // corrugator-planning (T2): lines and runs belong to their plan; a lane
  // belongs to its run, two hops from the plan.
  corrugator_plan_orders: { parent: "corrugator_plans", fk: "planId" },
  corrugator_plan_combinations: { parent: "corrugator_plans", fk: "planId" },
  corrugator_plan_items: {
    parent: "corrugator_plan_combinations",
    fk: "combinationId",
    grand: "corrugator_plans",
    grandFk: "planId",
  },
};

/**
 * Every table `key`'s database must carry the audit trigger.
 *
 * Keyed from the start (Amendment 2026-09-01, constraint 2) even though both
 * planes resolve to one physical database today: the split later changes which
 * connection runs the attach, not this code. Counts today are
 * tenant 64 · core 13 (includes `user_devices`, device approval) = 77 calls
 * over 76 distinct tables (`files` appears in both planes).
 */
export const auditedTablesOf = (key: DbKey): string[] =>
  tablesOf(key).filter((table) => !AUDIT_EXCLUDED.has(table));

/**
 * The catalogue code that governs an audited table, or `null` when no
 * company route reaches it with a code at all (R-1).
 *
 * **Not** "the code the entity's `GET /` enforces" — the handbook's recipe.
 * Most routers gate only their **mutating** routes with `requirePermission`
 * and leave `GET` open to any authenticated user, so the value here is the
 * code the entity's routes enforce *anywhere*. `requireEntityHistoryAccess`
 * opens a `null` entry to `audit.read` only — no other fallback — and opens
 * a coded entry to `audit.read` OR that code (with its `.readonly` variant),
 * so history follows exactly where the entity itself is readable.
 *
 * Derived by reading every `src/routes/<entity>/<entity>.router.ts`: a code
 * that no router enforces would invent a gate (R-1 option (c)) and is never
 * used here. Child tables take their `AUDIT_PARENT` parent's code, because a
 * child is only ever written through the parent's routes.
 *
 * Every key is an audited table and every non-null value is a real code in
 * `PERMISSION_CONCEPTS`/`MOBIUS_ADDED_PERMISSIONS`; both are asserted by
 * `audit-coverage.schema.test.ts`.
 */
export const ENTITY_READ_PERMISSION: Record<string, string | null> = {
  app_config: "settings.edit",
  box_types: "box-types.edit",
  color_types: "color-types.edit",
  colors: "colors.edit",
  // ── No company route reaches these at all — every route is superAdmin-only
  //    (platform/ops entities) or, for `companies`' one non-superAdmin read,
  //    `authenticate` with no code ──────────────────────────────────────────
  companies: null,
  company_modules: null, // companies.router.ts's nested endpoints, superAdmin-only
  complements: "complements.edit",
  consumable_stock: "consumable-stock.edit",
  consumable_supplies: "consumable-supplies.edit",
  consumable_types: "consumable-types.edit",
  corrugation_classes: "corrugated.classes",
  corrugation_layers: "corrugated.edit", // child of `corrugations`
  corrugations: "corrugated.edit",
  corrugator_plans: "corrugator.plan",
  corrugator_plan_orders: "corrugator.plan", // child of `corrugator_plans`
  corrugator_plan_combinations: "corrugator.plan", // child of `corrugator_plans`
  corrugator_plan_items: "corrugator.plan", // child of `corrugator_plan_combinations`
  customer_categories: "customer-categories.edit",
  customers: "customers.edit",
  delivery_locations: "delivery-zones.edit",
  delivery_schedules: "customers.edit", // child of `customers`
  delivery_zones: "delivery-zones.edit",
  files: "files.manage", // the one admin-gated method (`GET /`, the list)
  finished_goods: "finished-goods.edit",
  flap_types: "flap-types.edit",
  flute_types: "flute-types.edit",
  fsc_types: "fsc-types.edit",
  glue_types: "glue-types.edit",
  invitations: "users.edit",
  manufacturers: "manufacturers.edit",
  modules: null, // modules.router.ts, superAdmin-only
  paper_class_papers: "paper.classes", // child of `paper_classes`
  paper_classes: "paper.classes",
  paper_sheets: "papers.edit",
  paper_stock: "paper-stock.edit",
  paper_supplies: "supplies.edit",
  paper_types: "paper-types.edit",
  product_types: "product-types.edit",
  sheet_stock: "sheet-stock.edit",
  strapping_types: "strapping-types.edit",
  suppliers: "suppliers.edit",
  tooling_stock: "tooling-stock.edit",
  tooling_types: "tooling-types.edit",
  toolings: "tooling.edit",
  trace_types: "score-types.edit",
  warehouse_locations: "warehouses.edit",
  warehouses: "warehouses.edit",
  // ── Countdown (`countdown.router.ts`): one code for the whole module ──────
  countdown_categories: "countdown.manage",
  countdown_document_assignments: "countdown.manage",
  countdown_documents: "countdown.manage",
  countdown_group_members: "countdown.manage",
  countdown_groups: "countdown.manage",
  countdown_subcategories: "countdown.manage",
  // ── node-files: `node-files.manage` is the module's only code, enforced on
  //    workflow deletion and on both credential writes. Documents and runs are
  //    reached only through `/workflows/:uuid/...`, so they take it too. ──────
  nf_credentials: "node-files.manage",
  nf_documents: "node-files.manage",
  nf_runs: "node-files.manage",
  nf_workflow_credentials: "node-files.manage",
  nf_workflows: "node-files.manage",
  // ── ERP entities whose routers do enforce a code ──────────────────────────
  machine_types: "machines.edit", // machine-type.router.ts, all three writes
  machines: "machines.edit",
  models: "models.edit",
  order_data: "orders.edit", // written by the sales-orders controller
  pallet_types: "palletizing.edit",
  palletizations: "palletizing.edit",
  permissions: "roles.edit", // permissions.router.ts:24, read-only allowed
  production_orders: "production-orders.edit", // `.generate` gates creation
  production_route_stage_machines: "routes.edit",
  production_route_stage_supplies: "routes.edit",
  production_route_stages: "routes.edit",
  production_routes: "routes.edit", // `routes.delete` gates deletion only
  // The base resource code, matching every other entity here — not the
  // narrower `products.approve.technical` (one PATCH) or `products.delete`
  // (DELETE only).
  products: "products.edit",
  role_permissions: "roles.edit", // child of `roles`
  roles: "roles.edit",
  sales_order_approval_events: "orders.edit", // child of `sales_orders`
  sales_orders: "orders.edit",
  // The parent's code, not the `devices.approve` its own router enforces (D-62):
  // a device row's history is read as part of the user's history.
  user_devices: "users.edit",
  users: "users.edit", // `PUT /roles/assign` is the one coded users write
  // ── db-per-company T6: platform-ops tables, superAdmin-only (D-46) ────────
  db_servers: null,
  tenant_databases: null,
  tenant_migration_runs: null,
};

/**
 * Audited tables whose ledger rows can never carry an `entityUuid`, so
 * `GET /audit-logs/history/<table>/:uuid` can never match one (R-5).
 *
 * The trigger fills `entityUuid` from the row's `uuid` column; these tables
 * have none, so their rows carry NULL. `paper_class_papers` and
 * `role_permissions` have neither `id` nor `uuid`; the other three have an `id`
 * but no `uuid`. All are reachable through their parent's history via
 * `rootUuid`, so T5 answers **400** naming the parent rather than an empty 200,
 * which would be indistinguishable from "nothing ever changed".
 *
 * `code_sequences` is in `AUDIT_EXCLUDED` (it carries no trigger at all) and is
 * listed for completeness: it is a live table with no `uuid`, and the schema
 * test's live half checks this set against `information_schema` in both
 * directions.
 *
 * Verified against the live schema 2026-09-02: these five are exactly the
 * application tables (`DOMAIN_OWNER` keys) with no `uuid` column.
 */
export const AUDIT_NO_UUID: ReadonlySet<string> = new Set([
  "code_sequences",
  "company_modules",
  "paper_class_papers",
  "production_route_stage_machines",
  "role_permissions",
]);

/**
 * Foreign-key column → the table it points at, so a diff can read
 * `customerId: "ACME" → "Beta"` instead of `customerId: 3 → 7` (R-4).
 *
 * Seeded from one introspection query against the live schema on 2026-09-02
 * (`information_schema.table_constraints` ⨝ `key_column_usage` ⨝
 * `constraint_column_usage`, `constraint_type='FOREIGN KEY'`, grouped by
 * column and target): **72 distinct (column, table) pairs over 70 distinct
 * column names**. The 68 unambiguous names are here, plus `user_devices`'
 * `approvedBy`/`revokedBy` (2026-09-12).
 *
 * Deliberately absent — one name, two targets, and a wrong label is worse than
 * no label (the presenter emits `resolved:false` for anything missing):
 * - `categoryId` → `countdown_categories` (countdown_documents,
 *   countdown_subcategories) **and** `customer_categories` (customers);
 * - `documentId` → `countdown_documents` (countdown_document_assignments,
 *   countdown_reminder_log) **and** `nf_documents` (nf_runs).
 *
 * Both spellings are listed where the schema has both: `warehouses.company_id`
 * and `warehouse_locations.warehouse_id` are snake_case while every other FK on
 * the same tables is camelCase.
 *
 * The `*Uuid` and `*By` columns resolve the same way but do not end in `Id`
 * with a numeric value, so today's presenter never asks for them; they are
 * included because they are real, unambiguous FKs and cost nothing.
 */
export const AUDIT_FK_TABLE: Record<string, string> = {
  approvedBy: "users",
  blueprintFileUuid: "files",
  boxTypeId: "box_types",
  colorId: "colors",
  colorTypeId: "color_types",
  companyId: "companies",
  company_id: "companies",
  complementId: "complements",
  consumableSupplyId: "consumable_supplies",
  consumableTypeId: "consumable_types",
  corrugationClassId: "corrugation_classes",
  corrugationId: "corrugations",
  credentialId: "nf_credentials",
  customerId: "customers",
  deliveryLocationId: "delivery_locations",
  deliveryZoneId: "delivery_zones",
  destinationWarehouseId: "warehouses",
  digestId: "countdown_reminder_digests",
  disabledBy: "users",
  enabledBy: "users",
  flapTypeId: "flap_types",
  fluteTypeId: "flute_types",
  fscTypeId: "fsc_types",
  glueTypeId: "glue_types",
  groupId: "countdown_groups",
  imageFileUuid: "files",
  invitedBy: "users",
  machineId: "machines",
  machineTypeId: "machine_types",
  managerId: "users",
  manufacturerId: "manufacturers",
  modelId: "models",
  moduleId: "modules",
  orderDataId: "order_data",
  palletTypeId: "pallet_types",
  palletizationId: "palletizations",
  paperClassId: "paper_classes",
  paperSheetId: "paper_sheets",
  paperSupplyId: "paper_supplies",
  paperTypeId: "paper_types",
  permissionId: "permissions",
  productId: "products",
  productTypeId: "product_types",
  productionRouteId: "production_routes",
  resolvedBy: "users",
  revokedBy: "users",
  roleId: "roles",
  routeId: "production_routes",
  runId: "nf_runs",
  salesOrderId: "sales_orders",
  salesPersonId: "users",
  salesUserId: "users",
  serverId: "db_servers",
  sketchFileUuid: "files",
  sourceWarehouseId: "warehouses",
  stageId: "production_route_stages",
  strappingTypeId: "strapping_types",
  subcategoryId: "countdown_subcategories",
  supplierId: "suppliers",
  technicalFileUuid: "files",
  technicalSheetFileUuid: "files",
  tenantDatabaseId: "tenant_databases",
  toolingId: "toolings",
  toolingTypeId: "tooling_types",
  traceTypeId: "trace_types",
  uploadedBy: "users",
  userId: "users",
  warehouseId: "warehouses",
  warehouseLocationId: "warehouse_locations",
  warehouse_id: "warehouses",
  workflowId: "nf_workflows",
};

/**
 * The database an audit read runs against (R-3, 2026-09-02).
 *
 * `?database=` is deliberately not shipped: both `DB_KEYS` resolve to one
 * physical database today, so the parameter provably cannot change a response
 * and would be accepted-and-ignored (L-007). `entityName` already determines
 * the database, so this is the single place a `DbKey` is chosen for a read.
 *
 * `undefined` (no `entityName` filter) and the fanned-out names (`files`,
 * `audit_logs`, for which `ownerOf` returns `undefined`) fall back to
 * `tenant`, whose ledger records every business table.
 *
 * When the planes separate, this function is where the cross-plane fan-out
 * lands: a list query with no `entityName` will have to read both ledgers and
 * merge, and it will do so here rather than in the DAO.
 */
export const auditDbFor = (entityName?: string): DbKey =>
  (entityName === undefined ? undefined : ownerOf(entityName)) ?? "tenant";
