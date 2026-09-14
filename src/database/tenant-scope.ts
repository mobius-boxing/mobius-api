import type { Knex } from "knex";
import { tablesOf } from "./ownership";
import { AUDIT_PARENT } from "./audit-coverage";

/**
 * `TENANT_SCOPE` — the per-company predicate `tenant:move` (T11) uses to copy
 * one company's rows out of a table that `tablesOf("tenant")` lists (db-per-
 * company model C2 step 3, brief AC-66).
 *
 * Four shapes, verified against the live `traffic_production` schema on
 * 2026-09-14 (`information_schema.columns`/`.key_column_usage`):
 *
 * - `direct` — the table has its own `companyId`/`company_id` column.
 * - `warehouse` — no company column, but an FK to `warehouses` (itself
 *   `direct`, `company_id`): the four stock tables plus `warehouse_locations`.
 * - `parent` — no company column and no warehouse FK; reuses `AUDIT_PARENT`'s
 *   `parent`/`fk`(/`grand`/`grandFk`) map, exactly as the model specifies,
 *   for the nine child tables whose parent (or grandparent) is itself
 *   `direct`. `countdown_reminder_log` is the one exception: it has no
 *   `AUDIT_PARENT` entry (it is audit-excluded, not audit-parented), so its
 *   `parent`/`fk` pair is declared here instead, pointing at its own
 *   `documentId` → `countdown_documents` FK.
 * - `files` — `files` is central AND fanned out to tenant (`ownership.ts`
 *   `EXTRA_COPIES`); a company's own logo, referenced by
 *   `companies.branding->>'logoFileUuid'`, stays central (brief AC-68) even
 *   though its `companyId` matches, so this predicate excludes it.
 * - `empty` — `countdown_reminder_runs` carries no company linkage at all
 *   (`id, uuid, runDate, sent, failed, skipped, createdAt, updatedAt`): it is
 *   one global claim row per calendar day, not business data. T11/D-1 (below)
 *   copies nothing for it; the moved tenant's own next job tick writes its
 *   own claim row.
 *
 * `tenantScopeWhere` turns an entry into the `WHERE` fragment `tenant-move.ts`
 * appends to its per-table `SELECT` (model C2 step 3, D-52).
 */

export type TenantScopeEntry =
  | { readonly kind: "direct"; readonly column: string }
  | { readonly kind: "warehouse"; readonly column: string }
  | {
      readonly kind: "parent";
      readonly fk: string;
      readonly parent: string;
      readonly grandFk?: string;
      readonly grand?: string;
    }
  | { readonly kind: "files" }
  | { readonly kind: "empty"; readonly reason: string };

const auditParentEntry = (table: string): TenantScopeEntry => {
  const parent = AUDIT_PARENT[table];
  if (!parent) {
    throw new Error(`tenant-scope: no AUDIT_PARENT entry for "${table}"`);
  }
  return { kind: "parent", ...parent };
};

