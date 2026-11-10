import type { Knex } from "knex";

const AUDIT_CONTEXT = JSON.stringify({
  source: "migration",
  action: "paper_stock.add_reel_code",
});

export async function up(knex: Knex): Promise<void> {
  const hasCode = await knex.schema.hasColumn("paper_stock", "code");
  const hasBarcode = await knex.schema.hasColumn("paper_stock", "barcode");

  if (!hasCode || !hasBarcode) {
    await knex.raw("select set_config('mobius.audit', ?, true)", [
      AUDIT_CONTEXT,
    ]);
    await knex.schema.alterTable("paper_stock", (table) => {
      if (!hasCode) table.string("code", 20).nullable();
      if (!hasBarcode) table.string("barcode", 50).nullable();
    });
  }

  await knex.raw("select set_config('mobius.audit', ?, true)", [AUDIT_CONTEXT]);
  await knex.raw(`
    WITH numbered AS (
      SELECT
        paper_stock.id,
        lpad(
          row_number() OVER (
            PARTITION BY warehouses.company_id
            ORDER BY paper_stock."createdAt", paper_stock.id
          )::text,
          10,
          '0'
        ) AS code
      FROM paper_stock
      INNER JOIN warehouses ON warehouses.id = paper_stock."warehouseId"
    )
    UPDATE paper_stock
    SET
      code = COALESCE(paper_stock.code, numbered.code),
      barcode = COALESCE(paper_stock.barcode, paper_stock.code, numbered.code)
    FROM numbered
    WHERE paper_stock.id = numbered.id
      AND (paper_stock.code IS NULL OR paper_stock.barcode IS NULL)
  `);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
