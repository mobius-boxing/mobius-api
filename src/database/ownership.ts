import { DbKey } from "./keys";

/**
 * Which plane owns which table — the single source of truth (AC-1).
 *
 * Two layers, because two different questions are being asked (plan R-1):
 *
 * - `DOMAIN_OWNER` is the *pre-fan-out name set*: the 81 application tables,
 *   each mapped to the plane that owns its original row set — 11 central, 70
 *   tenant (db-per-company D-3). The two names that exist in both planes
 *   (`files`, `audit_logs`) are listed under `core` here and under `tenant` in
 *   `EXTRA_COPIES`, so each plane holds 11 and 72 names respectively.
 * - `TABLE_OWNER` is keyed `(plane, table)` and additionally carries those
 *   per-plane *copies*. That fan-out is what AC-2 asserts, and it is why the
 *   manifest cannot be keyed by table name alone.
 *
 * Nothing here renames anything. The countdown tables keep their `countdown_`
 * prefix (the module split's D-4 renames are moot, model D-1).
 */
export const DOMAIN_OWNER: Record<string, DbKey> = {
  // ── core (14) — identity, tenancy, the module catalogue, RBAC and the ─────
  //    tenant registry (db-per-company T6, model D-7) ────────────────────────
  users: "core",
  companies: "core",
  invitations: "core",
  emailTokens: "core",
  modules: "core",
  company_modules: "core",
  roles: "core",
  permissions: "core",
  role_permissions: "core",
  // Company-level assets (logos today) and the central ledger. Their tenant
  // copies are in EXTRA_COPIES below; the rows are partitioned at cutover.
  files: "core",
  audit_logs: "core",
  // Where a tenant's database lives and what happened to it (T6): never a
  // tenant table, so no `EXTRA_COPIES`/`TABLE_MODULE` entry either.
  db_servers: "core",
  tenant_databases: "core",
  tenant_migration_runs: "core",

  // ── tenant: countdown (9) — the 8 tables of 20260812000001 + digests ──────
  countdown_categories: "tenant",
  countdown_subcategories: "tenant",
  countdown_documents: "tenant",
  countdown_document_assignments: "tenant",
  countdown_groups: "tenant",
  countdown_group_members: "tenant",
  countdown_reminder_log: "tenant",
  countdown_reminder_runs: "tenant",
  countdown_reminder_digests: "tenant",

  // ── tenant: node-files (6) — extraction (Phase 1) + the engine (Phase 2) ──
  nf_workflows: "tenant",
  nf_documents: "tenant",
  nf_runs: "tenant",
  nf_node_runs: "tenant",
  nf_credentials: "tenant",
  nf_workflow_credentials: "tenant",

  // ── tenant: ERP (55) — the ERP domain, plus code_sequences / app_config ───
  app_config: "tenant",
  box_types: "tenant",
  code_sequences: "tenant",
  color_types: "tenant",
  colors: "tenant",
  complements: "tenant",
  consumable_stock: "tenant",
  consumable_supplies: "tenant",
  consumable_types: "tenant",
  corrugation_classes: "tenant",
  corrugation_layers: "tenant",
  corrugations: "tenant",
  customer_categories: "tenant",
  customers: "tenant",
  delivery_locations: "tenant",
  delivery_schedules: "tenant",
  delivery_zones: "tenant",
  finished_goods: "tenant",
  flap_types: "tenant",
  flute_types: "tenant",
  fsc_types: "tenant",
  glue_types: "tenant",
  machine_types: "tenant",
  machines: "tenant",
  manufacturers: "tenant",
  models: "tenant",
  order_data: "tenant",
  pallet_types: "tenant",
  palletizations: "tenant",
  paper_class_papers: "tenant",
  paper_classes: "tenant",
  paper_sheets: "tenant",
  paper_stock: "tenant",
  paper_supplies: "tenant",
  paper_types: "tenant",
  part_approval_events: "tenant",
  parts: "tenant",
  product_types: "tenant",
  production_orders: "tenant",
  production_route_stage_machines: "tenant",
  production_route_stage_supplies: "tenant",
  production_route_stages: "tenant",
  production_routes: "tenant",
  products: "tenant",
  sales_order_approval_events: "tenant",
  sales_orders: "tenant",
  sheet_stock: "tenant",
  strapping_types: "tenant",
  suppliers: "tenant",
  tooling_stock: "tenant",
  tooling_types: "tenant",
  toolings: "tenant",
  trace_types: "tenant",
  warehouse_locations: "tenant",
  warehouses: "tenant",
};

/**
 * The additional plane that holds its own copy of a name already present in
 * `DOMAIN_OWNER` (AC-2, model D-5 / D-6).
 *
 * - `files` — central company assets (logos) in `core`; product, palletization
 *   and node-files attachments in each tenant.
 * - `audit_logs` — one ledger per database: the trigger writes locally and
 *   cannot cross databases.
 */
