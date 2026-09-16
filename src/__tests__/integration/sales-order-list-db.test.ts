/**
 * The pedido list against a REAL database — the edge fixtures no HTTP call can
 * build: a plancha-typed pedido (the create endpoint only makes product-typed
 * ones), a pedido whose `orderDataId` is NULL, and a
 * production order that is voided but NOT completed.
 *
 * Covers AC-8, AC-9, AC-14, AC-15(c), AC-26 and AC-34 of sales-order-list.
 *
 * Needs a database, and there is none by default (`.env` points at the deployed
 * host), so it is guarded to `localhost` and skips everywhere else. Run it
 * with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production \
 *   npx jest src/__tests__/integration/sales-order-list-db.test.ts
 *
 * Every row it inserts is deleted again in afterAll (L-013); every assertion
 * runs before teardown (L-017).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Request } from "express";
import { Client } from "pg";
import {
  connectAll,
  disconnectAll,
  rawCoreInstance,
  withTenantTarget,
} from "../../database/registry";
import { SalesOrderDAO } from "../../dao/sales-order/sales-order.dao";
import { UNRESOLVED_COMPANY } from "../../utils/daoScope";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36).toUpperCase();
/** A delivery instant with a TIME on it — 15:00 UTC on the 31st. */
const MIDDAY = "2026-03-31T15:00:00.000Z";
const req = (query: Record<string, string>) =>
  ({ query }) as unknown as Request;

