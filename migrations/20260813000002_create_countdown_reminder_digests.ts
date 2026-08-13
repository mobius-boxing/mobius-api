import type { Knex } from "knex";

/**
 * The reminder batch stops sending one email per (document, recipient, offset)
 * and starts sending one digest per (recipient, send day). The idempotency key
 * has to move with it:
 *
 *  - `countdown_reminder_digests` is the new once-per-recipient-per-day record,
 *    guaranteed by `UNIQUE (userId, sendDate)`. A row is written only after the
 *    provider accepts the message.
 *  - `countdown_reminder_log` is kept, not dropped: it becomes the per-document
 *    history hanging off a digest (`digestId`), so "was this document ever
 *    reported to this person" is still answerable. Its unique triple moves from
 *    `(documentId, userId, offsetDays)` — meaningless now that one send covers
 *    many documents at many offsets — to `(documentId, userId, sentOn)`.
 *
 * `offsetDays` keeps its column and gains a defined meaning: the signed
 * `dueDate - sentOn`, negative once the document is overdue.
 *
 * Order matters here. The new unique index cannot be created before the
 * de-dupe pass, and `sentOn` cannot become NOT NULL before the backfill.
 *
 * `down()` is LOSSY — it deletes rows in two places (the de-dupe on the old
 * triple, and the digest table itself). It exists for scratch-database replay
 * only: production is roll-forward (L-003).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("countdown_reminder_digests", (table) => {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    // Both FKs cascade, explicitly (L-006): a digest is bookkeeping about a
    // person in a company, and it means nothing once either is gone. Nothing
    // else hangs off a digest except countdown_reminder_log.digestId, which
    // cascades from here in turn.
    table
      .integer("userId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.date("sendDate").notNullable();
    /** A historical snapshot of how many documents the digest listed — never a
     *  live count, so deleting a document does not change it. */
    table.integer("documentCount").notNullable();
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["userId", "sendDate"], {
      indexName: "countdown_reminder_digests_unique",
    });
    table.index(["sendDate"]);
  });

  await knex.schema.alterTable("countdown_reminder_log", (table) => {
    // Nullable so pre-migration rows survive (nothing is backfilled into the
    // digest table — that history is not reconstructed); every new row sets it.
    table
      .integer("digestId")
      .unsigned()
      .references("id")
      .inTable("countdown_reminder_digests")
      .onDelete("CASCADE");
    // Added nullable so the backfill below can fill it, then made NOT NULL.
    table.date("sentOn");
    table.index(["digestId"]);
  });

  await knex.raw(
    `update countdown_reminder_log
        set "sentOn" = (coalesce("createdAt", now())
                          at time zone 'America/Argentina/Buenos_Aires')::date
      where "sentOn" is null`,
  );

  // Destructive and non-reversible, and required: the new unique index would
  // otherwise fail mid-deploy on any pair of rows that went out to the same
  // person about the same document on the same day at two different offsets.
  // Lowest id of each colliding group survives.
  await knex.raw(
    `delete from countdown_reminder_log a
       using countdown_reminder_log b
      where a."documentId" = b."documentId"
        and a."userId"     = b."userId"
        and a."sentOn"     = b."sentOn"
        and a.id > b.id`,
  );

  await knex.schema.alterTable("countdown_reminder_log", (table) => {
    table.date("sentOn").notNullable().alter();
  });

  // `table.unique()` in the creating migration emitted a UNIQUE *constraint*,
  // so it is dropped as a constraint, not as an index.
  await knex.raw(
    `alter table countdown_reminder_log
       drop constraint if exists countdown_reminder_log_unique`,
  );

  await knex.raw(
    `create unique index countdown_reminder_log_sent_unique
       on countdown_reminder_log ("documentId", "userId", "sentOn")`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`drop index if exists countdown_reminder_log_sent_unique`);

  await knex.schema.alterTable("countdown_reminder_log", (table) => {
    // Dropping the column drops its foreign key with it.
    table.dropColumn("digestId");
    table.dropColumn("sentOn");
  });

  // After the change two rows may legitimately share the old triple — the same
  // document reported to the same person on two days at the same offset is
  // impossible, but a moved `dueDate` makes two send days share one offset.
  // Restoring the old constraint without this would throw.
  await knex.raw(
    `delete from countdown_reminder_log a
       using countdown_reminder_log b
      where a."documentId" = b."documentId"
        and a."userId"     = b."userId"
        and a."offsetDays" = b."offsetDays"
        and a.id > b.id`,
  );

  await knex.raw(
    `alter table countdown_reminder_log
       add constraint countdown_reminder_log_unique
       unique ("documentId", "userId", "offsetDays")`,
  );

  await knex.schema.dropTableIfExists("countdown_reminder_digests");
}
