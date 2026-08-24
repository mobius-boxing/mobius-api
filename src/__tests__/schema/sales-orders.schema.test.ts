/**
 * AC-1 … AC-4, AC-17 — the sales_orders / order_data schema against a live
 * database.
 *
 * Like ownership.schema.test.ts this needs a database and there is none by
 * default (`.env` points at the deployed host), so it is guarded to
 * `localhost` and skips everywhere else. Run it with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production \
 *   npx jest src/__tests__/schema/sales-orders.schema.test.ts
 *
 * Every write happens inside a transaction that is ROLLED BACK (L-013).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** column → information_schema.data_type, per the spec's entity tables. */
const ORDER_DATA_COLUMNS: Record<string, string> = {
  id: "integer",
  uuid: "uuid",
  companyId: "integer",
  number: "character varying",
  quantity: "double precision",
  notes: "text",
  dispatchNotes: "text",
  conversionNotes: "text",
  deliveryLocationId: "integer",
  customerId: "integer",
  legacyId: "integer",
  createdAt: "timestamp with time zone",
  updatedAt: "timestamp with time zone",
};

const SALES_ORDER_COLUMNS: Record<string, string> = {
  id: "integer",
  uuid: "uuid",
  companyId: "integer",
  number: "character varying",
  quantity: "double precision",
  price: "numeric",
  paid: "numeric",
  deliveryDate: "timestamp with time zone",
  purchaseOrder: "text",
  stockOrder: "boolean",
  specialOrder: "boolean",
  needsAdvanceInvoice: "boolean",
  invoiceSent: "boolean",
  salesSector: "text",
  balancePercentage: "double precision",
  supplierCode: "text",
  createdBy: "text",
  fulfilledAt: "timestamp with time zone",
  fulfilledBy: "text",
  fulfillmentCancelledAt: "timestamp with time zone",
  fulfillmentCancelledBy: "text",
  commercialApprovedAt: "timestamp with time zone",
  commercialApprovedBy: "text",
  commercialCancelledAt: "timestamp with time zone",
  commercialCancelledBy: "text",
  financialApprovedAt: "timestamp with time zone",
  financialApprovedBy: "text",
  financialCancelledAt: "timestamp with time zone",
  financialCancelledBy: "text",
  voidedAt: "timestamp with time zone",
  voidedBy: "text",
  voidCancelledAt: "timestamp with time zone",
  voidCancelledBy: "text",
  creditLimitOverrideAt: "timestamp with time zone",
  creditLimitOverrideBy: "text",
  purchaseOrderImageFileUuid: "uuid",
  quotationFileUuid: "uuid",
  customerId: "integer",
  salesUserId: "integer",
  productId: "integer",
  partId: "integer",
  sheetSupplyId: "integer",
  orderDataId: "integer",
  quotationId: "integer",
  paymentTermId: "integer",
  currencyId: "integer",
  legacyId: "integer",
  createdAt: "timestamp with time zone",
  updatedAt: "timestamp with time zone",
};

