import type { Knex } from "knex";

/**
 * parts — Procusto `dbo.Partes`, ALL 92 business columns per
 * specs/parts/01-entity.md (92-column correction banner; incl. PesoPromedio).
 * Mobius adds id/uuid/companyId/updatedAt. Dimensional floats are
 * `double precision` on purpose (01-entity/03-calculations: parity with
 * Procusto's IEEE-754 doubles — do NOT switch to numeric).
 *
 * part_approval_events — Mobius divergence (specs/parts/08-approvals.md):
 * an explicit event log per approval action on top of the 16 snapshot columns.
 *
 * modelId is a plain int placeholder (models table arrives with module 08 —
 * TODO(module-08): add the FK constraint then).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("parts", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");

    // Identification & description
    table.string("code", 400);
    table.integer("revision").notNullable().defaultTo(0);
    table.text("clientCode");
    table.text("description");

    // Box dimensions (mm, double precision — parity)
    table.specificType("boxLength", "double precision");
    table.specificType("boxWidth", "double precision");
    table.specificType("boxHeight", "double precision");
    table.specificType("externalLength", "double precision");
    table.specificType("externalWidth", "double precision");
    table.specificType("externalHeight", "double precision");

    // Sheet dimensions
    table.specificType("sheetLength", "double precision");
    table.specificType("sheetWidth", "double precision");
    table.specificType("additionalSheetLength", "double precision");
    table.specificType("preferredWidth", "double precision");

    // Flap geometry
    table.specificType("flap", "double precision");
    table.specificType("lowerFlap", "double precision");
    table.specificType("upperFlap", "double precision");
    table.specificType("flapOverlap", "double precision");

    // Score lines — stored VERBATIM as text (Q-S1 deferred; 07-score-lines.md)
    table.text("corrugationScoreLines");
    table.text("printScoreLines");
    table.boolean("symmetricScoreLines").notNullable().defaultTo(false);

    // Print specifications
    table.integer("colorCount");
    table.specificType("printSides", "double precision");
    table.text("inks");
    table.smallint("labelsPerPallet");
    table.text("labelText");

    // Print flags
    table.boolean("printCode").notNullable().defaultTo(false);
    table.boolean("printDate").notNullable().defaultTo(false);
    table.boolean("printRecyclable").notNullable().defaultTo(false);
    table.boolean("printWarranty").notNullable().defaultTo(false);
    table.boolean("printLogo").notNullable().defaultTo(false);
    table.boolean("printNationalIndustry").notNullable().defaultTo(false);
    table.boolean("printExport").notNullable().defaultTo(false);

    // Quality / lab tests
    table.specificType("compressionTest", "double precision");
    table.specificType("burstTest", "double precision");
    table.specificType("cobbTest", "double precision");
    table.specificType("ect", "double precision");
    table.specificType("grammage", "double precision");

    // Tolerances & overruns (Part-level per decision log §L)
    table.specificType("lengthUpperTolerance", "double precision");
    table.specificType("lengthLowerTolerance", "double precision");
    table.specificType("widthUpperTolerance", "double precision");
    table.specificType("widthLowerTolerance", "double precision");
    table.specificType("overrunPercentage", "double precision");
    table.specificType("underrunPercentage", "double precision");
    table.specificType("corrugationOverproduction", "double precision");

    // Rotation flags
    table.boolean("allowsRotation").notNullable().defaultTo(false);
    table.boolean("allowsPartialRotation").notNullable().defaultTo(false);
    table.boolean("mandatoryRotation").notNullable().defaultTo(false);

    // Calculated but persisted
    table.specificType("boxSurface", "double precision");
    table.specificType("boxWeight", "double precision");
    table.specificType("averageWeight", "double precision");

    // Closure & assembly
    table.boolean("allowsGluing").notNullable().defaultTo(false);
    table.text("claspClosure");

    // Misc
    table.specificType("associatedQuantity", "double precision");
    table.text("foodSafetyNumber");
    table.text("blueprintRef");
    table.text("notes");
    table.text("quotingNotes");

    // File attachments (files.uuid handles)
    table.uuid("dataSheetFileUuid");
    table.uuid("sketchFileUuid");
    table.uuid("blueprintFileUuid");
    table.uuid("imageFileUuid");

    // Foreign keys
    table
      .integer("productId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    table
      .integer("corrugationId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("corrugations")
      .onDelete("RESTRICT");
    table
      .integer("productionRouteId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("production_routes")
      .onDelete("RESTRICT");
    table
      .integer("palletizationId")
      .unsigned()
      .references("id")
      .inTable("palletizations")
      .onDelete("SET NULL");
    // TODO(module-08): FK to models when the table lands.
    table.integer("modelId");
    table
      .integer("flapTypeId")
      .unsigned()
      .references("id")
      .inTable("flap_types")
      .onDelete("SET NULL");
    table
      .integer("glueTypeId")
      .unsigned()
      .references("id")
      .inTable("glue_types")
      .onDelete("SET NULL");
    table
      .integer("strappingTypeId")
      .unsigned()
      .references("id")
      .inTable("strapping_types")
      .onDelete("SET NULL");
    table
      .integer("traceTypeId")
      .unsigned()
      .references("id")
      .inTable("trace_types")
      .onDelete("SET NULL");
    table
      .integer("complementId")
      .unsigned()
      .references("id")
      .inTable("complements")
      .onDelete("SET NULL");

    // Approval machines (4 × approve/cancel × at/by = 16 columns)
    table.timestamp("dimensionsApprovalAt", { useTz: true });
    table.text("dimensionsApprovalBy");
    table.timestamp("dimensionsCancelledAt", { useTz: true });
    table.text("dimensionsCancelledBy");
    table.timestamp("technicalApprovalAt", { useTz: true });
    table.text("technicalApprovalBy");
    table.timestamp("technicalCancelledAt", { useTz: true });
    table.text("technicalCancelledBy");
    table.timestamp("sketchApprovalAt", { useTz: true });
    table.text("sketchApprovalBy");
    table.timestamp("sketchCancelledAt", { useTz: true });
    table.text("sketchCancelledBy");
    table.timestamp("partApprovalAt", { useTz: true });
    table.text("partApprovalBy");
    table.timestamp("partCancelledAt", { useTz: true });
    table.text("partCancelledBy");

    // Creation audit
    table
      .timestamp("createdAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.text("createdBy");
    table.timestamp("registeredAt", { useTz: true });
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());
    table.integer("legacyId");

    table.unique(["companyId", "code", "revision"]);
    table.index(["companyId", "code"]);
    table.index(["productId"]);
    table.index(["productionRouteId"]);
    table.index(["corrugationId"]);
    table.index(["legacyId"]);
  });
  await knex.raw(
    `CREATE INDEX idx_parts_approval_at ON parts ("partApprovalAt") WHERE "partApprovalAt" IS NOT NULL`,
  );

  await knex.schema.createTable("part_approval_events", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("partId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("parts")
      .onDelete("CASCADE");
    table
      .enu("stateMachine", ["dimensions", "technical", "sketch", "part"])
      .notNullable();
    // 'unapprove' = bulk-unapprove's PENDING-restoring nulling (distinct from
    // 'cancel', which stamps the cancellation pair).
    table.enu("action", ["approve", "cancel", "unapprove"]).notNullable();
    table.text("performedBy");
    table
      .timestamp("performedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(["partId", "performedAt"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("part_approval_events");
  await knex.schema.dropTableIfExists("parts");
}
