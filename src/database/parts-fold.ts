/**
 * Folding `parts` into `products` (remove-composite-products, model.md rev 2).
 *
 * Shared by the tenant migrations and their core mirrors (D-16). Everything
 * here is additive or a backfill whose predicate only matches unfolded rows,
 * so each function is safe to run twice — the contract migrations re-run them
 * for rows the previous image wrote between the two deploys. Contract DDL
 * (drops, SET NOT NULL) stays inline in the migration files, where
 * `tenant-migrations.test.ts` can see it.
 *
 * Frozen on purpose: migrations must not follow later edits to live
 * interfaces, so the column list is spelled out here rather than derived.
 */
import type { Knex } from "knex";

type RecipeColumnType =
  | "double"
  | "text"
  | "integer"
  | "smallint"
  | "flag"
  | "timestamptz";

/** Part columns copied verbatim onto the product (the kept part's values). */
const RECIPE_COLUMNS: readonly [string, RecipeColumnType][] = [
  ["boxLength", "double"],
  ["boxWidth", "double"],
  ["boxHeight", "double"],
  ["externalLength", "double"],
  ["externalWidth", "double"],
  ["externalHeight", "double"],
  ["sheetLength", "double"],
  ["sheetWidth", "double"],
  ["additionalSheetLength", "double"],
  ["preferredWidth", "double"],
  ["flap", "double"],
  ["lowerFlap", "double"],
  ["upperFlap", "double"],
  ["flapOverlap", "double"],
  ["corrugationScoreLines", "text"],
  ["printScoreLines", "text"],
  ["symmetricScoreLines", "flag"],
  ["colorCount", "integer"],
  ["printSides", "double"],
  ["inks", "text"],
  ["labelsPerPallet", "smallint"],
  ["labelText", "text"],
  ["printCode", "flag"],
  ["printDate", "flag"],
  ["printRecyclable", "flag"],
  ["printWarranty", "flag"],
  ["printLogo", "flag"],
  ["printNationalIndustry", "flag"],
  ["printExport", "flag"],
  ["compressionTest", "double"],
  ["burstTest", "double"],
  ["cobbTest", "double"],
  ["ect", "double"],
  ["grammage", "double"],
  ["lengthUpperTolerance", "double"],
  ["lengthLowerTolerance", "double"],
  ["widthUpperTolerance", "double"],
  ["widthLowerTolerance", "double"],
  ["overrunPercentage", "double"],
  ["underrunPercentage", "double"],
  ["corrugationOverproduction", "double"],
  ["allowsRotation", "flag"],
  ["allowsPartialRotation", "flag"],
  ["mandatoryRotation", "flag"],
  ["boxSurface", "double"],
  ["boxWeight", "double"],
  ["averageWeight", "double"],
  ["allowsGluing", "flag"],
  ["claspClosure", "text"],
  ["associatedQuantity", "double"],
  ["foodSafetyNumber", "text"],
  ["blueprintRef", "text"],
  ["notes", "text"],
  ["quotingNotes", "text"],
  ["registeredAt", "timestamptz"],
];

/** [column, referenced table, ON DELETE] — RESTRICT ones are indexed. */
const RECIPE_REFERENCES: readonly [string, string, "RESTRICT" | "SET NULL"][] =
  [
    ["corrugationId", "corrugations", "RESTRICT"],
    ["productionRouteId", "production_routes", "RESTRICT"],
    ["palletizationId", "palletizations", "SET NULL"],
    ["modelId", "models", "RESTRICT"],
    ["flapTypeId", "flap_types", "SET NULL"],
    ["glueTypeId", "glue_types", "SET NULL"],
    ["strappingTypeId", "strapping_types", "SET NULL"],
    ["traceTypeId", "trace_types", "SET NULL"],
    ["complementId", "complements", "SET NULL"],
  ];

export const FOLD_AUDIT_CONTEXT = JSON.stringify({
  source: "migration",
  action: "parts.fold",
});

/** Attributes every row the fold touches to the migration (D-21); transaction-local. */
export async function setFoldAuditContext(knex: Knex): Promise<void> {
  await knex.raw("select set_config('mobius.audit', ?, true)", [
    FOLD_AUDIT_CONTEXT,
  ]);
}

