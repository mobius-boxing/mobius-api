import type { Knex } from "knex";

/**
 * C3 of the db-per-company cutover: every company now lives in its own
 * `tenant_*` database, so the central copies of the business tables are
 * renamed out of the way (`zz_old_<name>`) and dropped later by
 * `drop_zz_old_tables`.
 *
 * Frozen from `tablesOf("tenant")` on 2026-09-15 — core migrations never import
 * the live registry (T6/D-orch-1). `files` and `audit_logs` are left out: core
 * owns them too (`EXTRA_COPIES`), holding the company logos and the central
 * audit ledger that core's own triggers write to (C3/D-1).
 */
const PARKED_TABLES = [
  "countdown_categories",
  "countdown_subcategories",
  "countdown_documents",
  "countdown_document_assignments",
  "countdown_groups",
  "countdown_group_members",
  "countdown_reminder_log",
  "countdown_reminder_runs",
  "countdown_reminder_digests",
  "nf_workflows",
  "nf_documents",
  "nf_runs",
  "nf_node_runs",
  "nf_credentials",
  "nf_workflow_credentials",
  "app_config",
  "box_types",
  "code_sequences",
  "color_types",
  "colors",
  "complements",
  "consumable_stock",
  "consumable_supplies",
  "consumable_types",
  "corrugation_classes",
  "corrugation_layers",
  "corrugations",
  "customer_categories",
  "customers",
  "delivery_locations",
  "delivery_schedules",
  "delivery_zones",
  "finished_goods",
  "flap_types",
  "flute_types",
  "fsc_types",
  "glue_types",
  "machine_types",
  "machines",
  "manufacturers",
  "models",
  "order_data",
  "pallet_types",
  "palletizations",
  "paper_class_papers",
  "paper_classes",
  "paper_sheets",
  "paper_stock",
  "paper_supplies",
  "paper_types",
  "part_approval_events",
  "parts",
  "product_types",
  "production_orders",
  "production_route_stage_machines",
  "production_route_stage_supplies",
  "production_route_stages",
  "production_routes",
  "products",
  "sales_order_approval_events",
  "sales_orders",
  "sheet_stock",
  "strapping_types",
  "suppliers",
  "tooling_stock",
  "tooling_types",
  "toolings",
  "trace_types",
  "warehouse_locations",
  "warehouses",
];

/**
 * A committed migration runs wherever core is migrated: local databases still
 * on the shared target, and scratch bootstraps with an empty registry, whose
 * business tables are live. Parking applies only when at least one company is
 * registered and every live registration is a dedicated `tenant_*` database
 * (C3/D-2).
 */
async function everyLiveTenantIsDedicated(knex: Knex): Promise<boolean> {
  const live: { databaseName: string }[] = await knex("tenant_databases")
    .whereNot("status", "retired")
    .select("databaseName");
  return (
    live.length > 0 &&
    live.every((row) => row.databaseName.startsWith("tenant_"))
  );
}

export async function up(knex: Knex): Promise<void> {
  if (!(await everyLiveTenantIsDedicated(knex))) {
    console.log(
      "park_tenant_tables: skipped — a company is still served from this database, or none is registered",
    );
    return;
  }
  for (const table of PARKED_TABLES) {
    await knex.raw("ALTER TABLE ?? RENAME TO ??", [table, `zz_old_${table}`]);
  }
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