export const TENANT_SCOPE: Readonly<Record<string, TenantScopeEntry>> = {
  // ── direct: the table's own companyId/company_id (54) ─────────────────────
  app_config: { kind: "direct", column: "companyId" },
  audit_logs: { kind: "direct", column: "companyId" },
  box_types: { kind: "direct", column: "companyId" },
  code_sequences: { kind: "direct", column: "companyId" },
  color_types: { kind: "direct", column: "companyId" },
  colors: { kind: "direct", column: "companyId" },
  complements: { kind: "direct", column: "companyId" },
  consumable_supplies: { kind: "direct", column: "companyId" },
  consumable_types: { kind: "direct", column: "companyId" },
  corrugation_classes: { kind: "direct", column: "companyId" },
  corrugations: { kind: "direct", column: "companyId" },
  countdown_categories: { kind: "direct", column: "companyId" },
  countdown_documents: { kind: "direct", column: "companyId" },
  countdown_groups: { kind: "direct", column: "companyId" },
  countdown_reminder_digests: { kind: "direct", column: "companyId" },
  customer_categories: { kind: "direct", column: "companyId" },
  customers: { kind: "direct", column: "companyId" },
  delivery_locations: { kind: "direct", column: "companyId" },
  // Also has an AUDIT_PARENT entry (customers/customerId) for ledger rootEntity
  // purposes; its own companyId column is what scopes the row.
  delivery_schedules: { kind: "direct", column: "companyId" },
  delivery_zones: { kind: "direct", column: "companyId" },
  finished_goods: { kind: "direct", column: "companyId" },
  flap_types: { kind: "direct", column: "companyId" },
  flute_types: { kind: "direct", column: "companyId" },
  fsc_types: { kind: "direct", column: "companyId" },
  glue_types: { kind: "direct", column: "companyId" },
  machine_types: { kind: "direct", column: "companyId" },
  machines: { kind: "direct", column: "companyId" },
  manufacturers: { kind: "direct", column: "companyId" },
  models: { kind: "direct", column: "companyId" },
  nf_credentials: { kind: "direct", column: "companyId" },
  nf_documents: { kind: "direct", column: "companyId" },
  nf_node_runs: { kind: "direct", column: "companyId" },
  nf_runs: { kind: "direct", column: "companyId" },
  nf_workflow_credentials: { kind: "direct", column: "companyId" },
  nf_workflows: { kind: "direct", column: "companyId" },
  order_data: { kind: "direct", column: "companyId" },
  pallet_types: { kind: "direct", column: "companyId" },
  palletizations: { kind: "direct", column: "companyId" },
  paper_classes: { kind: "direct", column: "companyId" },
  paper_sheets: { kind: "direct", column: "companyId" },
  paper_supplies: { kind: "direct", column: "companyId" },
  paper_types: { kind: "direct", column: "companyId" },
  parts: { kind: "direct", column: "companyId" },
  product_types: { kind: "direct", column: "companyId" },
  production_orders: { kind: "direct", column: "companyId" },
  production_routes: { kind: "direct", column: "companyId" },
  products: { kind: "direct", column: "companyId" },
  sales_orders: { kind: "direct", column: "companyId" },
  strapping_types: { kind: "direct", column: "companyId" },
  suppliers: { kind: "direct", column: "companyId" },
  tooling_types: { kind: "direct", column: "companyId" },
  toolings: { kind: "direct", column: "companyId" },
  trace_types: { kind: "direct", column: "companyId" },
  warehouses: { kind: "direct", column: "company_id" },

  // ── files: direct companyId, minus the company's own logo (1) ─────────────
  files: { kind: "files" },

  // ── warehouse: no company column, FK to warehouses (5) ─────────────────────
  consumable_stock: { kind: "warehouse", column: "warehouseId" },
  paper_stock: { kind: "warehouse", column: "warehouseId" },
  sheet_stock: { kind: "warehouse", column: "warehouseId" },
  tooling_stock: { kind: "warehouse", column: "warehouseId" },
  warehouse_locations: { kind: "warehouse", column: "warehouse_id" },

  // ── parent: AUDIT_PARENT's map reused verbatim (10) ────────────────────────
  corrugation_layers: auditParentEntry("corrugation_layers"),
  paper_class_papers: auditParentEntry("paper_class_papers"),
  countdown_group_members: auditParentEntry("countdown_group_members"),
  countdown_document_assignments: auditParentEntry(
    "countdown_document_assignments",
  ),
  countdown_subcategories: auditParentEntry("countdown_subcategories"),
  part_approval_events: auditParentEntry("part_approval_events"),
  sales_order_approval_events: auditParentEntry("sales_order_approval_events"),
  production_route_stages: auditParentEntry("production_route_stages"),
  production_route_stage_machines: auditParentEntry(
    "production_route_stage_machines",
  ),
  production_route_stage_supplies: auditParentEntry(
    "production_route_stage_supplies",
  ),
  // Not in AUDIT_PARENT (audit-excluded, not audit-parented): its own FK.
  countdown_reminder_log: {
    kind: "parent",
    fk: "documentId",
    parent: "countdown_documents",
  },

  // ── empty: no company linkage at all (1) — T11/D-1 ─────────────────────────
  countdown_reminder_runs: {
    kind: "empty",
    reason:
      "a global daily job-claim row with no company column; the moved " +
      "tenant's own reminder job writes a fresh one on its next tick",
  },
} as const;

/** AC-66: every `tablesOf("tenant")` name has exactly one entry, and vice versa. */
export const TENANT_SCOPE_TABLES: readonly string[] = tablesOf("tenant");

export type TenantScopePredicate = { sql: string; bindings: unknown[] };

/**
 * `WHERE <predicate>` for `table`, aliased `t`, restricted to `companyId`
 * (model C2 step 3). `??`/`?` are knex's identifier/value placeholders —
 * callers pass this straight to `knex.raw`/`.whereRaw`.
 */
