import type { Knex } from "knex";

/**
 * countdown — document-expiration tracking module (slug `countdown`).
 *
 * Ported from the standalone Countdown app. Two deliberate differences from the
 * source schema:
 *
 *  - Every root table carries `companyId`: Countdown was single-tenant, Mobius is
 *    not. Children (subcategories, group members, assignments, reminder log)
 *    inherit their scope through their parent FK, so a document's assignments can
 *    never belong to another company.
 *  - No CHECK constraints (host rule). Countdown enforced status/kind enums, the
 *    both-or-neither recurrence pair and the assignment userId-XOR-groupId in the
 *    database; here those invariants live in the DTOs and services. The partial
 *    unique indexes DO come across — they are indexes, not checks, and they are
 *    what stop a subject being assigned twice to one document.
 *
 * `dueDate` is DATE, not TIMESTAMPTZ, on purpose: a due date is a calendar date
 * and "vence el 5" must not become the 4th for a reader in another timezone.
 * Money is integer cents — never float, never NUMERIC (pg returns that as string).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("countdown_categories", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name", 80).notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"], {
      indexName: "countdown_categories_company_name_unique",
    });
    table.index(["companyId"]);
  });

  await knex.schema.createTable("countdown_subcategories", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("categoryId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("countdown_categories")
      .onDelete("CASCADE");
    table.string("name", 80).notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["categoryId", "name"], {
      indexName: "countdown_subcategories_category_name_unique",
    });
    table.index(["categoryId"]);
  });

  await knex.schema.createTable("countdown_groups", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name", 80).notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"], {
      indexName: "countdown_groups_company_name_unique",
    });
    table.index(["companyId"]);
  });

  await knex.schema.createTable("countdown_group_members", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("groupId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("countdown_groups")
      .onDelete("CASCADE");
    table
      .integer("userId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["groupId", "userId"], {
      indexName: "countdown_group_members_unique",
    });
    table.index(["userId"]);
  });

  await knex.schema.createTable("countdown_documents", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");

    table.string("title", 200).notNullable();
    table.string("issuer", 200); // proveedor / emisor
    table.string("referenceNumber", 100); // nº de factura o comprobante
    table.text("notes");

    /**
     * Nullable, and optional end to end: a document can be filed with no rubro
     * and an existing rubro can be cleared again, so a company that has not
     * finished classifying its paperwork is never blocked. The renewal path
     * copies whatever the source row had, nulls included. A rubro already in use
     * is protected by ON DELETE RESTRICT as the backstop; the service refuses
     * first, with a message that says how many documents are in the way.
     */
    table
      .integer("categoryId")
      .unsigned()
      .references("id")
      .inTable("countdown_categories")
      .onDelete("RESTRICT");
    table
      .integer("subcategoryId")
      .unsigned()
      .references("id")
      .inTable("countdown_subcategories")
      .onDelete("RESTRICT");

    table.integer("amountCents");
    table.string("currency", 3).notNullable().defaultTo("ARS");
    table.date("dueDate").notNullable();

    table.string("status", 20).notNullable().defaultTo("pending");
    table.timestamp("resolvedAt", { useTz: true });
    table
      .integer("resolvedBy")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    // RESTRICT, not CASCADE: deleting a user must not silently delete the
    // documents they filed and erase who filed what.
    table
      .integer("uploadedBy")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");

    // Both set or both null — a count with no unit means nothing (services enforce).
    table.integer("recurrenceCount");
    table.string("recurrenceUnit", 10);

    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["dueDate"]);
    table.index(["status"]);
    table.index(["uploadedBy"]);
    table.index(["resolvedBy"]);
    table.index(["categoryId"]);
    table.index(["subcategoryId"]);
    // The dashboard's hot path: one company's pending items ordered by due date.
    table.index(["companyId", "status", "dueDate"]);
  });

  /**
   * Who may resolve a document ('resolver') and who is reminded about it
   * ('watcher'). A row points at either a user or a group, never both — groups
   * are expanded to their current membership at permission-check time, so
   * changing a group changes access to documents assigned before the change.
   */
  await knex.schema.createTable("countdown_document_assignments", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("documentId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("countdown_documents")
      .onDelete("CASCADE");
    table
      .integer("userId")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .integer("groupId")
      .unsigned()
      .references("id")
      .inTable("countdown_groups")
      .onDelete("CASCADE");
    table.string("kind", 20).notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["documentId"]);
    table.index(["userId"]);
    table.index(["groupId"]);
  });

  // Partial uniques: a subject can appear once per kind per document.
  await knex.raw(
    `create unique index countdown_document_assignments_user_unique
       on countdown_document_assignments ("documentId", kind, "userId") where "userId" is not null`,
  );
  await knex.raw(
    `create unique index countdown_document_assignments_group_unique
       on countdown_document_assignments ("documentId", kind, "groupId") where "groupId" is not null`,
  );

  /**
   * What has already been sent. The unique triple is the whole point: the
   * scheduler must never send the same reminder twice, even if it restarts
   * mid-run. A row is written only after the provider accepts the message.
   */
  await knex.schema.createTable("countdown_reminder_log", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("documentId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("countdown_documents")
      .onDelete("CASCADE");
    table
      .integer("userId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.integer("offsetDays").notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["documentId", "userId", "offsetDays"], {
      indexName: "countdown_reminder_log_unique",
    });
    table.index(["userId"]);
  });

  /**
   * One reminder run per calendar day, claimed with `on conflict do nothing`:
   * whichever hourly tick inserts first does the work and every later tick that
   * day finds the day already claimed. Without it, a permanently undeliverable
   * address produced sixteen send attempts a day. DATE, not TIMESTAMPTZ — it is
   * the customer's calendar day and is compared against `dueDate`.
   */
  await knex.schema.createTable("countdown_reminder_runs", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.date("runDate").notNullable().unique();
    table.integer("sent").notNullable().defaultTo(0);
    table.integer("failed").notNullable().defaultTo(0);
    table.integer("skipped").notNullable().defaultTo(0);
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("countdown_reminder_runs");
  await knex.schema.dropTableIfExists("countdown_reminder_log");
  await knex.schema.dropTableIfExists("countdown_document_assignments");
  await knex.schema.dropTableIfExists("countdown_documents");
  await knex.schema.dropTableIfExists("countdown_group_members");
  await knex.schema.dropTableIfExists("countdown_groups");
  await knex.schema.dropTableIfExists("countdown_subcategories");
  await knex.schema.dropTableIfExists("countdown_categories");
}
