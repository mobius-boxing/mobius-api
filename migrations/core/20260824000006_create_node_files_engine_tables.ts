import type { Knex } from "knex";

/**
 * node-files Phase 2 — the workflow engine.
 *
 * Three new tables plus the one column Phase 1 left for this phase:
 * `nf_workflows.definition`, the node graph the executor walks. Phase 1 shipped
 * `fields` only, because a workflow that stops after extraction has no graph.
 *
 * Conventions are inherited verbatim from `20260824000002` and are not
 * negotiable: `increments("id")` + a `uuid` defaulting to `gen_random_uuid()`,
 * `companyId` a plain indexed integer with **no `references()`** (companies live
 * behind the `core` key and no FK may cross a key boundary), in-key FKs
 * explicit about their delete behaviour, `jsonb` for document-shaped data,
 * timestamptz, no CHECK constraints, partial indexes as raw SQL, and a `down()`
 * that drops children before parents.
 *
 * Deletion strategy, stated once per entity (L-006):
 *  - `nf_node_runs.runId` CASCADEs. A node run is not history of its own: it is
 *    detail *of* a run, meaningless once the run is gone, and `nf_runs` already
 *    RESTRICTs from `nf_workflows` so the history it belongs to cannot vanish
 *    by accident.
 *  - `nf_workflow_credentials` CASCADEs from BOTH sides — it is a pure join.
 *    The interesting case is the credential: deleting one that a workflow still
 *    references would silently break that workflow's HTTP nodes, so the service
 *    refuses the delete with a 409 naming how many workflows use it, exactly as
 *    workflow deletion refuses when runs exist. The cascade is the backstop for
 *    the workflow side, where deletion is already allowed.
 *  - `nf_credentials` rows are never deleted by a workflow's deletion; only the
 *    join rows are.
 *
 * On the secret columns: AES-256-GCM, key from `NF_SECRET_KEY`, stored as three
 * separate text columns (ciphertext, iv, tag) rather than one packed string, so
 * a future key rotation can be written as SQL that reads them independently.
 * Nothing here is ever returned by an endpoint — see `nf-credential.dao.ts`,
 * whose mapper has no branch that could leak one.
 */
export async function up(knex: Knex): Promise<void> {
  // The node graph: { nodes: [{ id, type, config, position }], edges: [...] }.
  // Nullable rather than defaulted to '{}': a Phase 1 workflow genuinely has no
  // graph, and "null" says that better than an empty object that the validator
  // would then have to special-case.
  await knex.schema.alterTable("nf_workflows", (table) => {
    table.jsonb("definition");
  });

  await knex.schema.createTable("nf_credentials", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.integer("companyId").notNullable();
    table.string("name", 120).notNullable();
    // `bearer` → Authorization: Bearer <secret>; `header` → <headerName>: <secret>.
    table.string("type", 20).notNullable();
    // Only meaningful for `header`; the header NAME is not a secret.
    table.string("headerName", 100);
    table.text("secretCiphertext").notNullable();
    table.text("secretIv").notNullable();
    table.text("secretTag").notNullable();
    table.timestamp("lastUsedAt", { useTz: true });
    table.integer("createdByUserId");
    // Denormalized: no DAO here may join `users` (another key).
    table.text("createdByName");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"], {
      indexName: "nf_credentials_company_name_unique",
    });
    table.index(["companyId"]);
  });

  await knex.schema.createTable("nf_workflow_credentials", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("workflowId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("nf_workflows")
      .onDelete("CASCADE");
    table
      .integer("credentialId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("nf_credentials")
      .onDelete("CASCADE");
    table.integer("companyId").notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    // The pair is the row: saving a definition twice must not duplicate it.
    table.unique(["workflowId", "credentialId"], {
      indexName: "nf_workflow_credentials_pair_unique",
    });
    table.index(["credentialId"]);
    table.index(["companyId"]);
  });

  await knex.schema.createTable("nf_node_runs", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("runId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("nf_runs")
      .onDelete("CASCADE");
    table.integer("companyId").notNullable();
    // The id INSIDE the definition's json, not a row id — a node that is later
    // deleted from the graph keeps its history readable.
    table.string("nodeId", 64).notNullable();
    table.string("nodeType", 40).notNullable();
    // succeeded | failed | skipped. Written once, at the end of the node.
    table.string("status", 20).notNullable();
    table.jsonb("input");
    table.jsonb("output");
    table.text("logs");
    table.text("error");
    table.integer("durationMs");
    table.integer("attempt").notNullable().defaultTo(1);
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["runId"]);
    table.index(["companyId"]);
  });

  // The run detail page reads a run's node runs in execution order and nothing
  // else ever scans this table; the index carries the sort so the page never
  // sorts in memory.
  await knex.raw(
    `CREATE INDEX nf_node_runs_run_order_idx ON nf_node_runs ("runId", id)`,
  );

  // The executor claims runs that are `running` and unlocked — the review
  // hand-off leaves exactly that. Partial for the same reason the queued index
  // is: these rows are a handful next to the history they sit in.
  await knex.raw(
    `CREATE INDEX nf_runs_runnable_idx ON nf_runs (id) WHERE status = 'running' AND "lockedBy" IS NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS nf_runs_runnable_idx`);
  await knex.schema.dropTableIfExists("nf_node_runs");
  await knex.schema.dropTableIfExists("nf_workflow_credentials");
  await knex.schema.dropTableIfExists("nf_credentials");
  await knex.schema.alterTable("nf_workflows", (table) => {
    table.dropColumn("definition");
  });
}
