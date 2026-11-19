/**
 * terminadora-order-flow schema (docs/dev/terminadora-order-flow/model.md
 * §Persistence). Shared by the tenant migration and its core mirror (pattern:
 * `corrugator-planning-schema.ts`).
 *
 * Expand-only, one deploy: two additive columns, one index and five tables
 * created from scratch; the only data write is the idempotent `isSupplier`
 * backfill. Every step guards on `hasColumn`/`hasTable` so re-running the body
 * (core mirror against a database that already has it) is a no-op.
 */
import type { Knex } from "knex";
import { attachAudit } from "./audit-triggers";

function idColumns(knex: Knex, table: Knex.CreateTableBuilder): void {
  table.increments("id").primary();
  table
    .uuid("uuid")
    .unique()
    .notNullable()
    .defaultTo(knex.raw("gen_random_uuid()"));
  // Tenant DBs never hold `companies`: companyId is a plain indexed integer.
  table.integer("companyId").unsigned().notNullable();
  table.index(["companyId"]);
}

function withTimestamps(knex: Knex, table: Knex.CreateTableBuilder): void {
  table
    .timestamp("createdAt", { useTz: true })
    .notNullable()
    .defaultTo(knex.fn.now());
  table
    .timestamp("updatedAt", { useTz: true })
    .notNullable()
    .defaultTo(knex.fn.now());
}

