/**
 * AC-5, AC-6, AC-7, AC-11, AC-13, AC-14, AC-21 — the approval writes against a
 * REAL database.
 *
 * These four ACs cannot be proven anywhere else: they need lifecycle stamps no
 * endpoint can produce (`fulfilledAt`, `voidedAt`, `creditLimitOverrideAt`),
 * row counts on `sales_order_approval_events`, and the grants migration
 * resolved through `RbacService` rather than by reading raw rows.
 *
 * Needs a database, and there is none by default (`.env` points at the deployed
 * host), so it is guarded to `localhost` and skips everywhere else — the same
 * guard as ownership.schema.test.ts:18-20. Run it with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production \
 *   npx jest src/__tests__/db/sales-order-approvals.db.test.ts
 *
 * Every row it inserts — orders, order_data, the scratch company and the AC-14
 * scratch users — is deleted again in afterAll, evidence captured first (L-013,
 * L-017).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { connectAll, disconnectAll } from "../../database/registry";
import { SalesOrderDAO } from "../../dao/sales-order/sales-order.dao";
import { RbacService } from "../../services/rbac.service";
import { OrderApprovalMachine } from "../../interfaces/sales-order/sales-order-approval.interfaces";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36).toUpperCase();

/** The grants migration's contract, restated as the matrix AC-14 asserts. */
const GRANT_MATRIX: ReadonlyArray<{ role: string; codes: readonly string[] }> =
  [
    { role: "GERENTE DE VENTAS", codes: ["orders.approve.commercial"] },
    { role: "CONTABILIDAD", codes: ["orders.approve.financial"] },
    {
      role: "PRESIDENCIA",
      codes: ["orders.approve.commercial", "orders.approve.financial"],
    },
    { role: "VENDEDOR", codes: [] },
  ];

const APPROVAL_COLUMNS: Record<
  OrderApprovalMachine,
  {
    approvedAt: string;
    approvedBy: string;
    cancelledAt: string;
    cancelledBy: string;
  }
> = {
  commercial: {
    approvedAt: "commercialApprovedAt",
    approvedBy: "commercialApprovedBy",
    cancelledAt: "commercialCancelledAt",
    cancelledBy: "commercialCancelledBy",
  },
  financial: {
    approvedAt: "financialApprovedAt",
    approvedBy: "financialApprovedBy",
    cancelledAt: "financialCancelledAt",
    cancelledBy: "financialCancelledBy",
  },
};

