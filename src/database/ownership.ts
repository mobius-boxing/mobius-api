import { DbKey } from "./keys";

/**
 * Which database owns which table — the single source of truth (AC-1).
 *
 * Two layers, because two different questions are being asked (plan R-1):
 *
 * - `DOMAIN_OWNER` is the *pre-fan-out name set*: the 81 application tables of
 *   the end state (74 measured in production 2026-08-13 + the pending
 *   `countdown_reminder_digests` + `models` (module 08) + `order_data`,
 *   `sales_orders` and `sales_order_approval_events` (module 18 sub-area D) +
 *   `production_orders` (module 13), minus the 5 store tables deleted with the
 *   store module on 2026-08-24, plus the 6 `nf_*` tables of node-files Phases 1 and 2),
 *   each mapped to the database that owns its original row set. This is what
 *   AC-1(c)/(d) counts.
 * - `TABLE_OWNER` is keyed `(database, table)` and additionally carries the
 *   per-database *copies* of the two table names that deliberately live in more
 *   than one database — `files` (G-2) and `audit_logs` (D-2). That fan-out is
 *   what AC-2 asserts, and it is why the manifest cannot be keyed by table name
 *   alone.
 *
 * Nothing here renames anything. The countdown tables keep their `countdown_`
 * prefix until the D-4 renames land with the countdown cutover.
 */
export const DOMAIN_OWNER: Record<string, DbKey> = {
  // ── core (10) — identity, tenancy, the module catalogue and RBAC ──────────
  users: "core",
  companies: "core",
  invitations: "core",
  emailTokens: "core",
  modules: "core",
  company_modules: "core",
  roles: "core",
  permissions: "core",
  role_permissions: "core",
  // Company-level assets (logos today). The ERP and countdown copies are in
  // EXTRA_COPIES below; the rows are partitioned at the core cutover.
  files: "core",

  // ── countdown (9) — the 8 tables of 20260812000001 + the digests table ────
  countdown_categories: "countdown",
  countdown_subcategories: "countdown",
  countdown_documents: "countdown",
  countdown_document_assignments: "countdown",
  countdown_groups: "countdown",
  countdown_group_members: "countdown",
  countdown_reminder_log: "countdown",
  countdown_reminder_runs: "countdown",
  countdown_reminder_digests: "countdown",

  // ── nodefiles (6) — extraction (Phase 1) + the engine (Phase 2) ──────────
  // The key has no hyphen (it becomes a database name); the module slug, route
  // path and permission code all do. See `keys.ts`.
  nf_workflows: "nodefiles",
  nf_documents: "nodefiles",
  nf_runs: "nodefiles",
  nf_node_runs: "nodefiles",
  nf_credentials: "nodefiles",
  nf_workflow_credentials: "nodefiles",

  // ── erp (56) — the ERP domain, plus code_sequences / app_config (D-3) ─────
  app_config: "erp",
  audit_logs: "erp",
  box_types: "erp",
  code_sequences: "erp",
  color_types: "erp",
  colors: "erp",
  complements: "erp",
  consumable_stock: "erp",
  consumable_supplies: "erp",
  consumable_types: "erp",
  corrugation_classes: "erp",
  corrugation_layers: "erp",
  corrugations: "erp",
  customer_categories: "erp",
  customers: "erp",
  delivery_locations: "erp",
  delivery_schedules: "erp",
  delivery_zones: "erp",
  finished_goods: "erp",
  flap_types: "erp",
  flute_types: "erp",
  fsc_types: "erp",
  glue_types: "erp",
  machine_types: "erp",
  machines: "erp",
  manufacturers: "erp",
  models: "erp",
  order_data: "erp",
  pallet_types: "erp",
  palletizations: "erp",
  paper_class_papers: "erp",
  paper_classes: "erp",
  paper_sheets: "erp",
  paper_stock: "erp",
  paper_supplies: "erp",
  paper_types: "erp",
  part_approval_events: "erp",
  parts: "erp",
  product_types: "erp",
  production_orders: "erp",
  production_route_stage_machines: "erp",
  production_route_stage_supplies: "erp",
  production_route_stages: "erp",
  production_routes: "erp",
  products: "erp",
  sales_order_approval_events: "erp",
  sales_orders: "erp",
  sheet_stock: "erp",
  strapping_types: "erp",
  suppliers: "erp",
  tooling_stock: "erp",
  tooling_types: "erp",
  toolings: "erp",
  trace_types: "erp",
  warehouse_locations: "erp",
  warehouses: "erp",
};

/**
 * The additional databases that hold their own copy of a table name already
 * present in `DOMAIN_OWNER` (AC-2).
 *
 * - `files` — a per-module attachment store for `erp` (product blueprints,
 *   sketches, technical sheets) and `countdown` (Q-1: created with the split,
 *   no endpoint behind it yet), alongside the core company-asset table.
 * - `audit_logs` — one per database (D-2): the audit write is fire-and-forget,
 *   never runs inside a transaction and has no inbound FKs, so per-module
 *   costs nothing in atomicity.
 */
const EXTRA_COPIES: Record<string, readonly DbKey[]> = {
  files: ["erp", "countdown"],
  audit_logs: ["core", "countdown"],
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

/** Keyed `${database}.${table}` (AC-2). Every value is the key in its own name. */
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
 * The one database that owns `table`, or `undefined` when the answer depends on
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

/** Every table name a database holds, fan-out copies included. */
export function tablesOf(key: DbKey): string[] {
  return Object.keys(TABLE_OWNER)
    .filter((entry) => entry.startsWith(`${key}.`))
    .map((entry) => entry.slice(key.length + 1));
}
