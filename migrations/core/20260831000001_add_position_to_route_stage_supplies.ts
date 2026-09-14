import type { Knex } from "knex";

/**
 * Audit P1b / track T2a (decision D1 = a) — give
 * `production_route_stage_supplies` a real ordering column.
 *
 * The table was created (20260721000003) with no ordering column and is read
 * `ORDER BY id ASC`. That is correct today only by accident: every save deletes
 * and reinserts every supply, so ids are always freshly sequential and read
 * order always equals the order the client sent. P1b replaces that with
 * diff-and-upsert, where survivors keep their old ids and new rows get higher
 * ones — a supply inserted mid-list would silently jump to the end. `position`
 * makes supplies structurally identical to `production_route_stages.number` and
 * `corrugation_layers.position`: NOT NULL, unique per parent, derived
 * server-side from array order (no client ever sends it).
 *
 * The backfill is `row_number() over (partition by "stageId" order by id)`,
 * which reproduces the current display order exactly — nothing visibly moves.
 *
 * Idempotent (guarded add / conditional backfill / guarded constraint) because
 * until the db-per-module split's T3 lands, every migration directory still
 * runs against one physical database.
 *
 * `down()` exists for local dev only: production is roll-forward only (L-003) —
 * never run `migrate:rollback` against prod, fix forward with a new migration.
 */
export async function up(knex: Knex): Promise<void> {
  const hasPosition = await knex.schema.hasColumn(
    "production_route_stage_supplies",
    "position",
  );
  if (!hasPosition) {
    await knex.schema.alterTable(
      "production_route_stage_supplies",
      function (table) {
        // Nullable first: the backfill needs the column to exist.
        table.integer("position").nullable();
      },
    );
  }

  await knex.raw(`
    UPDATE production_route_stage_supplies AS s
    SET "position" = ordered.rn
    FROM (
      SELECT id,
             row_number() OVER (PARTITION BY "stageId" ORDER BY id) AS rn
      FROM production_route_stage_supplies
    ) AS ordered
    WHERE ordered.id = s.id AND s."position" IS NULL
  `);

  await knex.raw(`
    ALTER TABLE production_route_stage_supplies
      ALTER COLUMN "position" SET NOT NULL
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'production_route_stage_supplies_stageid_position_unique'
      ) THEN
        ALTER TABLE production_route_stage_supplies
          ADD CONSTRAINT production_route_stage_supplies_stageid_position_unique
          UNIQUE ("stageId", "position");
      END IF;
    END $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE production_route_stage_supplies
      DROP CONSTRAINT IF EXISTS production_route_stage_supplies_stageid_position_unique
  `);
  await knex.raw(`
    ALTER TABLE production_route_stage_supplies
      DROP COLUMN IF EXISTS "position"
  `);
}
