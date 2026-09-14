import type { Knex } from "knex";

/**
 * production_orders — Procusto `OrdenesDeProduccion` (module 13,
 * 01-entities-schema.md:12-56), full column parity: the three paired-timestamp
 * lifecycle machines (habilitación / cumplimiento / anulación), the
 * denormalised QA snapshot block, and the Mobius cross-cutting columns.
 *
 * `Pedido_Id` points at `order_data`, NOT at `sales_orders`
 * (PLSUseCases.PedidosDePartes/Editar.cs:90-92,
 * UseCases.OrdenesDeProduccion/Editar.cs:96). The order reaches its OPs
 * transitively through `sales_orders.orderDataId`.
 *
 * Every float is `double precision` and never `numeric` — the replication
 * program is judged on identical IEEE-754 numbers (L-010).
 *
 * `(companyId, "number")` is a plain index, NOT unique: the corpus cannot
 * confirm a unique index in the source (02-validation-invariants.md:20) and
 * legacy data may contain duplicates. Uniqueness within a pedido comes from
 * `code_sequences`.
 *
 * DELETION (L-006): `companyId` cascades (tenant teardown); every other FK is
 * RESTRICT except `palletizationId`, which is SET NULL — a palletizado is a
 * reference row whose removal must not take production history with it.
 */

/** The QA snapshot + quality-target block; all nullable `double precision`. */
const FLOAT_COLUMNS = [
  "compression", // Compresion (target)
  "burst", // Reventamiento (target)
  "cobb", // Cobb (target)
  "testedInternalLength", // LargoInternoEnsayado
  "testedInternalWidth", // AnchoInternoEnsayado
  "testedInternalHeight", // AlturaInternaEnsayada
  "testedExternalLength", // LargoExternoEnsayado
  "testedExternalWidth", // AnchoExternoEnsayado
  "testedExternalHeight", // AlturaExternaEnsayada
  "avgGrammage", // GramajePromedio
  "avgWeight", // PesoPromedio
  "compressionMax", // CompresionMaxima
  "compressionMin", // CompresionMinima
  "compressionAvg", // CompresionPromedio
  "cobbMax", // CobbMaximo
  "cobbMin", // CobbMinimo
  "cobbAvg", // CobbPromedio
  "avgBurst", // ReventamientoPromedio
] as const;

/** timestamptz + text pairs, four per lifecycle machine. */
const LIFECYCLE_PAIRS = [
  ["schedulingApprovedAt", "schedulingApprovedByUser"],
  ["schedulingCancelledAt", "schedulingCancelledByUser"],
  ["completedAt", "completedByUser"],
  ["completionCancelledAt", "completionCancelledByUser"],
  ["voidedAt", "voidedByUser"],
  ["voidCancelledAt", "voidCancelledByUser"],
] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("production_orders", function (table) {
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

    // Identification & quantities
    table.string("number", 400).notNullable(); // Numero
    table.timestamp("orderDate", { useTz: true }); // Fecha
    table.specificType("quantity", "double precision").notNullable(); // Cantidad
    table.timestamp("deliveryDate", { useTz: true }); // FechaEntrega
    table.text("notes"); // Observaciones

    // Plate / die flags (NuevoClise, NuevoCliseListo, NuevoTroquel, …)
    table.boolean("newPlate").notNullable().defaultTo(false);
    table.boolean("newPlateReady").notNullable().defaultTo(false);
    table.boolean("newDie").notNullable().defaultTo(false);
    table.boolean("newDieReady").notNullable().defaultTo(false);
    table.boolean("isSample").notNullable().defaultTo(false); // EsMuestra
    // Despachable is a nullable bool in the source dbml; null ≡ false
    // (Q-SCHEMA-3). The part-generation path never sets it.
    table.boolean("dispatchable").defaultTo(false);
    table.integer("lastLabelNumber"); // UltimoCartel

    for (const column of FLOAT_COLUMNS) {
      table.specificType(column, "double precision");
    }

    for (const [at, byUser] of LIFECYCLE_PAIRS) {
      table.timestamp(at, { useTz: true });
      // D-10: the approver is a username STRING snapshot, not a user FK — it
      // must survive the user's deletion, as `parts.partApprovalBy` does.
      table.text(byUser);
    }

    table
      .timestamp("createdAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.text("createdByUser"); // CreacionUsuario
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());
    table.integer("legacyId");

    // Foreign keys
    table
      .integer("partId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("parts")
      .onDelete("RESTRICT");
    table
      .integer("orderDataId")
      .unsigned()
      .references("id")
      .inTable("order_data")
      .onDelete("RESTRICT");
    table
      .integer("routeId")
      .unsigned()
      .references("id")
      .inTable("production_routes")
      .onDelete("RESTRICT");
    table
      .integer("palletizationId")
      .unsigned()
      .references("id")
      .inTable("palletizations")
      .onDelete("SET NULL");

    table.index(["companyId"]);
    table.index(["companyId", "number"]);
    table.index(["orderDataId"]);
    table.index(["partId"]);
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("production_orders");
}
