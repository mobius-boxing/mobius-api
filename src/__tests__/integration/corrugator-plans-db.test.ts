/**
 * corrugator-planning DB round trip (AC-1, AC-2, AC-5, AC-9), through
 * `plan.service.ts` directly rather than HTTP — the HTTP round trip
 * (including a real solve/register/unregister) is exercised by
 * `docs/dev/corrugator-planning/manual-test-api.sh` against the dev stack and
 * `repos/tests/integration/corrugator-plans.test.ts`.
 *
 * Needs a database (guarded to localhost, same pattern as
 * sales-order-list-db.test.ts). Every row it inserts is deleted in afterAll
 * (L-013); every assertion runs before teardown (L-017).
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=mobius_dev \
 *   npx jest src/__tests__/integration/corrugator-plans-db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import {
  connectAll,
  disconnectAll,
  rawCoreInstance,
  withTenantTarget,
} from "../../database/registry";
import * as planService from "../../services/corrugator/plan.service";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36).toUpperCase();

describeIfLocalDb(
  "corrugator-planning against the database (AC-1, AC-2, AC-5, AC-9)",
  () => {
    let client: Client;
    let companyId = 0;
    let otherCompanyId = 0;
    let productionOrderUuidA = "";
    let productionOrderUuidB = "";
    let productionOrderUuidOtherBoard = "";
    let machineUuid = "";

    const one = async <T extends Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T> => {
      const result = await client.query<T>(sql, params);
      return result.rows[0];
    };

    const runAsCoreTenant = <T>(fn: () => Promise<T>): Promise<T> =>
      withTenantTarget(
        { physicalKey: "core", instance: rawCoreInstance() },
        fn,
      );

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

      const company = await one<{ id: number }>(
        `INSERT INTO companies (uuid, name, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
        [`CORR-${RUN}`, `corr-${RUN.toLowerCase()}`],
      );
      companyId = company.id;
      const other = await one<{ id: number }>(
        `INSERT INTO companies (uuid, name, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
        [`CORR-OTHER-${RUN}`, `corr-other-${RUN.toLowerCase()}`],
      );
      otherCompanyId = other.id;

      const customer = await one<{ id: number }>(
        `INSERT INTO customers (uuid, "companyId", name, code) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
        [companyId, `Cliente ${RUN}`, `CORC-${RUN}`],
      );

      const corrugation = await one<{ id: number }>(
        `INSERT INTO corrugations (uuid, "companyId", code, "theoreticalGrammage")
       VALUES (gen_random_uuid(), $1, $2, 500) RETURNING id`,
        [companyId, `COR-${RUN}`],
      );
      await client.query(
        `INSERT INTO corrugation_layers (uuid, "corrugationId", position, "isLiner")
       VALUES (gen_random_uuid(), $1, 1, true), (gen_random_uuid(), $1, 2, false)`,
        [corrugation.id],
      );

      const otherCorrugation = await one<{ id: number }>(
        `INSERT INTO corrugations (uuid, "companyId", code, "theoreticalGrammage")
       VALUES (gen_random_uuid(), $1, $2, 999) RETURNING id`,
        [companyId, `COR-B-${RUN}`],
      );

      const machineType = await one<{ id: number }>(
        `INSERT INTO machine_types (uuid, "companyId", name, corrugated) VALUES (gen_random_uuid(), $1, $2, true) RETURNING id`,
        [companyId, `MT-${RUN}`],
      );
      const machine = await one<{ id: number; uuid: string }>(
        `INSERT INTO machines (uuid, "companyId", "machineTypeId", code, width)
       VALUES (gen_random_uuid(), $1, $2, $3, 2000) RETURNING id, uuid`,
        [companyId, machineType.id, `M-${RUN}`],
      );
      machineUuid = machine.uuid;

      const product = async (code: string, corrugationId: number) =>
        one<{ id: number; uuid: string }>(
          `INSERT INTO products (uuid, "companyId", "customerId", code, "sheetLength", "sheetWidth", "corrugationId")
         VALUES (gen_random_uuid(), $1, $2, $3, 1000, 800, $4) RETURNING id, uuid`,
          [companyId, customer.id, code, corrugationId],
        );

      const productionOrder = async (number: string, productId: number) =>
        one<{ id: number; uuid: string }>(
          `INSERT INTO production_orders (uuid, "companyId", number, quantity, "productId", "schedulingApprovedAt")
         VALUES (gen_random_uuid(), $1, $2, 500, $3, now()) RETURNING id, uuid`,
          [companyId, number, productId],
        );

      const productA = await product(`P-A-${RUN}`, corrugation.id);
      const productB = await product(`P-B-${RUN}`, corrugation.id);
      const productOther = await product(`P-C-${RUN}`, otherCorrugation.id);

      productionOrderUuidA = (await productionOrder(`OP-A-${RUN}`, productA.id))
        .uuid;
      productionOrderUuidB = (await productionOrder(`OP-B-${RUN}`, productB.id))
        .uuid;
      productionOrderUuidOtherBoard = (
        await productionOrder(`OP-C-${RUN}`, productOther.id)
      ).uuid;
    }, 60000);

    afterAll(async () => {
      try {
        await client.query(
          `SELECT set_config('mobius.audit_skip', 'on', false)`,
        );
        await client.query(
          `DELETE FROM corrugator_plan_orders WHERE "companyId" IN ($1, $2)`,
          [companyId, otherCompanyId],
        );
        await client.query(
          `DELETE FROM corrugator_plans WHERE "companyId" IN ($1, $2)`,
          [companyId, otherCompanyId],
        );
        await client.query(
          `DELETE FROM production_orders WHERE "companyId" = $1`,
          [companyId],
        );
        await client.query(`DELETE FROM products WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(`DELETE FROM machines WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(`DELETE FROM machine_types WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(
          `DELETE FROM corrugation_layers WHERE "corrugationId" IN (SELECT id FROM corrugations WHERE "companyId" = $1)`,
          [companyId],
        );
        await client.query(`DELETE FROM corrugations WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(`DELETE FROM customers WHERE "companyId" = $1`, [
          companyId,
        ]);
        await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [
          companyId,
          otherCompanyId,
        ]);
        await client.query("BEGIN");
        await client.query(`SET LOCAL mobius.audit_maintenance = 'on'`);
        await client.query(
          `DELETE FROM audit_logs WHERE "companyId" IN ($1, $2)`,
          [companyId, otherCompanyId],
        );
        await client.query("COMMIT");
      } finally {
        await client.end();
        await disconnectAll();
      }
    }, 60000);

    it("AC-1: pool groups the two same-board orders and excludes the other board", async () => {
      const pool = await runAsCoreTenant(() => planService.getPool(companyId));
      const group = pool.groups.find((g) =>
        g.orders.some((o) => o.productionOrder.uuid === productionOrderUuidA),
      );
      expect(group).toBeDefined();
      expect(group!.orders.map((o) => o.productionOrder.uuid).sort()).toEqual(
        [productionOrderUuidA, productionOrderUuidB].sort(),
      );
      expect(
        pool.groups.some((g) =>
          g.orders.some(
            (o) => o.productionOrder.uuid === productionOrderUuidOtherBoard,
          ),
        ),
      ).toBe(true);
      // Two structurally different corrugations never share a board key.
      const otherGroup = pool.groups.find((g) =>
        g.orders.some(
          (o) => o.productionOrder.uuid === productionOrderUuidOtherBoard,
        ),
      );
      expect(otherGroup!.board.key).not.toBe(group!.board.key);
    });

    it("AC-3/P-1: no route on the order falls back to sheetsPerUnit=1, source=quantity", async () => {
      const pool = await runAsCoreTenant(() => planService.getPool(companyId));
      const order = pool.groups
        .flatMap((g) => g.orders)
        .find((o) => o.productionOrder.uuid === productionOrderUuidA)!;
      expect(order.sheetsPerUnit).toBe(1);
      expect(order.sheetsSource).toBe("quantity");
      expect(order.requiredSheets).toBe(500);
    });

    it("AC-2: MIXED_BOARD when the two orders span different boards", async () => {
      const result = await runAsCoreTenant(() =>
        planService.createPlan(companyId, "tester@example.com", {
          productionOrderUuids: [
            productionOrderUuidA,
            productionOrderUuidOtherBoard,
          ],
          machines: [{ machineUuid }],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("MIXED_BOARD");
    });

    it("AC-2/AC-9: creates a plan, seeds both lines, and is invisible to another company (L-009)", async () => {
      const created = await runAsCoreTenant(() =>
        planService.createPlan(companyId, "tester@example.com", {
          name: "DB test plan",
          productionOrderUuids: [productionOrderUuidA, productionOrderUuidB],
          machines: [{ machineUuid, widths: [2000, 1500] }],
        }),
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.status).toBe("draft");
      expect(created.data.orders).toHaveLength(2);
      expect(created.data.machines![0].widths).toEqual([2000, 1500]);

      // L-009: another company's scope never sees this plan.
      const crossCompany = await runAsCoreTenant(() =>
        planService.getPlanDetail(otherCompanyId, created.data.uuid!),
      );
      expect(crossCompany).toBeNull();

      // I-6 (amended): a `machines` change on a solved/failed plan invalidates
      // it back to draft. Fake "solved" with one combination row directly (a
      // real solve is exercised end-to-end by the HTTP suites), then verify the
      // update tears it down.
      await client.query(
        `UPDATE corrugator_plans SET status = 'solved' WHERE uuid = $1`,
        [created.data.uuid],
      );
      const plan = await one<{ id: number }>(
        `SELECT id FROM corrugator_plans WHERE uuid = $1`,
        [created.data.uuid],
      );
      await client.query(
        `INSERT INTO corrugator_plan_combinations (uuid, "companyId", "planId", "machineKey", sequence, meters)
       VALUES (gen_random_uuid(), $1, $2, $3, 1, 100)`,
        [companyId, plan.id, `${machineUuid}:2000`],
      );

      const updated = await runAsCoreTenant(() =>
        planService.updatePlan(companyId, created.data.uuid!, {
          machines: [{ machineUuid, widths: [1500] }],
        }),
      );
      expect(updated.ok).toBe(true);
      if (updated.ok) {
        expect(updated.data.status).toBe("draft");
        expect(updated.data.combinations).toHaveLength(0);
      }

      const remainingCombos = await client.query(
        `SELECT count(*) FROM corrugator_plan_combinations WHERE "planId" = $1`,
        [plan.id],
      );
      expect(Number(remainingCombos.rows[0].count)).toBe(0);
    });
  },
);