describeIfLocalDb("sales_orders / order_data schema (AC-1…AC-4)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  const readColumns = async (
    table: string,
  ): Promise<Record<string, string>> => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
    }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.column_name, row.data_type]),
    );
  };

  it("gives order_data exactly its 13 physical columns with the spec's types (AC-1)", async () => {
    // The spec table has 12 rows because createdAt/updatedAt share one (R8).
    const live = await readColumns("order_data");
    expect(live).toEqual(ORDER_DATA_COLUMNS);
  });

  it("gives sales_orders the full plus_Pedidos column set (AC-1)", async () => {
    const live = await readColumns("sales_orders");
    expect(live).toEqual(SALES_ORDER_COLUMNS);
  });

  it("stores price/paid as numeric(18,4) and quantity as a float (AC-1, L-010)", async () => {
    const result = await client.query<{
      column_name: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>(
      `SELECT column_name, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sales_orders'
          AND column_name IN ('price', 'paid')`,
    );
    for (const row of result.rows) {
      expect(row.numeric_precision).toBe(18);
      expect(row.numeric_scale).toBe(4);
    }
    expect(result.rows).toHaveLength(2);
  });

  it("has no status column on either table (AC-17)", async () => {
    const [orderData, salesOrders] = await Promise.all([
      readColumns("order_data"),
      readColumns("sales_orders"),
    ]);
    expect(orderData).not.toHaveProperty("status");
    expect(salesOrders).not.toHaveProperty("status");
  });

  it("declares UNIQUE (companyId, number) on sales_orders (AC-2)", async () => {
    const result = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'sales_orders'::regclass AND contype = 'u'`,
    );
    const definitions = result.rows.map((row) => row.definition);
    expect(definitions).toContain('UNIQUE ("companyId", number)');
  });

  it("declares the TPH discriminator CHECK (AC-3)", async () => {
    const result = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'sales_orders'::regclass
          AND conname = 'sales_orders_tph_check'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].definition).toContain("num_nonnulls");
  });

  it("never uses ON DELETE CASCADE between sales_orders and order_data (AC-4, L-006)", async () => {
    const result = await client.query<{
      constraint_name: string;
      delete_rule: string;
    }>(
      `SELECT rc.constraint_name, rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.table_constraints tc
           ON tc.constraint_name = rc.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'sales_orders' AND ccu.table_name = 'order_data'`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.delete_rule).not.toBe("CASCADE");
    }
  });

  describe("constraint behaviour on real inserts (rolled back)", () => {
    let companyId: number;
    let customerId: number;
    let productId: number;

    beforeAll(async () => {
      const company = await client.query<{ id: number }>(
        `SELECT id FROM companies ORDER BY id LIMIT 1`,
      );
      companyId = company.rows[0]?.id;
      const customer = await client.query<{ id: number }>(
        `SELECT id FROM customers WHERE "companyId" = $1 ORDER BY id LIMIT 1`,
        [companyId],
      );
      customerId = customer.rows[0]?.id;
      const product = await client.query<{ id: number }>(
        `SELECT id FROM products WHERE "companyId" = $1 ORDER BY id LIMIT 1`,
        [companyId],
      );
      productId = product.rows[0]?.id;
    });

    /** Runs `body` in a transaction that is always rolled back (L-013). */
    const inRollback = async (
      body: (
        insert: (sql: string, params: any[]) => Promise<void>,
      ) => Promise<void>,
    ): Promise<void> => {
      await client.query("BEGIN");
      try {
        await body(async (sql, params) => {
          await client.query(sql, params);
        });
      } finally {
        await client.query("ROLLBACK");
      }
    };

    const insertOrder = (columns: string, values: string) =>
      `INSERT INTO sales_orders ("companyId", "customerId", "number", "quantity"${columns})
         VALUES ($1, $2, $3, 10${values})`;

    it("accepts exactly one TPH discriminator (AC-3)", async () => {
      expect(customerId).toBeDefined();
      expect(productId).toBeDefined();
      await inRollback(async (insert) => {
        await insert(insertOrder(', "productId"', ", $4"), [
          companyId,
          customerId,
          "TPHOK001",
          productId,
        ]);
      });
    });

    it("rejects productId AND partId together (AC-3)", async () => {
      await expect(
        inRollback(async (insert) => {
          const part = await client.query<{ id: number }>(
            `SELECT id FROM parts WHERE "companyId" = $1 ORDER BY id LIMIT 1`,
            [companyId],
          );
          // Use a literal id when no part exists — the CHECK fires on
          // non-nullness, and the FK is only evaluated after it passes.
          await insert(insertOrder(', "productId", "partId"', ", $4, $5"), [
            companyId,
            customerId,
            "TPHBAD01",
            productId,
            part.rows[0]?.id ?? 1,
          ]);
        }),
      ).rejects.toThrow(/sales_orders_tph_check/);
    });

    it("rejects an order with all three discriminators null (AC-3)", async () => {
      await expect(
        inRollback(async (insert) => {
          await insert(insertOrder("", ""), [
            companyId,
            customerId,
            "TPHBAD02",
          ]);
        }),
      ).rejects.toThrow(/sales_orders_tph_check/);
    });

    it("rejects a duplicate (companyId, number) with 23505 (AC-2)", async () => {
      await expect(
        inRollback(async (insert) => {
          await insert(insertOrder(', "productId"', ", $4"), [
            companyId,
            customerId,
            "DUPE0001",
            productId,
          ]);
          await insert(insertOrder(', "productId"', ", $4"), [
            companyId,
            customerId,
            "DUPE0001",
            productId,
          ]);
        }),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });
});
