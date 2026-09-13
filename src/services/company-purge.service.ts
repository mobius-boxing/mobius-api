import { db, physicalKeyOf } from "../database/registry";
import { DB_KEYS, DbKey, PhysicalKey } from "../database/keys";

/**
 * Company purge — the ONE sanctioned door for removing ledger rows
 * (audit P2, track T3; handbook §P2.7, design §5.5 / §15.3).
 *
 * ## Why this file exists
 *
 * Two P0 decisions collide. Q-F1 made `audit_logs` append-only, enforced in the
 * database by a `BEFORE UPDATE OR DELETE` trigger that raises `P0001`
 * (`audit-triggers.ts` → `PROTECTION_FUNCTION_SQL`). Q-F2 kept "deleting a
 * company deletes its trail". Without this routine those two answers make
 * company deletion **impossible**: every path into the ledger raises.
 *
 * The resolution is `mobius.audit_maintenance = 'on'`, set **transaction-locally**
 * for the purge's own transaction, which the protection trigger honours.
 *
 * ## The two settings, and why both
 *
 * - `mobius.audit_maintenance = 'on'` — tells the protection trigger to let
 *   this transaction's DELETEs through. Without it: `P0001`.
 * - `mobius.audit_skip = 'on'` — tells `audit_row_change` to write nothing.
 *   Without it, deleting the company fires `ON DELETE CASCADE` across the
 *   tenant's business data and every one of those 74 triggers INSERTs a `Baja`
 *   row for a company that no longer exists — thousands of rows written by the
 *   very statement whose job is to remove them.
 *
 * Both are set with `set_config(..., true)`: the third argument is
 * `is_local`. **It must stay `true`.** With `false` the setting is
 * *session*-scoped, and because the connection goes back to a shared pool the
 * next request served by that connection would inherit maintenance mode — an
 * append-only ledger that silently accepts DELETEs, plus audit capture off, for
 * an unrelated tenant. `true` makes both settings die with the transaction, on
 * commit **and** on rollback.
 *
 * ## Nothing else may set `mobius.audit_maintenance`
 *
 * This routine is the first legitimate user. The second, and the only other one
 * planned, is the **retention job of P5** (§5.5: it deletes aged rows and writes
 * one summary row). Db-guarded tests set it to clean up rows they wrote (L-013),
 * which is the same door held open for a test. Any other writer is a defect:
 * the value of an append-only ledger is exactly the number of ways there are to
 * edit it.
 *
 * ## No summary row in P2 — deferred to P5, deliberately
 *
 * §5.5 pairs "remove ledger rows" with "write one summary row", and the
 * protection trigger would not object (it is `BEFORE UPDATE OR DELETE`; an
 * INSERT never reaches it). It is still wrong here, for two reasons:
 *
 * 1. **T3 ships before the cutover.** Until T4 replaces the table, this code
 *    runs against the v1 `audit_logs`, which has no `action`, `source`,
 *    `requestId` or `txId` column — the only columns that could say "this was a
 *    purge". A v2-shaped INSERT would make company deletion throw for the whole
 *    life of the intermediate state; a v1-shaped one could not record the fact.
 * 2. **P2's end state is "zero application code writes to `audit_logs`"** (the
 *    whole point of moving capture into triggers, AC-19). Re-introducing one
 *    application write in the track that precedes the cutover contradicts it.
 *
 * So the purge is currently *silent*: `audit_skip` suppresses the cascade's
 * `Baja` rows and the trail is deleted, leaving no trace that the tenant ever
 * existed. That is a known, stated gap for P5 to close together with the
 * retention job's summary row — not something to improvise here.
 *
 * ## One transaction per physical DATABASE, not per key — and why
 *
 * §P2.7 loops `DB_KEYS`. Doing that literally **hangs every company delete**,
 * and the hang is invisible to any mocked test. P1 holds one ambient
 * transaction per key, each on its own pooled backend, open until the response
 * is sent. All four module-split keys resolved to one physical database, so the
 * loop had `core`'s backend delete the ledger rows and then sit uncommitted
 * waiting for the handler to return, while `erp`'s backend — a *different*
 * session against the *same* table — blocked on `core`'s uncommitted delete.
 * Postgres cannot break that: `core` waits on the client, so there is no cycle
 * for the deadlock detector to find. Observed live as
 * `idle in transaction / ClientRead` next to `active / Lock: transactionid`.
 *
 * So the loop runs over **distinct physical databases**, discovered from
 * `physicalKeyOf(key)` — the same resolution the registry keys its pools and
 * ambient transactions by (db-per-company D-13). Today `core` and `tenant` are
 * one target and one ledger delete; once a company's database is its own they
 * become two, against disjoint row sets with no contention. The key still
 * selects the connection, it is just no longer assumed to select a *distinct*
 * one.
 *
 * ## Failure semantics
 *
 * One transaction per target, and each `db(key).transaction` callback that
 * throws rolls its own transaction back whole: the ledger rows come back, the
 * company comes back, and — because `is_local` is `true` — both settings revert
 * with it. Today there is exactly one target, so the purge is atomic outright.
 * After the split a failure on a later target leaves earlier ones committed,
 * which is why §P2.7 marks the per-key business-data deletes as belonging to
 * the split's own `purgeCompany` (T2c): coordinate there, do not duplicate.
 *
 * ## One note on the ambient transaction (P1)
 *
 * Inside an armed request `db(key).transaction()` opens a SAVEPOINT on the
 * request's ambient transaction rather than a top-level one, so both settings
 * outlive the savepoint's release and stay on until the request's transaction
 * ends. Still transaction-local, so still invisible to every other connection —
 * and the only statement left in that request is the response.
 */