describeIfLocalDb("Sales order approvals against the database", () => {
  let client: Client;
  let dao: SalesOrderDAO;

  let companyId = 0;
  let customerId = 0;
  let productId = 0;
  const orderUuids: string[] = [];
  const scratchUserIds: number[] = [];

  /**
   * A fresh order with the three lifecycle stamps AC-5/AC-6 need pre-set —
   * no endpoint can produce them, which is why this suite exists.
   */
  const createStampedOrder = async (): Promise<number> => {
    const order = await dao.create({
      companyId,
      customerId,
      productId,
      quantity: 100,
    });
    orderUuids.push(order.uuid!);
    const id = (await dao.getIdByUuid(order.uuid!))!;
    await client.query(
      `UPDATE sales_orders
          SET "fulfilledAt" = now(), "fulfilledBy" = 'cumplidor@x',
              "voidedAt" = now(), "voidedBy" = 'anulador@x',
              "creditLimitOverrideAt" = now(), "creditLimitOverrideBy" = 'override@x'
        WHERE id = $1`,
      [id],
    );
    return id;
  };

  const rawOrder = async (id: number): Promise<Record<string, unknown>> => {
    const rows = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1`,
      [id],
    );
    return rows.rows[0];
  };

  const eventCount = async (id: number): Promise<number> => {
    const rows = await client.query<{ count: string }>(
      `SELECT count(*) FROM sales_order_approval_events WHERE "salesOrderId" = $1`,
      [id],
    );
    return Number(rows.rows[0].count);
  };

  /**
   * Keys whose value differs between two raw rows. Dates are compared at full
   * ISO precision: `String(date)` drops milliseconds, which would hide an
   * `updatedAt` bump that happened in the same second.
   */
  const stringify = (value: unknown): string =>
    value instanceof Date ? value.toISOString() : String(value);

  const changedKeys = (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): string[] =>
    Object.keys(before).filter(
      (key) => stringify(before[key]) !== stringify(after[key]),
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
    dao = new SalesOrderDAO();

    const company = await client.query<{ id: number }>(
      `INSERT INTO companies (uuid, name, slug)
         VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [`SOAPP-${RUN}`, `soapp-${RUN.toLowerCase()}`],
    );
    companyId = company.rows[0].id;

    const customer = await client.query<{ id: number }>(
      `INSERT INTO customers (uuid, "companyId", name, code)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [companyId, `Cliente ${RUN}`, `SOAC-${RUN}`],
    );
    customerId = customer.rows[0].id;

    const product = await client.query<{ id: number }>(
      `INSERT INTO products (uuid, "companyId", "customerId", code, description)
         VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [companyId, customerId, `SOAP-${RUN}`, "Producto de prueba"],
    );
    productId = product.rows[0].id;
  }, 60000);

  afterAll(async () => {
    // L-013: leave the database exactly as it was found.
    try {
      for (const id of scratchUserIds) {
        await client.query(`DELETE FROM users WHERE id = $1`, [id]);
      }
      for (const uuid of orderUuids) {
        const found = await client.query<{ orderDataId: number | null }>(
          `SELECT "orderDataId" FROM sales_orders WHERE uuid = $1`,
          [uuid],
        );
        // The events go with the order through the ON DELETE CASCADE.
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
      // companies cascades products / customers.
      await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    } finally {
      await client.end();
      await disconnectAll();
    }
  }, 60000);

  describe("schema (AC-13)", () => {
    it("has the sales_order_approval_events table with its FK cascade", async () => {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'sales_order_approval_events'`,
      );
      expect(columns.rows.map((r) => r.column_name).sort()).toEqual([
        "action",
        "id",
        "performedAt",
        "performedBy",
        "salesOrderId",
        "stateMachine",
        "uuid",
      ]);

      const rule = await client.query<{ confdeltype: string }>(
        `SELECT confdeltype FROM pg_constraint
          WHERE conrelid = 'sales_order_approval_events'::regclass
            AND contype = 'f'`,
      );
      expect(rule.rows[0].confdeltype).toBe("c"); // ON DELETE CASCADE
    });
  });

  describe("no side effects (AC-5, R-2/R-5)", () => {
    it.each(["commercial", "financial"] as OrderApprovalMachine[])(
      "confines an %s approval to that machine's four columns plus updatedAt",
      async (machine) => {
        const id = await createStampedOrder();
        const before = await rawOrder(id);

        await dao.setApproval(id, machine, "approve", "aprobador@x");

        const after = await rawOrder(id);
        const cols = APPROVAL_COLUMNS[machine];
        expect(changedKeys(before, after).sort()).toEqual(
          ["updatedAt", cols.approvedAt, cols.approvedBy].sort(),
        );
        // The cancellation half was already null and stays null; the other
        // machine, the override pair and the fulfil/void stamps are untouched.
        expect(after[cols.cancelledAt]).toBeNull();
        expect(after[cols.cancelledBy]).toBeNull();
      },
    );

    it("keeps an existing credit-limit override when financial approval is cancelled (D-7)", async () => {
      const id = await createStampedOrder();
      await dao.setApproval(id, "financial", "approve", "aprobador@x");
      const before = await rawOrder(id);

      await dao.setApproval(id, "financial", "cancel", "cancelador@x");

      const after = await rawOrder(id);
      expect(after.creditLimitOverrideAt).toEqual(before.creditLimitOverrideAt);
      expect(after.creditLimitOverrideBy).toBe("override@x");
      expect(changedKeys(before, after).sort()).toEqual(
        [
          "updatedAt",
          "financialApprovedAt",
          "financialApprovedBy",
          "financialCancelledAt",
          "financialCancelledBy",
        ].sort(),
      );
    });

    it("leaves the other machine's four columns null when only one is stamped (AC-4)", async () => {
      const id = await createStampedOrder();

      await dao.setApproval(id, "financial", "approve", "aprobador@x");

      const after = await rawOrder(id);
      expect(after.commercialApprovedAt).toBeNull();
      expect(after.commercialApprovedBy).toBeNull();
      expect(after.commercialCancelledAt).toBeNull();
      expect(after.commercialCancelledBy).toBeNull();
    });
  });

  describe("no state guards (AC-6, R-3)", () => {
    it("approves and cancels both machines on a fulfilled AND voided order", async () => {
      const id = await createStampedOrder();
      const before = await rawOrder(id);

      for (const machine of ["commercial", "financial"] as const) {
        for (const action of ["approve", "cancel"] as const) {
          const updated = await dao.setApproval(id, machine, action, "user@x");
          expect(updated).not.toBeNull();
          const cols = APPROVAL_COLUMNS[machine];
          const row = await rawOrder(id);
          if (action === "approve") {
            expect(row[cols.approvedAt]).not.toBeNull();
            expect(row[cols.cancelledAt]).toBeNull();
          } else {
            expect(row[cols.cancelledAt]).not.toBeNull();
            expect(row[cols.approvedAt]).toBeNull();
          }
        }
      }

      const after = await rawOrder(id);
      expect(after.fulfilledAt).toEqual(before.fulfilledAt);
      expect(after.fulfilledBy).toBe("cumplidor@x");
      expect(after.voidedAt).toEqual(before.voidedAt);
      expect(after.voidedBy).toBe("anulador@x");
    });
  });

  describe("unconditional re-stamp (AC-7, R-4)", () => {
    it("re-approves an already-approved machine and never refuses", async () => {
      const id = await createStampedOrder();

      await dao.setApproval(id, "commercial", "approve", "first@x");
      const first = await rawOrder(id);
      const second = await dao.setApproval(
        id,
        "commercial",
        "approve",
        "second@x",
      );

      expect(second).not.toBeNull();
      const after = await rawOrder(id);
      expect(
        new Date(after.commercialApprovedAt as string).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(first.commercialApprovedAt as string).getTime(),
      );
      expect(after.commercialApprovedBy).toBe("second@x");
    });
  });

  describe("event log (AC-11, AC-21)", () => {
    it("inserts exactly one row per successful action, with the acting user", async () => {
      const id = await createStampedOrder();
      expect(await eventCount(id)).toBe(0);

      await dao.setApproval(id, "commercial", "approve", "aprobador@x");
      expect(await eventCount(id)).toBe(1);

      await dao.setApproval(id, "financial", "cancel", "cancelador@x");
      expect(await eventCount(id)).toBe(2);

      const rows = await client.query<{
        stateMachine: string;
        action: string;
        performedBy: string;
      }>(
        `SELECT "stateMachine", action, "performedBy"
           FROM sales_order_approval_events
          WHERE "salesOrderId" = $1
          ORDER BY id`,
        [id],
      );
      expect(rows.rows).toEqual([
        {
          stateMachine: "commercial",
          action: "approve",
          performedBy: "aprobador@x",
        },
        {
          stateMachine: "financial",
          action: "cancel",
          performedBy: "cancelador@x",
        },
      ]);
    });

    it("writes no event row for an order that no longer exists (AC-11, AC-12)", async () => {
      // The row vanished between the controller's uuid→id resolution and the
      // UPDATE. Nothing is stamped, so nothing is recorded: the DAO answers
      // null (the controller turns that into a 404) and the history table is
      // untouched — an event whose FK target is gone cannot be written anyway.
      const missingId = 2147483000;
      const before = await client.query<{ count: string }>(
        `SELECT count(*) FROM sales_order_approval_events`,
      );

      const result = await dao.setApproval(
        missingId,
        "commercial",
        "approve",
        "aprobador@x",
      );

      expect(result).toBeNull();
      const after = await client.query<{ count: string }>(
        `SELECT count(*) FROM sales_order_approval_events`,
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it("takes its event rows with the order when it is deleted (L-006, AC-21)", async () => {
      const id = await createStampedOrder();
      await dao.setApproval(id, "commercial", "approve", "aprobador@x");
      expect(await eventCount(id)).toBe(1);

      // The DAO's delete is the one deletion path; the cascade is the whole
      // deletion story for the events table and nothing else cleans it up.
      expect(await dao.delete(id)).toBe(true);

      expect(await eventCount(id)).toBe(0);
    });
  });

  describe("seeded grants resolve through RbacService (AC-14)", () => {
    it("gives each template role exactly the codes the migration seeded", async () => {
      const companies = await client.query<{ id: number }>(
        `SELECT id FROM companies WHERE id <> $1 ORDER BY id`,
        [companyId],
      );
      expect(companies.rows.length).toBeGreaterThan(0);

      let rolesChecked = 0;
      for (const company of companies.rows) {
        for (const entry of GRANT_MATRIX) {
          const role = await client.query<{ id: number }>(
            `SELECT id FROM roles WHERE "companyId" = $1 AND name = $2`,
            [company.id, entry.role],
          );
          // A company provisioned without the Procusto profiles is skipped by
          // the migration, so it is skipped here too.
          if (!role.rows.length) continue;
          rolesChecked += 1;

          const user = await client.query<{ id: number }>(
            `INSERT INTO users (uuid, email, password, "firstName", "lastName",
                                "companyId", "roleId")
               VALUES (gen_random_uuid(), $1, 'x', 'Scratch', 'User', $2, $3)
             RETURNING id`,
            [
              `soapp-${RUN}-${company.id}-${entry.role}@test.local`.toLowerCase(),
              company.id,
              role.rows[0].id,
            ],
          );
          scratchUserIds.push(user.rows[0].id);

          const codes = await RbacService.permissionCodesForUser(
            user.rows[0].id,
          );
          const approvalCodes = codes
            .filter((code) => code.startsWith("orders.approve."))
            .sort();

          expect(approvalCodes).toEqual([...entry.codes].sort());
          // Never the `.readonly` twins (rbac.service.ts:41-50).
          expect(
            codes.filter((code) =>
              /^orders\.approve\..*\.readonly$/.test(code),
            ),
          ).toEqual([]);
        }
      }
      expect(rolesChecked).toBeGreaterThan(0);
    });
  });
});
