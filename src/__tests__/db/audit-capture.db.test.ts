/**
 * Audit capture at the database level — audit P2, track T5.
 *
 * `repos/tests/api/audit-capture.test.ts` proves the other half: that a real
 * authenticated HTTP request produces an attributed ledger row. This file
 * proves the cases HTTP cannot reach — redaction, the cascade, the two escape
 * hatches, partition routing, and the job actor — with nothing between the
 * assertion and Postgres.
 *
 * Every claim below is invisible to a green `npm test`: the rest of P2 is
 * either unit-tested against generated SQL text or asserted inside a
 * rolled-back scratch transaction. A trigger that never fires, a redaction that
 * silently drops the whole row, an `audit_skip` that leaks past its transaction
 * — all of them stay green everywhere except here.
 *
 * Two properties are worth reading before the tests, because they are
 * deliberate and look like bugs otherwise:
 *
 * 1. **A redacted column still writes a row** (ruling 2026-09-01, which
 *    supersedes the handbook's "no row for a password change"). Change
 *    detection runs on the *unredacted* rows, so a password reset produces a
 *    `Modificacion` whose `changedKeys` is `['password']` and whose `before`
 *    and `after` do not carry the key at all — absent, not null. You can see
 *    that the password changed and when; never what it was. The rejected
 *    alternative left an attacker who resets a password invisible in the
 *    ledger.
 * 2. **A cascade-deleted child loses `rootUuid`** (§0.3-9). The `AFTER DELETE`
 *    trigger runs after the parent row is gone, so the parent's uuid can no
 *    longer be looked up. Accepted, and asserted here so it is a stated
 *    property rather than a P3 surprise: the child and the parent share a
 *    `txId`, which is how the viewer regroups them.
 *
 * Needs a database, and there is none by default (`.env` points at the deployed
 * host), so it is guarded to `localhost` and skips everywhere else — the same
 * guard as `schema/ownership.schema.test.ts:18-20`. Run it with, from
 * `repos/mobius-api`:
 *
 *   set -a; . ./.env; set +a; SQL_HOST=localhost \
 *     npx jest src/__tests__/db/audit-capture.db.test.ts
 *
 * L-013 under an append-only ledger: `audit_logs` rows cannot be deleted
 * normally, so `afterAll` removes this run's rows the way `purgeCompany` does —
 * inside one transaction with `mobius.audit_maintenance='on'` (so the
 * protection trigger stands aside) and `mobius.audit_skip='on'` (so the
 * cascade's own `Baja` rows are never written in the first place). The ledger
 * count is snapshotted before the fixtures and asserted equal afterwards; the
 * assertion, not the DELETEs, is what makes the claim true.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { withAuditContext } from "../../database/audit-context";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** Marks every row this run creates, so a leftover is greppable (L-013). */
const RUN = Date.now().toString(36).toUpperCase();
const mark = (suffix: string): string => `P2T5-${RUN}-${suffix}`;

/**
 * Tables counted before and after (L-013). `audit_logs` is the point of the
 * suite and the one table whose cleanup needs maintenance mode.
 */
const COUNTED_TABLES = [
  "audit_logs",
  "companies",
  "users",
  "invitations",
  "nf_credentials",
  "corrugations",
  "corrugation_layers",
  "warehouses",
] as const;

/** The ledger, as Postgres hands it back: jsonb parsed, bigint as text. */
type AuditRow = {
  entityName: string;
  entityUuid: string | null;
  operation: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedKeys: string[] | null;
  source: string;
  username: string | null;
  companyId: number | null;
  rootEntity: string | null;
  rootUuid: string | null;
  txId: string;
  id: string;
};

type CountRow = { count: string };
type IdRow = { id: number };

const AUDIT_COLUMNS = `id, "entityName", "entityUuid", operation, before, after,
  "changedKeys", source, username, "companyId", "rootEntity", "rootUuid", "txId"`;

