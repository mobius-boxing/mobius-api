import type { Knex } from "knex";

/**
 * node-files Phase 1 — document extraction (module slug `node-files`, database
 * key `nodefiles`: the key drops the hyphen because it becomes a database name,
 * see src/database/keys.ts).
 *
 * Split-clean by construction: **no FK crosses a database-key boundary**.
 * `companyId`, `createdByUserId` and `uploadedByUserId` are plain integers with
 * an index and no `references()` — `companies` and `users` are owned by the
 * `core` key and the whole point of this module is that its three tables can be
 * lifted into `mobius_nodefiles_production` without dragging core along. Scoping
 * is enforced in the DAOs, every one of which filters `"companyId" = ?`
 * directly (L-009).
 *
 * Deletion strategy, stated once per entity (L-006):
 *  - `nf_documents.workflowId` CASCADEs — a deleted workflow's uploads go with it.
 *  - `nf_runs.workflowId` RESTRICTs — run history is the audit trail of what the
 *    model was asked and answered, and must not evaporate. The service refuses
 *    the delete with a 409 naming how many runs block it.
 *  - `nf_runs.documentId` CASCADEs, but the RESTRICT above means a document with
 *    runs can only disappear together with its workflow, which is already refused.
 *
 * No CHECK constraints (host rule): `status`, the field schema and the run state
 * machine are enforced in the DTOs and the service. The partial index on
 * `status = 'queued'` is an index, not a check, and it is what keeps the
 * worker's `FOR UPDATE SKIP LOCKED` claim query cheap.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("nf_workflows", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.integer("companyId").notNullable();
    table.string("name", 120).notNullable();
    table.text("description");
    // A run that needs a human to confirm the values stops at pending_review
    // instead of going straight to succeeded.
    table.boolean("requireReview").notNullable().defaultTo(false);
    table.string("status", 20).notNullable().defaultTo("draft");
    // [{ key, label, type, description?, required? }] — the declared extraction
    // schema, which the provider turns into a Zod schema at runtime.
    table.jsonb("fields").notNullable().defaultTo("[]");
    table.integer("createdByUserId");
    // Denormalized on purpose: no DAO here may join `users` (another key).
    table.text("createdByName");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"], {
      indexName: "nf_workflows_company_name_unique",
    });
    table.index(["companyId"]);
  });

  await knex.schema.createTable("nf_documents", (table) => {
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
    table.integer("companyId").notNullable();
    // node-files owns its own byte metadata rather than borrowing the `files`
    // table, which belongs to `core` and is fanned out per key (brief D-2). The
    // stateless storage *driver* is shared; the metadata table is not.
    table.text("storageKey").notNullable();
    table.text("originalName").notNullable();
    table.string("contentType", 120).notNullable();
    table.bigInteger("sizeBytes");
    table.text("checksum");
    table.integer("uploadedByUserId");
    table.text("uploadedByName");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["workflowId"]);
    table.index(["companyId"]);
  });

  await knex.schema.createTable("nf_runs", (table) => {
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
      .onDelete("RESTRICT");
    table
      .integer("documentId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("nf_documents")
      .onDelete("CASCADE");
    table.integer("companyId").notNullable();
    table.string("status", 20).notNullable().defaultTo("queued");
    // { <fieldKey>: { value, confidence } } as coerced against the declared type.
    table.jsonb("extracted");
    table.jsonb("reviewedValues");
    table.integer("reviewedByUserId");
    table.text("reviewedByName");
    table.text("error");
    table.integer("tokensIn");
    table.integer("tokensOut");
    table.timestamp("startedAt", { useTz: true });
    table.timestamp("finishedAt", { useTz: true });
    // Claim bookkeeping for the worker; `lockedBy` is the process claim id.
    table.timestamp("lockedAt", { useTz: true });
    table.string("lockedBy", 64);
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    // The list page's hot path.
    table.index(["companyId", "status", "createdAt"]);
    table.index(["workflowId"]);
  });

  // Partial: the claim query only ever looks at queued rows, and there are
  // never many of them next to the run history they sit in.
  await knex.raw(
    `CREATE INDEX nf_runs_queued_idx ON nf_runs (id) WHERE status = 'queued'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("nf_runs");
  await knex.schema.dropTableIfExists("nf_documents");
  await knex.schema.dropTableIfExists("nf_workflows");
}