export const EXTRA_COPIES: Record<string, readonly DbKey[]> = {
  files: ["tenant"],
  audit_logs: ["tenant"],
};

/**
 * Module membership of every tenant table, by catalogue slug (model D-3): what
 * the connection keys `erp` / `countdown` / `nodefiles` used to say, kept as
 * metadata for purge hooks, module manifests and per-module backup filters.
 * The shared names (`files`, `audit_logs`) belong to `core`, the always-on
 * module, because every module's rows reach them.
 */
export const TABLE_MODULE: Record<string, "core" | "countdown" | "node-files"> =
  {
    files: "core",
    audit_logs: "core",
    countdown_categories: "countdown",
    countdown_subcategories: "countdown",
    countdown_documents: "countdown",
    countdown_document_assignments: "countdown",
    countdown_groups: "countdown",
    countdown_group_members: "countdown",
    countdown_reminder_log: "countdown",
    countdown_reminder_runs: "countdown",
    countdown_reminder_digests: "countdown",
    nf_workflows: "node-files",
    nf_documents: "node-files",
    nf_runs: "node-files",
    nf_node_runs: "node-files",
    nf_credentials: "node-files",
    nf_workflow_credentials: "node-files",
    app_config: "core",
    box_types: "core",
    code_sequences: "core",
    color_types: "core",
    colors: "core",
    complements: "core",
    consumable_stock: "core",
    consumable_supplies: "core",
    consumable_types: "core",
    corrugation_classes: "core",
    corrugation_layers: "core",
    corrugations: "core",
    customer_categories: "core",
    customers: "core",
    delivery_locations: "core",
    delivery_schedules: "core",
    delivery_zones: "core",
    finished_goods: "core",
    flap_types: "core",
    flute_types: "core",
    fsc_types: "core",
    glue_types: "core",
    machine_types: "core",
    machines: "core",
    manufacturers: "core",
    models: "core",
    order_data: "core",
    pallet_types: "core",
    palletizations: "core",
    paper_class_papers: "core",
    paper_classes: "core",
    paper_sheets: "core",
    paper_stock: "core",
    paper_supplies: "core",
    paper_types: "core",
    part_approval_events: "core",
    parts: "core",
    product_types: "core",
    production_orders: "core",
    production_route_stage_machines: "core",
    production_route_stage_supplies: "core",
    production_route_stages: "core",
    production_routes: "core",
    products: "core",
    sales_order_approval_events: "core",
    sales_orders: "core",
    sheet_stock: "core",
    strapping_types: "core",
    suppliers: "core",
    tooling_stock: "core",
    tooling_types: "core",
    toolings: "core",
    trace_types: "core",
    warehouse_locations: "core",
    warehouses: "core",
  };

const buildTableOwner = (): Record<`${DbKey}.${string}`, DbKey> => {
  const owners = {} as Record<`${DbKey}.${string}`, DbKey>;
  for (const [table, owner] of Object.entries(DOMAIN_OWNER)) {
    owners[`${owner}.${table}`] = owner;
  }
  for (const [table, keys] of Object.entries(EXTRA_COPIES)) {
    for (const key of keys) owners[`${key}.${table}`] = key;
  }
  return owners;
};

/** Keyed `${plane}.${table}` (AC-2). Every value is the key in its own name. */
export const TABLE_OWNER: Record<`${DbKey}.${string}`, DbKey> =
  buildTableOwner();

const OWNERS_BY_TABLE = ((): Map<string, Set<DbKey>> => {
  const index = new Map<string, Set<DbKey>>();
  for (const entry of Object.keys(TABLE_OWNER)) {
    const separator = entry.indexOf(".");
    const key = entry.slice(0, separator) as DbKey;
    const table = entry.slice(separator + 1);
    const keys = index.get(table) ?? new Set<DbKey>();
    keys.add(key);
    index.set(table, keys);
  }
  return index;
})();

/**
 * The one plane that owns `table`, or `undefined` when the answer depends on
 * the caller: an unknown table, or one of the fanned-out names (`files`,
 * `audit_logs`), which resolve to whichever key the caller asked for.
 *
 * This is what the registry's wrong-database guard consults, so `undefined`
 * deliberately means "do not object".
 */
export function ownerOf(table: string): DbKey | undefined {
  const keys = OWNERS_BY_TABLE.get(table);
  if (!keys || keys.size !== 1) return undefined;
  return keys.values().next().value;
}

/** Every table name a plane holds, fan-out copies included. */
export function tablesOf(key: DbKey): string[] {
  return Object.keys(TABLE_OWNER)
    .filter((entry) => entry.startsWith(`${key}.`))
    .map((entry) => entry.slice(key.length + 1));
}