describeIfLocalDb("Audit capture against the database (P2)", () => {
  /**
   * The only connection this suite uses for direct SQL. Outside every pool the
   * registry owns, so "the row is there" means committed, not "visible inside
   * the transaction that wrote it".
   */
  let outside: Client;

  let companyId = 0;
  let userId = 0;
  let corrugationId = 0;

  /** Fixture uuids, named rather than indexed — the ledger is queried by uuid. */
  let userUuid = "";
  let corrugationUuid = "";
  let layerAUuid = "";
  let layerBUuid = "";
  /** The warehouse the append-only pair of tests deletes a ledger row for. */
  let auditedWarehouseUuid = "";

  /** Every uuid this run wrote, for the scoped ledger cleanup. */
  const writtenUuids: string[] = [];
  const startCounts: Record<string, number> = {};

  const newUuid = (): string => {
    const uuid = randomUUID();
    writtenUuids.push(uuid);
    return uuid;
  };

  const tableCount = async (table: string): Promise<number> => {
    const result = await outside.query<CountRow>(
      `SELECT count(*) FROM ${table}`,
    );
    return Number(result.rows[0].count);
  };

  /** Every ledger row written for one entity row, oldest first. */
  const rowsFor = async (
    entityName: string,
    entityUuid: string,
  ): Promise<AuditRow[]> => {
    const result = await outside.query<AuditRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_logs
        WHERE "entityName" = $1 AND "entityUuid" = $2
        ORDER BY id`,
      [entityName, entityUuid],
    );
    return result.rows;
  };

  /**
   * The purge door, held open for a test (see the header). Both settings are
   * `set_config(..., true)` — transaction-local — so neither can survive onto
   * the next user of this connection.
   */
  const inMaintenance = async (
    statements: Array<[string, unknown[]]>,
  ): Promise<void> => {
    await outside.query("BEGIN");
    try {
      await outside.query(
        "SELECT set_config('mobius.audit_maintenance', 'on', true)",
      );
      await outside.query("SELECT set_config('mobius.audit_skip', 'on', true)");
      for (const [sql, params] of statements) {
        await outside.query(sql, params);
      }
      await outside.query("COMMIT");
    } catch (error) {
      await outside.query("ROLLBACK");
      throw error;
    }
  };

  beforeAll(async () => {
    outside = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await outside.connect();
    // Snapshot BEFORE the fixtures, so the equality check covers them too.
    for (const table of COUNTED_TABLES) {
      startCounts[table] = await tableCount(table);
    }
    await connectAll();

    const company = await outside.query<IdRow>(
      `INSERT INTO companies (uuid, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [newUuid(), mark("CO"), mark("co").toLowerCase()],
    );
    companyId = company.rows[0].id;

    userUuid = newUuid();
    const user = await outside.query<IdRow>(
      `INSERT INTO users (uuid, email, password, "firstName", "lastName", "companyId", role)
         VALUES ($1, $2, $3, 'P2', 'T5', $4, 'member') RETURNING id`,
      [
        userUuid,
        `${mark("user").toLowerCase()}@mobius.test`,
        "HASH-A",
        companyId,
      ],
    );
    userId = user.rows[0].id;

    corrugationUuid = newUuid();
    const corrugation = await outside.query<IdRow>(
      `INSERT INTO corrugations (uuid, code, description, "companyId")
         VALUES ($1, $2, 'P2 T5 cascade fixture', $3) RETURNING id`,
      [corrugationUuid, mark("CORR"), companyId],
    );
    corrugationId = corrugation.rows[0].id;
    layerAUuid = newUuid();
    layerBUuid = newUuid();
    await outside.query(
      `INSERT INTO corrugation_layers (uuid, "corrugationId", position, "isLiner")
         VALUES ($1, $3, 1, true), ($2, $3, 2, false)`,
      [layerAUuid, layerBUuid, corrugationId],
    );
  }, 60000);

  afterAll(async () => {
    try {
      // Entities first, ledger second (§0.3-5): with `audit_skip` on neither
      // writes a row, but the order is the one the purge path uses and a
      // future reader should not have to re-derive why it is safe.
      await inMaintenance([
        [`DELETE FROM corrugations WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM invitations WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM nf_credentials WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM warehouses WHERE company_id = $1`, [companyId]],
        [`DELETE FROM users WHERE "companyId" = $1`, [companyId]],
        [`DELETE FROM companies WHERE id = $1`, [companyId]],
        // Scoped two ways because they do not overlap: rows for tables with a
        // company column (`users`, `corrugations`, …) carry `companyId`, while
        // `corrugation_layers` has no such column and, written with
        // `source='sql'`, no context to fall back on — those are reached only
        // by the uuids this run generated.
        [`DELETE FROM audit_logs WHERE "companyId" = $1`, [companyId]],
        [
          `DELETE FROM audit_logs WHERE "entityUuid" = ANY($1::uuid[])`,
          [writtenUuids],
        ],
      ]);

      const endCounts: Record<string, number> = {};
      for (const table of COUNTED_TABLES) {
        endCounts[table] = await tableCount(table);
      }
      // eslint-disable-next-line no-console
      console.info(
        "[L-013] table counts before/after:",
        JSON.stringify({ before: startCounts, after: endCounts }),
      );
      expect(endCounts).toEqual(startCounts);
    } finally {
      await outside.end();
      await disconnectAll();
    }
  }, 60000);

  // ============ AC-13 (rewritten) — record the event, not the value ============

  describe("AC-13 — a redacted column is recorded, never stored", () => {
    it("writes one row for a password change, naming the key and dropping the value", async () => {
      const before = await rowsFor("users", userUuid);
      expect(before).toHaveLength(1); // the Alta from beforeAll

      await outside.query(`UPDATE users SET password = $1 WHERE id = $2`, [
        "HASH-B",
        userId,
      ]);

      const rows = await rowsFor("users", userUuid);
      expect(rows).toHaveLength(2);
      const change = rows[1];
      expect(change.operation).toBe("Modificacion");
      // The event: the ledger says the password changed.
      expect(change.changedKeys).toEqual(["password"]);
      // The value: absent from both sides. `not.toHaveProperty` rather than
      // `toBeNull` — a null would read as "it was set to nothing".
      expect(change.before).not.toHaveProperty("password");
      expect(change.after).not.toHaveProperty("password");
      // V-1 restricts both sides to the changed keys, and the only changed key
      // is redacted, so both are empty objects rather than partial rows.
      expect(change.before).toEqual({});
      expect(change.after).toEqual({});
      // Belt and braces: neither hash appears anywhere in the row.
      expect(JSON.stringify(change)).not.toContain("HASH-A");
      expect(JSON.stringify(change)).not.toContain("HASH-B");
    });

    it("strips the password from the whole-row Alta as well", async () => {
      const rows = await rowsFor("users", userUuid);
      const alta = rows[0];
      expect(alta.operation).toBe("Alta");
      // A whole row on Alta — but not the secret.
      expect(alta.after).toHaveProperty("email");
      expect(alta.after).not.toHaveProperty("password");
      expect(JSON.stringify(alta)).not.toContain("HASH-A");
    });

    it("holds for invitations.token the same way", async () => {
      const invitationUuid = newUuid();
      await outside.query(
        `INSERT INTO invitations (uuid, email, token, role, "companyId", "invitedBy", "expiresAt")
           VALUES ($1, $2, $3, 'member', $4, $5, now() + interval '7 days')`,
        [
          invitationUuid,
          `${mark("inv").toLowerCase()}@mobius.test`,
          "TOKEN-A",
          companyId,
          userId,
        ],
      );
      await outside.query(`UPDATE invitations SET token = $1 WHERE uuid = $2`, [
        "TOKEN-B",
        invitationUuid,
      ]);

      const rows = await rowsFor("invitations", invitationUuid);
      expect(rows).toHaveLength(2);
      expect(rows[0].after).not.toHaveProperty("token");
      expect(rows[1].changedKeys).toEqual(["token"]);
      expect(rows[1].before).not.toHaveProperty("token");
      expect(rows[1].after).not.toHaveProperty("token");
      expect(JSON.stringify(rows)).not.toContain("TOKEN-A");
      expect(JSON.stringify(rows)).not.toContain("TOKEN-B");
    });

    it("holds for all three nf_credentials.secret* columns", async () => {
      const credentialUuid = newUuid();
      await outside.query(
        `INSERT INTO nf_credentials (uuid, "companyId", name, type, "secretCiphertext", "secretIv", "secretTag")
           VALUES ($1, $2, $3, 'header', 'CIPHER-A', 'IV-A', 'TAG-A')`,
        [credentialUuid, companyId, mark("CRED")],
      );
      await outside.query(
        `UPDATE nf_credentials
            SET "secretCiphertext" = 'CIPHER-B', "secretIv" = 'IV-B', "secretTag" = 'TAG-B',
                "headerName" = 'X-Api-Key'
          WHERE uuid = $1`,
        [credentialUuid],
      );

      const rows = await rowsFor("nf_credentials", credentialUuid);
      expect(rows).toHaveLength(2);
      expect(rows[0].after).toHaveProperty("name");
      for (const key of ["secretCiphertext", "secretIv", "secretTag"]) {
        expect(rows[0].after).not.toHaveProperty(key);
        expect(rows[1].before).not.toHaveProperty(key);
        expect(rows[1].after).not.toHaveProperty(key);
        expect(rows[1].changedKeys).toContain(key);
      }
      // The one non-secret column that changed keeps its values, which is what
      // makes the redaction a redaction and not a dropped row.
      expect(rows[1].changedKeys).toEqual([
        "headerName",
        "secretCiphertext",
        "secretIv",
        "secretTag",
      ]);
      expect(rows[1].after).toEqual({ headerName: "X-Api-Key" });
      for (const secret of ["CIPHER-", "IV-", "TAG-"]) {
        expect(JSON.stringify(rows)).not.toContain(secret);
      }
    });
  });

  // ==================== the cascade (L-006 territory) ====================

  describe("a cascade delete is recorded for the children too", () => {
    it("writes a Baja per layer, sharing the parent's txId and losing rootUuid", async () => {
      // The layers were written by the fixture INSERT and carry their parent.
      const layerAltas = await rowsFor("corrugation_layers", layerAUuid);
      expect(layerAltas).toHaveLength(1);
      expect(layerAltas[0].rootEntity).toBe("corrugations");
      expect(layerAltas[0].rootUuid).toBe(corrugationUuid);

      // One statement. `ON DELETE CASCADE` removes the layers, and the DAO
      // that used to record the parent's delete never saw them (L-006) — the
      // trigger does.
      await outside.query(`DELETE FROM corrugations WHERE id = $1`, [
        corrugationId,
      ]);

      const parent = await rowsFor("corrugations", corrugationUuid);
      expect(parent).toHaveLength(2);
      const parentBaja = parent[1];
      expect(parentBaja.operation).toBe("Baja");
      expect(parentBaja.before).toMatchObject({ code: mark("CORR") });

      for (const layer of [layerAUuid, layerBUuid]) {
        const rows = await rowsFor("corrugation_layers", layer);
        expect(rows).toHaveLength(2);
        const baja = rows[1];
        expect(baja.operation).toBe("Baja");
        // §0.3-9, asserted deliberately: the parent row is already gone when
        // the child's AFTER DELETE trigger runs, so its uuid cannot be looked
        // up. The txId is what puts the three rows back together.
        expect(baja.rootEntity).toBe("corrugations");
        expect(baja.rootUuid).toBeNull();
        expect(baja.txId).toBe(parentBaja.txId);
      }
    });
  });

  // ==================== the two escape hatches ====================

  describe("mobius.audit_skip and mobius.audit_maintenance", () => {
    it("writes nothing at all while audit_skip is on", async () => {
      const skipped = newUuid();
      await outside.query("BEGIN");
      await outside.query("SELECT set_config('mobius.audit_skip', 'on', true)");
      await outside.query(
        `INSERT INTO warehouses (uuid, name, company_id, grid_rows, grid_cols)
           VALUES ($1, $2, $3, 1, 1)`,
        [skipped, mark("WH-SKIP"), companyId],
      );
      await outside.query(`UPDATE warehouses SET name = $1 WHERE uuid = $2`, [
        mark("WH-SKIP2"),
        skipped,
      ]);
      await outside.query("COMMIT");

      // The row is committed…
      const live = await outside.query<CountRow>(
        `SELECT count(*) FROM warehouses WHERE uuid = $1`,
        [skipped],
      );
      expect(Number(live.rows[0].count)).toBe(1);
      // …and the ledger never heard about it.
      expect(await rowsFor("warehouses", skipped)).toHaveLength(0);
    });

    it("is transaction-local: the very next statement is audited again", async () => {
      // `set_config(..., true)` above must not have leaked onto this pooled
      // connection. If it had, capture would be off for every later user of it.
      auditedWarehouseUuid = newUuid();
      await outside.query(
        `INSERT INTO warehouses (uuid, name, company_id, grid_rows, grid_cols)
           VALUES ($1, $2, $3, 1, 1)`,
        [auditedWarehouseUuid, mark("WH-AUDITED"), companyId],
      );

      const rows = await rowsFor("warehouses", auditedWarehouseUuid);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("Alta");
      expect(rows[0].source).toBe("sql");
      // §0.3-1: `warehouses.company_id` is snake_case. A trigger reading only
      // `companyId` would attribute this row to nobody.
      expect(rows[0].companyId).toBe(companyId);
    });

    it("refuses a bare DELETE from the ledger with P0001", async () => {
      const rows = await rowsFor("warehouses", auditedWarehouseUuid);
      expect(rows).toHaveLength(1);

      await expect(
        outside.query(`DELETE FROM audit_logs WHERE id = $1`, [rows[0].id]),
      ).rejects.toMatchObject({ code: "P0001" });

      // Still there: the exception is the enforcement, not a warning.
      expect(await rowsFor("warehouses", auditedWarehouseUuid)).toHaveLength(1);
    });

    it("lets the same DELETE through under mobius.audit_maintenance", async () => {
      const rows = await rowsFor("warehouses", auditedWarehouseUuid);
      expect(rows).toHaveLength(1);

      await inMaintenance([
        [`DELETE FROM audit_logs WHERE id = $1`, [rows[0].id]],
      ]);

      expect(await rowsFor("warehouses", auditedWarehouseUuid)).toHaveLength(0);
    });
  });

  // ==================== partition routing ====================

  describe("partition routing", () => {
    it("puts nothing in the DEFAULT partition", async () => {
      // A row in `audit_logs_default` inside month M permanently blocks
      // creating M's partition, so this is not hygiene — it is the thing that
      // makes the next `ensureAuditPartitions` run possible at all.
      expect(await tableCount("audit_logs_default")).toBe(0);
    });

    it("routes this run's rows into the current month's partition", async () => {
      const result = await outside.query<CountRow>(
        `SELECT count(*) FROM audit_logs
          WHERE tableoid = to_regclass('public.audit_logs_y'
                || to_char(now(), 'YYYY') || 'm' || to_char(now(), 'MM'))
            AND "companyId" = $1`,
        [companyId],
      );
      expect(Number(result.rows[0].count)).toBeGreaterThan(0);
    });
  });

  // ==================== the job actor (T3b) ====================

  describe("a job running under withAuditContext", () => {
    it("attributes its rows to source='job' and the job's username", async () => {
      const uuid = newUuid();

      await withAuditContext(
        { source: "job", username: "node-files-worker", companyId },
        async () => {
          await db("erp")("warehouses").insert({
            uuid,
            name: mark("WH-JOB"),
            company_id: companyId,
            grid_rows: 1,
            grid_cols: 1,
          });
        },
      );

      const rows = await rowsFor("warehouses", uuid);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("Alta");
      expect(rows[0].source).toBe("job");
      expect(rows[0].username).toBe("node-files-worker");
      expect(rows[0].companyId).toBe(companyId);
    });
  });
});