export async function addProductRecipeColumns(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("products", "boxLength")) return;
  await knex.schema.alterTable("products", (table) => {
    for (const [name, type] of RECIPE_COLUMNS) {
      switch (type) {
        case "double":
          table.double(name).nullable();
          break;
        case "text":
          table.text(name).nullable();
          break;
        case "integer":
          table.integer(name).nullable();
          break;
        case "smallint":
          table.smallint(name).nullable();
          break;
        case "flag":
          table.boolean(name).notNullable().defaultTo(false);
          break;
        case "timestamptz":
          table.timestamp(name, { useTz: true }).nullable();
          break;
      }
    }
    for (const [name, target, onDelete] of RECIPE_REFERENCES) {
      table
        .integer(name)
        .nullable()
        .references("id")
        .inTable(target)
        .onDelete(onDelete);
      if (onDelete === "RESTRICT") table.index([name]);
    }
    table.integer("partLegacyId").nullable().index();
  });
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_products_approval_at ON products ("productApprovalAt") WHERE "productApprovalAt" IS NOT NULL`,
  );
}

export async function addOrderProductColumns(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("production_orders", "productId"))) {
    await knex.schema.alterTable("production_orders", (table) => {
      table
        .integer("productId")
        .nullable()
        .references("id")
        .inTable("products")
        .onDelete("RESTRICT")
        .index();
    });
  }
  if (!(await knex.schema.hasColumn("finished_goods", "productId"))) {
    await knex.schema.alterTable("finished_goods", (table) => {
      table
        .integer("productId")
        .nullable()
        .references("id")
        .inTable("products")
        .onDelete("RESTRICT");
    });
  }
}

const KEPT_PARTS = `SELECT DISTINCT ON ("productId") * FROM parts ORDER BY "productId", id`;

/**
 * Prints what the fold changes, one JSON line per finding, so the deploy log
 * names every composite, approval conflict and identity mismatch (C-6, C-8,
 * C-16, C-19). Read-only.
 */
export async function reportFold(knex: Knex, label: string): Promise<void> {
  if (!(await knex.schema.hasTable("parts"))) return;
  const composites = await knex.raw(`
    WITH kept AS (
      SELECT "productId", min(id) AS "keptId", count(*)::int AS "partCount"
      FROM parts GROUP BY "productId")
    SELECT p.id, p.code, k."partCount", k."keptId", kp.code AS "keptPartCode",
      (SELECT count(*)::int FROM sales_orders so JOIN parts x ON x.id = so."partId"
        WHERE x."productId" = p.id AND x.id <> k."keptId") AS "salesOrdersRepointed",
      (SELECT count(*)::int FROM production_orders po JOIN parts x ON x.id = po."partId"
        WHERE x."productId" = p.id AND x.id <> k."keptId") AS "productionOrdersRepointed",
      (SELECT count(*)::int FROM production_orders po JOIN parts x ON x.id = po."partId"
        WHERE x."productId" = p.id AND x.id <> k."keptId"
          AND po."completedAt" IS NULL AND po."voidedAt" IS NULL) AS "openProductionOrdersRepointed"
    FROM kept k
    JOIN products p ON p.id = k."productId"
    JOIN parts kp ON kp.id = k."keptId"
    WHERE k."partCount" > 1
    ORDER BY p.id`);
  const approvalConflicts = await knex.raw(`
    WITH kp AS (${KEPT_PARTS})
    SELECT p.id, p.code,
      p."productApprovalAt", p."productCancellationAt",
      kp."partApprovalAt", kp."partCancelledAt"
    FROM products p JOIN kp ON kp."productId" = p.id
    WHERE p."corrugationId" IS NULL AND p."productionRouteId" IS NULL
      AND (p."productApprovalAt" IS NOT NULL OR p."productCancellationAt" IS NOT NULL)
      AND (p."productApprovalAt" IS DISTINCT FROM kp."partApprovalAt"
        OR p."productCancellationAt" IS DISTINCT FROM kp."partCancelledAt")
    ORDER BY p.id`);
  const identityMismatches = await knex.raw(`
    WITH kp AS (${KEPT_PARTS})
    SELECT p.id, p.code,
      p.description AS "productDescription", kp.description AS "partDescription",
      p."clientCode" AS "productClientCode", kp."clientCode" AS "partClientCode"
    FROM products p JOIN kp ON kp."productId" = p.id
    WHERE p."corrugationId" IS NULL AND p."productionRouteId" IS NULL
      AND ((p.description IS NOT NULL AND kp.description IS NOT NULL AND p.description <> kp.description)
        OR (p."clientCode" IS NOT NULL AND kp."clientCode" IS NOT NULL AND p."clientCode" <> kp."clientCode"))
    ORDER BY p.id`);
  const sections: [string, { rows: unknown[] }][] = [
    ["composite", composites],
    ["approvalConflict", approvalConflicts],
    ["identityMismatch", identityMismatches],
  ];
  for (const [kind, result] of sections) {
    for (const row of result.rows) {
      console.log(JSON.stringify({ fold: label, kind, ...(row as object) }));
    }
  }
}

/**
 * Copies the kept (lowest-id) part onto its product (D-4). A product is
 * unfolded while both `corrugationId` and `productionRouteId` are NULL: every
 * part has both NOT NULL, so a folded product never matches again.
 */
export async function foldProducts(knex: Knex): Promise<number> {
  if (!(await knex.schema.hasTable("parts"))) return 0;
  const copied = [
    ...RECIPE_COLUMNS.map(([name]) => name),
    ...RECIPE_REFERENCES.map(([name]) => name),
  ]
    .map((name) => `"${name}" = k."${name}"`)
    .join(",\n      ");
  const result = await knex.raw(`
    WITH k AS (${KEPT_PARTS})
    UPDATE products p SET
      ${copied},
      "partLegacyId" = k."legacyId",
      description = COALESCE(p.description, k.description),
      "clientCode" = COALESCE(p."clientCode", left(k."clientCode", 100)),
      "technicalSheetFileUuid" = COALESCE(p."technicalSheetFileUuid", k."dataSheetFileUuid"),
      "blueprintFileUuid" = COALESCE(p."blueprintFileUuid", k."blueprintFileUuid"),
      "sketchFileUuid" = COALESCE(p."sketchFileUuid", k."sketchFileUuid"),
      "imageFileUuid" = COALESCE(p."imageFileUuid", k."imageFileUuid"),
      "productApprovalAt" = k."partApprovalAt",
      "productApprovalBy" = k."partApprovalBy",
      "productCancellationAt" = k."partCancelledAt",
      "productCancellationBy" = k."partCancelledBy"
    FROM k
    WHERE k."productId" = p.id
      AND p."corrugationId" IS NULL AND p."productionRouteId" IS NULL`);
  return result.rowCount ?? 0;
}

export async function repointSalesOrders(knex: Knex): Promise<number> {
  if (
    !(await knex.schema.hasTable("parts")) ||
    !(await knex.schema.hasColumn("sales_orders", "partId"))
  ) {
    return 0;
  }
  const result = await knex.raw(`
    UPDATE sales_orders so SET "productId" = pt."productId"
    FROM parts pt
    WHERE so."partId" = pt.id AND so."productId" IS NULL`);
  return result.rowCount ?? 0;
}

/**
 * Points production orders at their part's product and, for orders of parts
 * that were not kept, pins the dropped part's route and palletization so the
 * order's recipe does not silently switch to the kept part's (C-8).
 */
export async function repointProductionOrders(knex: Knex): Promise<number> {
  if (
    !(await knex.schema.hasTable("parts")) ||
    !(await knex.schema.hasColumn("production_orders", "partId"))
  ) {
    return 0;
  }
  const repointed = await knex.raw(`
    UPDATE production_orders po SET "productId" = pt."productId"
    FROM parts pt
    WHERE po."partId" = pt.id AND po."productId" IS NULL`);
  await knex.raw(`
    WITH kept AS (SELECT "productId", min(id) AS "keptId" FROM parts GROUP BY "productId")
    UPDATE production_orders po SET
      "routeId" = COALESCE(po."routeId", pt."productionRouteId"),
      "palletizationId" = COALESCE(po."palletizationId", pt."palletizationId")
    FROM parts pt
    JOIN kept k ON k."productId" = pt."productId"
    WHERE po."partId" = pt.id AND pt.id <> k."keptId"
      AND ((po."routeId" IS NULL AND pt."productionRouteId" IS NOT NULL)
        OR (po."palletizationId" IS NULL AND pt."palletizationId" IS NOT NULL))`);
  return repointed.rowCount ?? 0;
}

export async function mapFinishedGoods(knex: Knex): Promise<number> {
  if (
    !(await knex.schema.hasTable("parts")) ||
    !(await knex.schema.hasColumn("finished_goods", "partId"))
  ) {
    return 0;
  }
  const result = await knex.raw(`
    UPDATE finished_goods fg SET "productId" = pt."productId"
    FROM parts pt
    WHERE fg."partId" = pt.id AND fg."productId" IS NULL`);
  return result.rowCount ?? 0;
}

/** The backfills A runs once and B re-runs, in dependency order. */
export async function runFoldBackfills(
  knex: Knex,
  label: string,
): Promise<void> {
  await reportFold(knex, label);
  const counts = {
    products: await foldProducts(knex),
    salesOrders: await repointSalesOrders(knex),
    productionOrders: await repointProductionOrders(knex),
    finishedGoods: await mapFinishedGoods(knex),
  };
  console.log(JSON.stringify({ fold: label, kind: "backfill", ...counts }));
}
