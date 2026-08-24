import type { Knex } from "knex";

/**
 * sales_orders — Procusto `plus_Pedidos` (module 18 sub-area D,
 * 01-entities-schema.md:643-686), full column set including all nine
 * timestamptz + user audit pairs. No DB enum for the lifecycle: the four
 * approve/cancel machines stay raw column pairs and `status` is DERIVED in the
 * DTO (04-state-machines.md:65-70).
 *
 * order_data — Procusto `DatosPedidos` (module 03 §10), the production-side
 * header carried 1:1 from the order. Created FIRST because sales_orders
 * references it.
 *
 * DELETION (L-006): there is deliberately NO `ON DELETE CASCADE` between the
 * two tables. `SalesOrderDAO.delete` removes both rows in one transaction; a
 * cascade would bypass that single strategy.
 *
 * Money is numeric(18,4); `quantity` stays `double precision` — it is
 * Procusto's plain `double Cantidad` (Pedido.cs:19), not an inventory value
 * object, and IEEE-754 columns keep their type for parity (L-010).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("order_data", function (table) {
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

    // Mirrors of the order's own values (Editar.cs:59 and :164).
    table.string("number", 400);
    table
      .specificType("quantity", "double precision")
      .notNullable()
      .defaultTo(0);

    table.text("notes"); // Observaciones
    table.text("dispatchNotes"); // ObservacionesDeDespacho
    table.text("conversionNotes"); // ObservacionesConversion

    table
      .integer("deliveryLocationId")
      .unsigned()
      .references("id")
      .inTable("delivery_locations")
      .onDelete("SET NULL");
    // Mobius denormalization (datos-pedidos.md:104-106, Q-03-06): nullable in
    // the column but always written by the API.
    table
      .integer("customerId")
      .unsigned()
      .references("id")
      .inTable("customers")
      .onDelete("RESTRICT");

    table.integer("legacyId");
    table
      .timestamp("createdAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp("updatedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["customerId"]);
    table.index(["deliveryLocationId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable("sales_orders", function (table) {
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
    table.string("number", 400).notNullable(); // Numero, 8-digit zero-padded
    table
      .specificType("quantity", "double precision")
      .notNullable()
      .defaultTo(0);
    table.decimal("price", 18, 4); // Precio — UNIT price (Q-1)
    table.decimal("paid", 18, 4); // Pagado — total paid

    table.timestamp("deliveryDate", { useTz: true }); // FechaEntrega
    table.text("purchaseOrder"); // OrdenDeCompra
    table.boolean("stockOrder").notNullable().defaultTo(false); // PedidoStock
    table.boolean("specialOrder").notNullable().defaultTo(false); // PedidoEspecial
    table.boolean("needsAdvanceInvoice"); // NecesitaFacturaAnticipada
    table.boolean("invoiceSent"); // FacturaEnviada
    table.text("salesSector"); // SectorVentas (permission-gated)
    // D-3: the legacy DB column is `CodigoExterno`, but PedidoMapper.cs:52/:89
    // stores the domain's `PorcentajeSaldo` in it. ETL maps
    // CodigoExterno → balancePercentage.
    table.specificType("balancePercentage", "double precision");
    table.text("supplierCode"); // CodigoProveedor

    // Creation audit (Creacion → createdAt, CreacionUsuario → createdBy)
    table.text("createdBy");

    // The nine lifecycle pairs — columns only; no endpoint writes them here.
    table.timestamp("fulfilledAt", { useTz: true });
    table.text("fulfilledBy");
    table.timestamp("fulfillmentCancelledAt", { useTz: true });
    table.text("fulfillmentCancelledBy");
    table.timestamp("commercialApprovedAt", { useTz: true });
    table.text("commercialApprovedBy");
    table.timestamp("commercialCancelledAt", { useTz: true });
    table.text("commercialCancelledBy");
    table.timestamp("financialApprovedAt", { useTz: true });
    table.text("financialApprovedBy");
    table.timestamp("financialCancelledAt", { useTz: true });
    table.text("financialCancelledBy");
    table.timestamp("voidedAt", { useTz: true });
    table.text("voidedBy");
    table.timestamp("voidCancelledAt", { useTz: true });
    table.text("voidCancelledBy");
    table.timestamp("creditLimitOverrideAt", { useTz: true });
    table.text("creditLimitOverrideBy");

    // File handles (files.uuid) — columns only, no endpoint touches them.
    table.uuid("purchaseOrderImageFileUuid"); // ImagenOCId
    table.uuid("quotationFileUuid"); // ArchivoCotizacionId

    // Foreign keys
    table
      .integer("customerId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("customers")
      .onDelete("RESTRICT");
    table
      .integer("salesUserId")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table
      .integer("productId")
      .unsigned()
      .references("id")
      .inTable("products")
      .onDelete("RESTRICT");
    table
      .integer("partId")
      .unsigned()
      .references("id")
      .inTable("parts")
      .onDelete("RESTRICT");
    // TODO(sheet-supplies): FK to the Plancha table when it lands.
    table.integer("sheetSupplyId");
    // 1:1 with order_data. RESTRICT, never CASCADE — see the header (L-006).
    table
      .integer("orderDataId")
      .unsigned()
      .unique()
      .references("id")
      .inTable("order_data")
      .onDelete("RESTRICT");
    // TODO(quoting): FK to quotations when the quoting module lands (Q-4).
    table.integer("quotationId");
    // TODO(payment-terms): FK to payment_terms when that module lands.
    table.integer("paymentTermId");
    // TODO(currencies): FK to currencies when that module lands.
    table.integer("currencyId");

    table.integer("legacyId");
    table
      .timestamp("createdAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp("updatedAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(["companyId", "number"]);
    table.index(["companyId"]);
    table.index(["customerId"]);
    table.index(["productId"]);
    table.index(["salesUserId"]);
    table.index(["deliveryDate"]);
    table.index(["legacyId"]);
  });

  // TPH discriminator (PedidoMapper.cs:147-166): exactly one of the three.
  await knex.raw(
    `ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_tph_check
       CHECK (num_nonnulls("productId", "partId", "sheetSupplyId") = 1)`,
  );
  await knex.raw(
    `CREATE INDEX idx_sales_orders_commercial_approved_at ON sales_orders ("commercialApprovedAt") WHERE "commercialApprovedAt" IS NOT NULL`,
  );
  await knex.raw(
    `CREATE INDEX idx_sales_orders_voided_at ON sales_orders ("voidedAt") WHERE "voidedAt" IS NOT NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("sales_orders");
  await knex.schema.dropTableIfExists("order_data");
}