export async function addSupplierColumns(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("machine_types", "isSupplier"))) {
    await knex.schema.alterTable("machine_types", (table) => {
      table.boolean("isSupplier").notNullable().defaultTo(false);
    });
  }
  await knex.raw(
    `UPDATE machine_types SET "isSupplier" = true
      WHERE lower(trim(name)) IN ('proveedor', 'proveedores')
        AND "isSupplier" = false`,
  );

  if (!(await knex.schema.hasColumn("machines", "supplierId"))) {
    await knex.schema.alterTable("machines", (table) => {
      table
        .integer("supplierId")
        .unsigned()
        .references("id")
        .inTable("suppliers")
        .onDelete("SET NULL");
      table.index(["supplierId"]);
    });
  }

  // `sales_orders.quotationId` stays FK-less on purpose (D-4): imported
  // tenants may hold legacy Procusto ids there.
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS "sales_orders_quotationid_index" ON sales_orders ("quotationId")`,
  );
}

export async function createProductStockTable(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("product_stock"))) {
    await knex.schema.createTable("product_stock", (table) => {
      idColumns(knex, table);
      table
        .integer("warehouseId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("warehouses")
        .onDelete("RESTRICT");
      table
        .integer("productId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("products")
        .onDelete("RESTRICT");
      table
        .integer("productionOrderId")
        .unsigned()
        .references("id")
        .inTable("production_orders")
        .onDelete("SET NULL");
      table.integer("quantity").notNullable().defaultTo(0);
      table.text("comments");
      withTimestamps(knex, table);

      table.index(["warehouseId"]);
      table.index(["productId"]);
      table.index(["productionOrderId"]);
    });
    await knex.raw(
      `ALTER TABLE product_stock ADD CONSTRAINT product_stock_quantity_check CHECK ("quantity" >= 0)`,
    );
  }
  await attachAudit(knex, "product_stock");
}

export async function createQuotationsTable(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("quotations"))) {
    await knex.schema.createTable("quotations", (table) => {
      idColumns(knex, table);
      table.integer("number").notNullable();
      table
        .integer("customerId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("customers")
        .onDelete("RESTRICT");
      table
        .integer("productId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("products")
        .onDelete("RESTRICT");
      table.specificType("quantity", "double precision").notNullable();
      table.decimal("price", 18, 4).notNullable();
      table.timestamp("deliveryDate", { useTz: true });
      table.integer("salesUserId").unsigned();
      table.text("notes");
      table.text("status").notNullable().defaultTo("draft");
      table.timestamp("approvedAt", { useTz: true });
      table.text("approvedByUser");
      table
        .integer("salesOrderId")
        .unsigned()
        .unique()
        .references("id")
        .inTable("sales_orders")
        .onDelete("SET NULL");
      table.text("createdByUser");
      withTimestamps(knex, table);

      table.unique(["companyId", "number"]);
      table.index(["customerId"]);
      table.index(["productId"]);
      table.index(["salesUserId"]);
      table.index(["companyId", "status"]);
    });
    await knex.raw(
      `ALTER TABLE quotations
         ADD CONSTRAINT quotations_quantity_check CHECK ("quantity" > 0),
         ADD CONSTRAINT quotations_price_check CHECK ("price" >= 0),
         ADD CONSTRAINT quotations_status_check
           CHECK ("status" IN ('draft', 'informed', 'accepted', 'rejected'))`,
    );
  }
  await attachAudit(knex, "quotations");
}

export async function createSupplierPurchaseOrdersTable(
  knex: Knex,
): Promise<void> {
  if (!(await knex.schema.hasTable("supplier_purchase_orders"))) {
    await knex.schema.createTable("supplier_purchase_orders", (table) => {
      idColumns(knex, table);
      table.integer("number").notNullable();
      table
        .integer("machineId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("machines")
        .onDelete("RESTRICT");
      table
        .integer("supplierId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("suppliers")
        .onDelete("RESTRICT");
      table.text("status").notNullable().defaultTo("draft");
      table.text("notes");
      table.timestamp("sentAt", { useTz: true });
      table.text("sentByUser");
      table.timestamp("completedAt", { useTz: true });
      table.text("createdByUser");
      withTimestamps(knex, table);

      table.unique(["companyId", "number"]);
      table.index(["machineId"]);
      table.index(["supplierId"]);
      table.index(["companyId", "status"]);
    });
    await knex.raw(
      `ALTER TABLE supplier_purchase_orders
         ADD CONSTRAINT supplier_purchase_orders_status_check
           CHECK ("status" IN ('draft', 'sent', 'completed'))`,
    );
  }
  await attachAudit(knex, "supplier_purchase_orders");
}

const LINE_PARENT = {
  parent: "supplier_purchase_orders",
  fk: "purchaseOrderId",
};

export async function createSupplierPurchaseOrderLinesTable(
  knex: Knex,
): Promise<void> {
  if (!(await knex.schema.hasTable("supplier_purchase_order_lines"))) {
    await knex.schema.createTable("supplier_purchase_order_lines", (table) => {
      idColumns(knex, table);
      table
        .integer("purchaseOrderId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("supplier_purchase_orders")
        .onDelete("CASCADE");
      // D-13: one line per production order, ever.
      table
        .integer("productionOrderId")
        .unsigned()
        .notNullable()
        .unique()
        .references("id")
        .inTable("production_orders")
        .onDelete("RESTRICT");
      table.integer("position").notNullable();
      table.integer("quantity").notNullable();
      table.timestamp("deliveryDate", { useTz: true });
      table.text("orderNumber");
      table.text("boardCode");
      table.specificType("sheetLength", "double precision");
      table.specificType("sheetWidth", "double precision");
      table.text("scoreLines");
      table.integer("receivedQuantity").notNullable().defaultTo(0);
      table.timestamp("completedAt", { useTz: true });
      table.text("completedByUser");
      withTimestamps(knex, table);

      table.index(["purchaseOrderId"]);
      table.unique(["purchaseOrderId", "position"]);
    });
    await knex.raw(
      `ALTER TABLE supplier_purchase_order_lines
         ADD CONSTRAINT supplier_purchase_order_lines_quantity_check CHECK ("quantity" > 0)`,
    );
  }
  await attachAudit(knex, "supplier_purchase_order_lines", {
    parent: LINE_PARENT,
  });
}

export async function createSupplierReceiptsTable(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("supplier_receipts"))) {
    await knex.schema.createTable("supplier_receipts", (table) => {
      idColumns(knex, table);
      table
        .integer("lineId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("supplier_purchase_order_lines")
        .onDelete("RESTRICT");
      table.integer("quantity").notNullable();
      table
        .timestamp("receivedAt", { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      table.text("receivedByUser").notNullable();
      table
        .integer("warehouseId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("warehouses")
        .onDelete("RESTRICT");
      table
        .integer("productStockId")
        .unsigned()
        .notNullable()
        .unique()
        .references("id")
        .inTable("product_stock")
        .onDelete("RESTRICT");
      table.text("notes");
      table
        .timestamp("createdAt", { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table.index(["lineId"]);
      table.index(["warehouseId"]);
    });
    await knex.raw(
      `ALTER TABLE supplier_receipts
         ADD CONSTRAINT supplier_receipts_quantity_check CHECK ("quantity" > 0)`,
    );
  }
  await attachAudit(knex, "supplier_receipts", {
    parent: {
      parent: "supplier_purchase_order_lines",
      fk: "lineId",
      grand: "supplier_purchase_orders",
      grandFk: "purchaseOrderId",
    },
  });
}

export async function up(knex: Knex): Promise<void> {
  await addSupplierColumns(knex);
  await createProductStockTable(knex);
  await createQuotationsTable(knex);
  await createSupplierPurchaseOrdersTable(knex);
  await createSupplierPurchaseOrderLinesTable(knex);
  await createSupplierReceiptsTable(knex);
}

/**
 * Round 2 (docs/dev/terminadora-order-flow/model-r2.md). Additive columns and
 * one table; `product_stock.quantity` is widened so it can hold product units
 * (receipt.quantity / line.sheetsPerUnit, no rounding — I-22). The widening
 * lives here rather than in the migration file because it is lossless for the
 * round-1 image, which only ever wrote whole numbers.
 */
export async function applyRound2(knex: Knex): Promise<void> {
  if (
    !(await knex.schema.hasColumn(
      "supplier_purchase_order_lines",
      "sheetsPerUnit",
    ))
  ) {
    await knex.schema.alterTable("supplier_purchase_order_lines", (table) => {
      table.specificType("sheetsPerUnit", "double precision");
    });
    await knex.raw(
      `ALTER TABLE supplier_purchase_order_lines
         ADD CONSTRAINT supplier_purchase_order_lines_sheetsperunit_check
           CHECK ("sheetsPerUnit" IS NULL OR "sheetsPerUnit" > 0)`,
    );
  }

  if (!(await knex.schema.hasColumn("supplier_receipts", "unitQuantity"))) {
    await knex.schema.alterTable("supplier_receipts", (table) => {
      table.specificType("unitQuantity", "double precision");
    });
    // Receipts that predate the conversion were stock in sheets: one sheet per unit.
    await knex.raw(
      `UPDATE supplier_receipts SET "unitQuantity" = "quantity" WHERE "unitQuantity" IS NULL`,
    );
    await knex.raw(
      `ALTER TABLE supplier_receipts
         ALTER COLUMN "unitQuantity" SET NOT NULL,
         ADD CONSTRAINT supplier_receipts_unitquantity_check CHECK ("unitQuantity" > 0)`,
    );
  }

  await knex.raw(
    `DO $$
     BEGIN
       IF (SELECT data_type FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'product_stock' AND column_name = 'quantity') = 'integer' THEN
         ALTER TABLE product_stock ALTER COLUMN "quantity" TYPE double precision;
       END IF;
     END $$`,
  );

  if (!(await knex.schema.hasTable("order_deliveries"))) {
    await knex.schema.createTable("order_deliveries", (table) => {
      idColumns(knex, table);
      table
        .integer("quotationId")
        .unsigned()
        .references("id")
        .inTable("quotations")
        .onDelete("CASCADE");
      table
        .integer("salesOrderId")
        .unsigned()
        .references("id")
        .inTable("sales_orders")
        .onDelete("CASCADE");
      table.integer("position").notNullable();
      table.timestamp("deliveryDate", { useTz: true }).notNullable();
      table
        .integer("deliveryLocationId")
        .unsigned()
        .references("id")
        .inTable("delivery_locations")
        .onDelete("SET NULL");
      table.text("amountType").notNullable();
      table.specificType("amount", "double precision").notNullable();
      withTimestamps(knex, table);

      table.index(["quotationId"]);
      table.index(["salesOrderId"]);
      table.index(["deliveryLocationId"]);
    });
    await knex.raw(
      `ALTER TABLE order_deliveries
         ADD CONSTRAINT order_deliveries_one_parent_check
           CHECK (num_nonnulls("quotationId", "salesOrderId") = 1),
         ADD CONSTRAINT order_deliveries_amount_type_check
           CHECK ("amountType" IN ('quantity', 'percentage')),
         ADD CONSTRAINT order_deliveries_amount_check
           CHECK ("amount" > 0 AND ("amountType" = 'quantity' OR "amount" <= 100))`,
    );
  }
  await attachAudit(knex, "order_deliveries");
}