/** What the purge removed. `companyDeleted: false` means "no such company". */
export type CompanyPurgeResult = {
  companyDeleted: boolean;
  ledgerRowsDeleted: number;
};

/**
 * Each physical database to open a transaction on, with the key that opens it.
 *
 * `core` is first in `DB_KEYS` and therefore always the representative of its
 * own database, which keeps the `companies` delete on a connection that owns
 * the table. `tenant` only earns its own transaction once it resolves to a
 * different database, without a line changing here.
 */
const representatives = (): Map<PhysicalKey, DbKey> => {
  const byTarget = new Map<PhysicalKey, DbKey>();
  for (const key of DB_KEYS) {
    const physical = physicalKeyOf(key);
    if (!byTarget.has(physical)) byTarget.set(physical, key);
  }
  return byTarget;
};

/** The physical databases a purge opens one transaction on, in order. */
export const purgeTargets = (): PhysicalKey[] => [...representatives().keys()];

/**
 * The node-files tables carry `companyId` with no foreign key to `companies`,
 * so the cascade never reaches them and they are deleted explicitly
 * (db-per-company T0, finding F-1). Children before parents, so the order is
 * safe whatever each foreign key's delete rule is (`nf_runs.workflowId` is
 * RESTRICT); `__tests__/db/company-purge.db.test.ts` checks it against
 * `pg_constraint`.
 */
export const NODE_FILES_PURGE_ORDER = [
  "nf_node_runs",
  "nf_runs",
  "nf_documents",
  "nf_workflow_credentials",
  "nf_workflows",
  "nf_credentials",
] as const;

/**
 * Every table whose company rows no `ON DELETE CASCADE` from `companies`
 * removes, because this routine deletes them itself. The P scripts refuse a
 * database holding any other such table.
 */
export const EXPLICITLY_PURGED_TABLES: readonly string[] = [
  "audit_logs",
  ...NODE_FILES_PURGE_ORDER,
];

/** `is_local = true` — see the "two settings" note above. Never `false`. */
const MAINTENANCE_ON =
  "select set_config('mobius.audit_maintenance', 'on', true)";
const SKIP_ON = "select set_config('mobius.audit_skip', 'on', true)";

/**
 * Remove a company: its audit trail first (explicitly — `audit_logs."companyId"`
 * carries NO foreign key under ruling R-B, so nothing cascades it away), then
 * its node-files rows (explicitly, for the same reason — see
 * `NODE_FILES_PURGE_ORDER`), then the company row itself, whose existing
 * `ON DELETE CASCADE`s take the tenant's business data with it.
 *
 * @param companyId internal numeric id (`CompanyDAO.getIdByUuid` / `.getByUuid`)
 */
export async function purgeCompany(
  companyId: number,
): Promise<CompanyPurgeResult> {
  let ledgerRowsDeleted = 0;
  let companyDeleted = false;

  for (const [physical, key] of representatives()) {
    await db(key).transaction(async (trx) => {
      // Both settings FIRST: every statement after this point depends on them.
      await trx.raw(MAINTENANCE_ON);
      await trx.raw(SKIP_ON);

      ledgerRowsDeleted += await trx("audit_logs")
        .where({ companyId })
        .delete();

      if (physical === physicalKeyOf("tenant")) {
        for (const table of NODE_FILES_PURGE_ORDER) {
          // Raw, because this transaction is guarded as `key` — `core` while
          // the tenant plane shares its database — and the wrong-database guard
          // rejects a tenant-owned table name there. A second transaction on the
          // tenant key is not an option: see "One transaction per physical
          // DATABASE" above.
          await trx.raw('delete from ?? where "companyId" = ?', [
            table,
            companyId,
          ]);
        }
      }

      // `companies` lives in core, and `core` is always a target (see
      // `purgeTargets`), so this branch always runs exactly once.
      if (key === "core") {
        const deleted = await trx("companies")
          .where({ id: companyId })
          .delete();
        companyDeleted = deleted > 0;
      }
    });
  }

  return { companyDeleted, ledgerRowsDeleted };
}
