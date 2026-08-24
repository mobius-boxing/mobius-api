/**
 * AC-1 / AC-2 / AC-3 — the `production_orders` schema against a live database.
 *
 * Like ownership.schema.test.ts this needs a database and there is none by
 * default (`.env` points at the deployed host), so it is guarded to
 * `localhost` and skips everywhere else. Run it with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production \
 *   npx jest src/__tests__/schema/production-orders.schema.test.ts
 *
 * This suite only reads; it never writes, so there is nothing to clean up.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** column → information_schema.data_type, per the spec's entity table. */
const PRODUCTION_ORDER_COLUMNS: Record<string, string> = {
  id: "integer",
  uuid: "uuid",
  companyId: "integer",
  number: "character varying",
  orderDate: "timestamp with time zone",
  quantity: "double precision",
  deliveryDate: "timestamp with time zone",
  notes: "text",
  newPlate: "boolean",
  newPlateReady: "boolean",
  newDie: "boolean",
  newDieReady: "boolean",
  isSample: "boolean",
  dispatchable: "boolean",
  lastLabelNumber: "integer",
  compression: "double precision",
  burst: "double precision",
  cobb: "double precision",
  testedInternalLength: "double precision",
  testedInternalWidth: "double precision",
  testedInternalHeight: "double precision",
  testedExternalLength: "double precision",
  testedExternalWidth: "double precision",
  testedExternalHeight: "double precision",
  avgGrammage: "double precision",
  avgWeight: "double precision",
  compressionMax: "double precision",
  compressionMin: "double precision",
  compressionAvg: "double precision",
  cobbMax: "double precision",
  cobbMin: "double precision",
  cobbAvg: "double precision",
  avgBurst: "double precision",
  schedulingApprovedAt: "timestamp with time zone",
  schedulingApprovedByUser: "text",
  schedulingCancelledAt: "timestamp with time zone",
  schedulingCancelledByUser: "text",
  completedAt: "timestamp with time zone",
  completedByUser: "text",
  completionCancelledAt: "timestamp with time zone",
  completionCancelledByUser: "text",
  voidedAt: "timestamp with time zone",
  voidedByUser: "text",
  voidCancelledAt: "timestamp with time zone",
  voidCancelledByUser: "text",
  createdAt: "timestamp with time zone",
  createdByUser: "text",
  updatedAt: "timestamp with time zone",
  legacyId: "integer",
  partId: "integer",
  orderDataId: "integer",
  routeId: "integer",
  palletizationId: "integer",
};

/** The float block AC-1 names explicitly. */
const MUST_BE_DOUBLE = [
  "quantity",
  "compression",
  "burst",
  "cobb",
  "testedInternalLength",
  "testedInternalWidth",
  "testedInternalHeight",
  "testedExternalLength",
  "testedExternalWidth",
  "testedExternalHeight",
  "avgGrammage",
  "avgWeight",
  "avgBurst",
  "compressionMax",
  "compressionMin",
  "compressionAvg",
  "cobbMax",
  "cobbMin",
  "cobbAvg",
];

describeIfLocalDb("production_orders schema (AC-1…AC-3)", () => {
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

  const readColumns = async (): Promise<
    Record<string, { dataType: string; isNullable: string }>
  > => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'production_orders'`,
    );
    return Object.fromEntries(
      result.rows.map((row) => [
        row.column_name,
        { dataType: row.data_type, isNullable: row.is_nullable },
      ]),
    );
  };

  it("has exactly the spec's column set with the spec's types (AC-1)", async () => {
    const live = await readColumns();
    const types = Object.fromEntries(
      Object.entries(live).map(([name, meta]) => [name, meta.dataType]),
    );
    expect(types).toEqual(PRODUCTION_ORDER_COLUMNS);
  });

  it("stores every float as double precision and nothing as numeric (AC-1, L-010)", async () => {
    const live = await readColumns();
    for (const column of MUST_BE_DOUBLE) {
      expect(live[column]?.dataType).toBe("double precision");
    }
    const numerics = Object.entries(live)
      .filter(([, meta]) => meta.dataType === "numeric")
      .map(([name]) => name);
    expect(numerics).toEqual([]);
  });

  it("points orderDataId at order_data and never at sales_orders (AC-2)", async () => {
    const result = await client.query<{
      column_name: string;
      foreign_table: string;
    }>(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'production_orders'
          AND tc.constraint_type = 'FOREIGN KEY'`,
    );
    const byColumn = new Map(
      result.rows.map((row) => [row.column_name, row.foreign_table]),
    );

    expect(byColumn.get("orderDataId")).toBe("order_data");
    expect(byColumn.get("partId")).toBe("parts");
    expect([...byColumn.values()]).not.toContain("sales_orders");
  });

  it("declares partId NOT NULL (AC-2)", async () => {
    const live = await readColumns();
    expect(live.partId?.isNullable).toBe("NO");
    // orderDataId stays nullable: a standalone OP has no pedido.
    expect(live.orderDataId?.isNullable).toBe("YES");
  });

  it("indexes (companyId, number) WITHOUT uniqueness (AC-3)", async () => {
    const result = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'production_orders'`,
    );
    const definitions = result.rows.map((row) => row.indexdef);

    const composite = definitions.filter(
      (def) => def.includes('"companyId"') && def.includes("number"),
    );
    expect(composite.length).toBeGreaterThan(0);
    for (const def of composite) {
      expect(def).not.toMatch(/CREATE UNIQUE INDEX/);
    }
    // No unique constraint or index whose column set is exactly {number}.
    for (const def of definitions) {
      if (!def.startsWith("CREATE UNIQUE INDEX")) continue;
      const columns = def.slice(def.lastIndexOf("(") + 1, def.lastIndexOf(")"));
      expect(columns.trim()).not.toBe("number");
    }
  });
});