export function tenantScopeWhere(
  table: string,
  companyId: number,
): TenantScopePredicate {
  const entry = TENANT_SCOPE[table];
  if (!entry) {
    throw new Error(`tenant-scope: "${table}" is not in TENANT_SCOPE`);
  }
  switch (entry.kind) {
    case "direct":
      return { sql: "t.?? = ?", bindings: [entry.column, companyId] };
    case "warehouse":
      return {
        sql: "exists (select 1 from ?? w where w.id = t.?? and w.?? = ?)",
        bindings: ["warehouses", entry.column, "company_id", companyId],
      };
    case "parent": {
      if (entry.grand && entry.grandFk) {
        return {
          sql:
            "exists (select 1 from ?? p join ?? g on g.id = p.?? " +
            "where p.id = t.?? and g.?? = ?)",
          bindings: [
            entry.parent,
            entry.grand,
            entry.grandFk,
            entry.fk,
            "companyId",
            companyId,
          ],
        };
      }
      return {
        sql: "exists (select 1 from ?? p where p.id = t.?? and p.?? = ?)",
        bindings: [entry.parent, entry.fk, "companyId", companyId],
      };
    }
    case "files":
      return {
        sql: "t.?? = ? and not exists (select 1 from ?? c where c.branding ->> ? = t.uuid::text)",
        bindings: ["companyId", companyId, "companies", "logoFileUuid"],
      };
    case "empty":
      return { sql: "false", bindings: [] };
  }
}

/** A short, human-readable description for `--dry-run` output (AC-67). */
export function describeTenantScope(table: string): string {
  const entry = TENANT_SCOPE[table];
  if (!entry) return `${table}: (no TENANT_SCOPE entry)`;
  switch (entry.kind) {
    case "direct":
      return `${table}.${entry.column} = <companyId>`;
    case "warehouse":
      return `${table}.${entry.column} -> warehouses.company_id = <companyId>`;
    case "parent":
      return entry.grand && entry.grandFk
        ? `${table}.${entry.fk} -> ${entry.parent}.${entry.grandFk} -> ${entry.grand}.companyId = <companyId>`
        : `${table}.${entry.fk} -> ${entry.parent}.companyId = <companyId>`;
    case "files":
      return `${table}.companyId = <companyId>, excluding companies.branding.logoFileUuid`;
    case "empty":
      return `${table}: never copied (${entry.reason})`;
  }
}

export type ForeignKeyEdge = {
  readonly child: string;
  readonly parent: string;
};

/**
 * Kahn's algorithm restricted to `tables`, parents before children — the FK-
 * topological order `tenant:move` copies in (model C2 step 3, brief AC-67).
 * Ties break alphabetically for a deterministic `--dry-run` printout. Throws
 * if `edges` (real FKs among `tables`, from `pg_constraint`) contain a cycle,
 * which the schema does not have today.
 */
export function topologicalOrder(
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[],
): string[] {
  const inSet = new Set(tables);
  const dependsOn = new Map<string, Set<string>>(
    tables.map((t) => [t, new Set<string>()]),
  );
  for (const edge of edges) {
    if (!inSet.has(edge.child) || !inSet.has(edge.parent)) continue;
    if (edge.child === edge.parent) continue;
    dependsOn.get(edge.child)?.add(edge.parent);
  }

  const done = new Set<string>();
  const order: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((t) => [...(dependsOn.get(t) ?? [])].every((p) => done.has(p)))
      .sort((a, b) => a.localeCompare(b));
    if (ready.length === 0) {
      throw new Error(
        `tenant-scope: FK cycle among [${[...remaining].sort().join(", ")}]`,
      );
    }
    for (const table of ready) {
      order.push(table);
      done.add(table);
      remaining.delete(table);
    }
  }
  return order;
}

/**
 * `edges` for `topologicalOrder`, from the live schema (`pg_constraint`),
 * restricted to single-column FKs between two `tables` names. Multi-column
 * FKs are ignored here — none exist among the tenant tables' own inter-table
 * references (only `production_route_stage_{machines,supplies}`' composite
 * keys are multi-column, and neither is a tenant-to-tenant FK by table name
 * collision).
 */
export async function loadTenantForeignKeyEdges(
  knex: Knex,
  tables: readonly string[],
): Promise<ForeignKeyEdge[]> {
  const rows = (await knex.raw(
    `select child.relname::text as child, parent.relname::text as parent
       from pg_constraint c
       join pg_class child on child.oid = c.conrelid
       join pg_class parent on parent.oid = c.confrelid
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and c.conparentid = 0
        and child.relname = any(?)
        and parent.relname = any(?)`,
    [[...tables], [...tables]],
  )) as { rows: ForeignKeyEdge[] };
  return rows.rows;
}
