/**
 * AC-5 / AC-6 / AC-14 — SalesOrderDAO against a REAL database.
 *
 * This is the only place the 1:1 transaction is proven end to end: the mocked
 * DAO test can show which statements are issued, not that the rows actually
 * land and actually disappear together (L-006). It is mutation-checked per
 * AC-26.
 *
 * Needs a database, and there is none by default (`.env` points at the
 * deployed host), so it is guarded to `localhost` and skips everywhere else.
 * Run it with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production \
 *   npx jest src/__tests__/schema/sales-order-lifecycle.db.test.ts
 *
 * Every row it inserts is deleted again in afterAll (L-013).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { connectAll, disconnectAll } from "../../database/registry";
import { SalesOrderDAO } from "../../dao/sales-order/sales-order.dao";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36).toUpperCase();

describeIfLocalDb("SalesOrderDAO lifecycle (AC-5, AC-6, AC-14)", () => {
  let client: Client;
  let dao: SalesOrderDAO;

  let companyId = 0;
  let customerId = 0;
  let productId = 0;
  let deliveryLocationId = 0;
  const orderUuids: string[] = [];

  beforeAll(async () => {
    client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
    await connectAll();
    dao = new SalesOrderDAO();

    const company = await client.query<{ id: number }>(
      `INSERT INTO companies (uuid, name, slug)
         VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [`SOTEST-${RUN}`, `sotest-${RUN.toLowerCase()}`],
    );
    companyId = company.rows[0].id;

    const customer = await client.query<{ id: number }>(
      `INSERT INTO customers (uuid, "companyId", name, code)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [companyId, `Cliente ${RUN}`, `SOC-${RUN}`],
    );
    customerId = customer.rows[0].id;

    const product = await client.query<{ id: number }>(
      `INSERT INTO products (uuid, "companyId", "customerId", code, description)
         VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [companyId, customerId, `SOP-${RUN}`, "Producto de prueba"],
    );
    productId = product.rows[0].id;

    const location = await client.query<{ id: number }>(
      `INSERT INTO delivery_locations (uuid, "companyId", "customerId", address)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [companyId, customerId, `Calle ${RUN}`],
    );
    deliveryLocationId = location.rows[0].id;
  }, 60000);

  afterAll(async () => {
    // L-013: leave the database exactly as it was found.
    try {
      for (const uuid of orderUuids) {
        const found = await client.query<{ orderDataId: number | null }>(
          `SELECT "orderDataId" FROM sales_orders WHERE uuid = $1`,
          [uuid],
        );
        await client.query(`DELETE FROM sales_orders WHERE uuid = $1`, [uuid]);
        const orderDataId = found.rows[0]?.orderDataId;
        if (orderDataId) {
          await client.query(`DELETE FROM order_data WHERE id = $1`, [
            orderDataId,
          ]);
        }
      }
      await client.query(`DELETE FROM order_data WHERE "companyId" = $1`, [
        companyId,
      ]);
      await client.query(`DELETE FROM code_sequences WHERE "companyId" = $1`, [
        companyId,
      ]);
      // companies cascades products / customers / delivery_locations.
      await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    } finally {
      await client.end();
      await disconnectAll();
    }
  }, 60000);

  const createOrder = async (overrides: Record<string, unknown> = {}) => {
    const order = await dao.create({
      companyId,
      customerId,
      productId,
      quantity: 100,
      ...overrides,
    });
    if (order.uuid) orderUuids.push(order.uuid);
    return order;
  };

  it("assigns an 8-digit number from the sales-order counter (AC-5)", async () => {
    const order = await createOrder();

    expect(order.number).toMatch(/^\d{8}$/);
  });

  it("gives the next order exactly previous + 1, zero-padded (AC-5)", async () => {
    const first = await createOrder();
    const second = await createOrder();

    expect(Number(second.number)).toBe(Number(first.number) + 1);
    expect(second.number).toMatch(/^\d{8}$/);
    expect(second.number).toHaveLength(8);
  });

  it("keeps exactly one code_sequences row for scope 'sales-order' (AC-5)", async () => {
    await createOrder();

    const rows = await client.query<{ count: string }>(
      `SELECT count(*) FROM code_sequences
        WHERE "companyId" = $1 AND scope = 'sales-order'`,
      [companyId],
    );
    expect(rows.rows[0].count).toBe("1");
  });

  it("writes one linked order_data row mirroring the order (AC-6)", async () => {
    const order = await createOrder({
      quantity: 250,
      orderDataInput: {
        notes: "obs",
        dispatchNotes: "desp",
        conversionNotes: "conv",
        deliveryLocationId,
      },
    });

    const row = await client.query<{
      number: string;
      quantity: number;
      customerId: number;
      deliveryLocationId: number;
      notes: string;
      dispatchNotes: string;
      conversionNotes: string;
    }>(
      `SELECT od.number, od.quantity, od."customerId", od."deliveryLocationId",
              od.notes, od."dispatchNotes", od."conversionNotes"
         FROM sales_orders so
         JOIN order_data od ON od.id = so."orderDataId"
        WHERE so.uuid = $1`,
      [order.uuid],
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toEqual({
      number: order.number,
      quantity: 250,
      customerId,
      deliveryLocationId,
      notes: "obs",
      dispatchNotes: "desp",
      conversionNotes: "conv",
    });
  });

  it("mirrors an updated quantity into order_data in the same request (AC-13)", async () => {
    const order = await createOrder({ quantity: 10 });
    const id = (await dao.getIdByUuid(order.uuid!))!;

    await dao.update(id, { quantity: 77 });

    const row = await client.query<{ quantity: number }>(
      `SELECT od.quantity FROM sales_orders so
         JOIN order_data od ON od.id = so."orderDataId"
        WHERE so.uuid = $1`,
      [order.uuid],
    );
    expect(row.rows[0].quantity).toBe(77);
  });

  it("deletes both rows and leaves zero orphans (AC-14, L-006)", async () => {
    const order = await createOrder();
    const before = await client.query<{ orderDataId: number }>(
      `SELECT "orderDataId" FROM sales_orders WHERE uuid = $1`,
      [order.uuid],
    );
    const orderDataId = before.rows[0].orderDataId;
    const id = (await dao.getIdByUuid(order.uuid!))!;

    expect(await dao.delete(id)).toBe(true);

    const orders = await client.query<{ count: string }>(
      `SELECT count(*) FROM sales_orders WHERE uuid = $1`,
      [order.uuid],
    );
    const orderData = await client.query<{ count: string }>(
      `SELECT count(*) FROM order_data WHERE id = $1`,
      [orderDataId],
    );
    expect(orders.rows[0].count).toBe("0");
    expect(orderData.rows[0].count).toBe("0");
  });
});