describeIfLocalDb(
  "Pedido list against the database (AC-8, AC-9, AC-14…)",
  () => {
    let client: Client;
    let dao: SalesOrderDAO;

    let companyId = 0;
    let productUuid = "";
    let sheetUuid = "";

    let middayProductUuid = "";

    /** Pedido UUIDs by TPH subtype, plus the mid-day delivery fixture. */
    const orders: Record<
      "product" | "voided" | "sheet" | "midday",
      string
    > = {
      product: "",
      voided: "",
      sheet: "",
      midday: "",
    };

    const one = async <T extends Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T> => {
      const result = await client.query<T>(sql, params);
      return result.rows[0];
    };

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

      const company = await one<{ id: number; uuid: string }>(
        `INSERT INTO companies (uuid, name, slug)
         VALUES (gen_random_uuid(), $1, $2) RETURNING id, uuid`,
        [`SOLIST-${RUN}`, `solist-${RUN.toLowerCase()}`],
      );
      companyId = company.id;

      const customer = await one<{ id: number }>(
        `INSERT INTO customers (uuid, "companyId", name, code)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
        [companyId, `Cliente ${RUN}`, `SOLC-${RUN}`],
      );
      const product = await one<{ id: number; uuid: string }>(
        `INSERT INTO products (uuid, "companyId", "customerId", code, description, revision)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 3) RETURNING id, uuid`,
        [companyId, customer.id, `SOLP-${RUN}`, "Caja exportación"],
      );
      productUuid = product.uuid;

      const sheet = await one<{ id: number; uuid: string }>(
        `INSERT INTO paper_sheets (uuid, "companyId", code, name, description)
         VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id, uuid`,
        [companyId, `SOLPL-${RUN}`, `Plancha ${RUN}`, "Plancha doble B"],
      );
      sheetUuid = sheet.uuid;

      /** One order_data header per pedido that owns production orders. */
      const orderData = async (number: string) =>
        (
          await one<{ id: number }>(
            `INSERT INTO order_data (uuid, "companyId", "customerId", number, quantity)
             VALUES (gen_random_uuid(), $1, $2, $3, 100) RETURNING id`,
            [companyId, customer.id, number],
          )
        ).id;

      const salesOrder = async (
        number: string,
        columns: string,
        values: unknown[],
      ) =>
        (
          await one<{ uuid: string }>(
            `INSERT INTO sales_orders (uuid, "companyId", "customerId", number, quantity${columns})
             VALUES (gen_random_uuid(), $1, $2, $3, 100${values
               .map((_, index) => `, $${index + 4}`)
               .join("")}) RETURNING uuid`,
            [companyId, customer.id, number, ...values],
          )
        ).uuid;

      // (a) product-typed, one COMPLETED production order.
      const productOrderData = await orderData(`${RUN}-PROD`);
      orders.product = await salesOrder(
        `${RUN}-PROD`,
        `, "productId", "orderDataId"`,
        [product.id, productOrderData],
      );
      await client.query(
        `INSERT INTO production_orders (uuid, "companyId", "productId", "orderDataId", number,
                                      quantity, "completedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 100, now())`,
        [companyId, product.id, productOrderData, `${RUN}-OP-DONE`],
      );

      // (b) a second product-typed pedido whose only production order is
      // VOIDED but not completed — voided ≠ cumplida (OrdenDeProduccion.cs:112).
      // It sits on its own product so the productUuid filter stays single-row.
      const voidedProduct = await one<{ id: number }>(
        `INSERT INTO products (uuid, "companyId", "customerId", code, description, revision)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 1) RETURNING id`,
        [companyId, customer.id, `SOLPV-${RUN}`, "Tapa reforzada"],
      );
      const voidedOrderData = await orderData(`${RUN}-VOID`);
      orders.voided = await salesOrder(
        `${RUN}-VOID`,
        `, "productId", "orderDataId"`,
        [voidedProduct.id, voidedOrderData],
      );
      await client.query(
        `INSERT INTO production_orders (uuid, "companyId", "productId", "orderDataId", number,
                                      quantity, "completedAt", "voidedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 100, NULL, now())`,
        [companyId, voidedProduct.id, voidedOrderData, `${RUN}-OP-VOID`],
      );

      // (c) plancha-typed, `orderDataId` NULL — the "no orders" edge case.
      orders.sheet = await salesOrder(`${RUN}-SHEET`, `, "sheetSupplyId"`, [
        sheet.id,
      ]);

      // (d) a pedido delivered at MIDDAY, on its own product so the productUuid
      // fixtures above stay single-row. Every other fixture in every suite is
      // midnight UTC, which is exactly what hid the `deliveryDateTo` bug.
      const product2 = await one<{ id: number; uuid: string }>(
        `INSERT INTO products (uuid, "companyId", "customerId", code, description, revision)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 1) RETURNING id, uuid`,
        [companyId, customer.id, `SOLP2-${RUN}`, "Caja mediodía"],
      );
      middayProductUuid = product2.uuid;
      const middayOrderData = await orderData(`${RUN}-MIDDAY`);
      orders.midday = await salesOrder(
        `${RUN}-MIDDAY`,
        `, "productId", "orderDataId", "deliveryDate"`,
        [product2.id, middayOrderData, MIDDAY],
      );
      // One OPEN production order, so this fixture falls outside BOTH order
      // filters and leaves their expectations above single-row.
      await client.query(
        `INSERT INTO production_orders (uuid, "companyId", "productId", "orderDataId", number,
                                      quantity, "completedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 100, NULL)`,
        [companyId, product2.id, middayOrderData, `${RUN}-OP-OPEN`],
      );
    }, 60000);

    afterAll(async () => {
      // L-013: leave the database exactly as it was found. `companies` cascades
      // customers / products / paper_sheets;
      // the two order tables are RESTRICT, so they go by hand, orders first.
      // The deletes write no ledger rows (audit_skip on this dedicated session),
      // and the `Alta` rows the fixtures wrote go last, through the same
      // maintenance door `purgeCompany` uses.
      try {
        await client.query(
          `SELECT set_config('mobius.audit_skip', 'on', false)`,
        );
        await client.query(
          `DELETE FROM production_orders WHERE "companyId" = $1`,
          [companyId],
        );
        await client.query(`DELETE FROM sales_orders WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(`DELETE FROM order_data WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(
          `DELETE FROM code_sequences WHERE "companyId" = $1`,
          [companyId],
        );
        await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
        await client.query("BEGIN");
        await client.query(`SET LOCAL mobius.audit_maintenance = 'on'`);
        await client.query(`DELETE FROM audit_logs WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query("COMMIT");
      } finally {
        await client.end();
        await disconnectAll();
      }
    }, 60000);

    /**
     * db-per-company (T8, AC-49): `db("tenant")` outside a request now
     * requires an explicit scope. `SalesOrderDAO` is called here directly
     * (never through real middleware), so every test needs this.
     */
    const runAsCoreTenant = <T>(fn: () => Promise<T>): Promise<T> =>
      withTenantTarget(
        { physicalKey: "core", instance: rawCoreInstance() },
        fn,
      );

    /** Every pedido of the fixture company that matches `query`, by number. */
    const numbersFor = async (query: Record<string, string>) => {
      const result = await dao.getAllWithFilters(
        req({ limit: "100", ...query }),
        companyId,
      );
      // The count query must agree with the data query (AC-18).
      expect(result.totalCount).toBe(result.data.length);
      return result.data.map((order) => order.number);
    };

    it("has no sales_orders.partId column after the contract migration", async () => {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sales_orders'
            AND column_name = 'partId'`,
      );
      expect(result.rows).toEqual([]);
    });

    it("returns only the plancha pedido for sheetSupplyUuid (AC-9, F-1)", () =>
      runAsCoreTenant(async () => {
        expect(await numbersFor({ sheetSupplyUuid: sheetUuid })).toEqual([
          `${RUN}-SHEET`,
        ]);
      }));

    it("returns only the product pedido for productUuid (AC-7)", () =>
      runAsCoreTenant(async () => {
        expect(await numbersFor({ productUuid })).toEqual([`${RUN}-PROD`]);
      }));

    it("treats orderDataId = NULL as 'sin órdenes' (AC-14)", () =>
      runAsCoreTenant(async () => {
        expect(await numbersFor({ withoutProductionOrders: "true" })).toEqual([
          `${RUN}-SHEET`,
        ]);
      }));

    it("excludes a pedido whose only OP is voided-and-uncompleted (AC-15c)", () =>
      runAsCoreTenant(async () => {
        const numbers = await numbersFor({
          allProductionOrdersFulfilled: "true",
        });

        expect(numbers).toEqual([`${RUN}-PROD`]);
        expect(numbers).not.toContain(`${RUN}-VOID`);
      }));

    it("returns the UNION of both order filters when both are true (AC-16)", () =>
      runAsCoreTenant(async () => {
        const numbers = await numbersFor({
          withoutProductionOrders: "true",
          allProductionOrdersFulfilled: "true",
        });

        expect([...numbers].sort()).toEqual([`${RUN}-PROD`, `${RUN}-SHEET`]);
      }));

    it("includes a mid-day pedido in an INCLUSIVE date-only upper bound (AC-13)", () =>
      runAsCoreTenant(async () => {
        // `deliveryDateTo=2026-03-31` parses as midnight, so a bare `<=` drops a
        // pedido delivered at 15:00 that same day — a range the user reads as
        // "up to and including the 31st" silently losing rows.
        expect(
          await numbersFor({
            productUuid: middayProductUuid,
            deliveryDateFrom: "2026-03-01",
            deliveryDateTo: "2026-03-31",
          }),
        ).toEqual([`${RUN}-MIDDAY`]);
      }));

    it("still excludes a pedido past the upper bound (AC-13)", () =>
      runAsCoreTenant(async () => {
        expect(
          await numbersFor({
            productUuid: middayProductUuid,
            deliveryDateTo: "2026-03-30",
          }),
        ).toEqual([]);
        expect(
          await numbersFor({
            productUuid: middayProductUuid,
            deliveryDateFrom: "2026-04-01",
          }),
        ).toEqual([]);
      }));

    it("honours a time-bearing upper bound to the second (AC-13)", () =>
      runAsCoreTenant(async () => {
        expect(
          await numbersFor({
            productUuid: middayProductUuid,
            deliveryDateTo: "2026-03-31T15:00:00.000Z",
          }),
        ).toEqual([`${RUN}-MIDDAY`]);
        expect(
          await numbersFor({
            productUuid: middayProductUuid,
            deliveryDateTo: "2026-03-31T14:59:59.000Z",
          }),
        ).toEqual([]);
      }));

    it("ignores the internal numeric id filters on both queries", () =>
      runAsCoreTenant(async () => {
        // They are not query params any more: `?customerId=…` is an unknown key
        // the shared builder drops, so the list is unfiltered — data AND count
        // alike (numbersFor asserts the two agree).
        const all = await numbersFor({});

        for (const param of [
          "customerId",
          "productId",
          "sheetSupplyId",
          "salesUserId",
        ]) {
          expect(await numbersFor({ [param]: "999999" })).toEqual(all);
        }
      }));

    it("builds the item descriptions from the real joined rows (AC-34, D-1: parte branch gone)", () =>
      runAsCoreTenant(async () => {
        const result = await dao.getAllWithFilters(
          req({ limit: "100" }),
          companyId,
        );
        const byNumber = new Map(
          result.data.map((order) => [order.number, order.itemDescription]),
        );

        expect(byNumber.get(`${RUN}-PROD`)).toBe(
          `Producto: SOLP-${RUN} - Caja exportación - Revisión: 3`,
        );
        expect(byNumber.get(`${RUN}-VOID`)).toBe(
          `Producto: SOLPV-${RUN} - Tapa reforzada - Revisión: 1`,
        );
        expect(byNumber.get(`${RUN}-SHEET`)).toBe(
          `Plancha: SOLPL-${RUN} - Plancha doble B`,
        );
        const parts = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'parts'`,
        );
        expect(parts.rows).toEqual([]);
      }));

    it("answers an empty page for a pedido with orderDataId = NULL (AC-26)", () =>
      runAsCoreTenant(async () => {
        const result = await dao.getAssociatedProductionOrders(
          orders.sheet,
          companyId,
          1,
          20,
        );

        expect(result).toMatchObject({
          success: true,
          data: [],
          totalCount: 0,
        });
      }));

    it("returns the pedido's own OPs, uuid-only (AC-25)", () =>
      runAsCoreTenant(async () => {
        const result = await dao.getAssociatedProductionOrders(
          orders.product,
          companyId,
          1,
          20,
        );

        expect(result?.totalCount).toBe(1);
        expect(result?.data[0]).toMatchObject({
          number: `${RUN}-OP-DONE`,
          quantity: 100,
          product: { code: `SOLP-${RUN}`, description: "Caja exportación" },
          customer: { name: `Cliente ${RUN}` },
          voidedAt: null,
        });
        expect(JSON.stringify(result?.data)).not.toMatch(/"id":|"productId":/);
      }));

    it("refuses another tenant's pedido with a null, not a payload (AC-23)", () =>
      runAsCoreTenant(async () => {
        expect(
          await dao.getAssociatedProductionOrders(
            orders.product,
            companyId + 100000,
            1,
            20,
          ),
        ).toBeNull();
      }));

    it("refuses when the caller's company does not resolve (T1/D-98)", () =>
      runAsCoreTenant(async () => {
        expect(
          await dao.getAssociatedProductionOrders(
            orders.product,
            UNRESOLVED_COMPANY,
            1,
            20,
          ),
        ).toBeNull();
      }));
  },
);
