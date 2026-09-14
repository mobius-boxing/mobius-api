import type { Knex } from "knex";

/**
 * paper_class_papers — real M:M join replacing the paper_classes.papers jsonb
 * (Q-05-7 RESOLVED; Procusto `PapelClaseDePapel` is a clean 2-column int join,
 * confirmed from live DDL). Existing jsonb arrays (paper-supply uuids) are
 * backfilled into rows; unknown uuids are skipped. The API keeps returning
 * `papers: string[]` — only the storage changes.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("paper_class_papers", function (table) {
    table
      .integer("paperClassId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("paper_classes")
      .onDelete("CASCADE");
    table
      .integer("paperSupplyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("paper_supplies")
      .onDelete("CASCADE");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());

    table.primary(["paperClassId", "paperSupplyId"]);
    table.index(["paperSupplyId"]);
  });

  await knex.raw(`
    INSERT INTO paper_class_papers ("paperClassId", "paperSupplyId")
    SELECT pc.id, ps.id
      FROM paper_classes pc
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(pc.papers) = 'array' THEN pc.papers ELSE '[]'::jsonb END
     ) AS elem(paper_uuid)
      JOIN paper_supplies ps ON ps.uuid::text = elem.paper_uuid
    ON CONFLICT DO NOTHING
  `);

  await knex.schema.alterTable("paper_classes", function (table) {
    table.dropColumn("papers");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("paper_classes", function (table) {
    table.jsonb("papers");
  });
  await knex.raw(`
    UPDATE paper_classes pc
       SET papers = COALESCE(sub.arr, '[]'::jsonb)
      FROM (
        SELECT pcp."paperClassId", jsonb_agg(ps.uuid::text) AS arr
          FROM paper_class_papers pcp
          JOIN paper_supplies ps ON ps.id = pcp."paperSupplyId"
         GROUP BY pcp."paperClassId"
      ) sub
     WHERE sub."paperClassId" = pc.id
  `);
  await knex.schema.dropTableIfExists("paper_class_papers");
}
