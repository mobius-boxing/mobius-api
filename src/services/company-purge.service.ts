import type { Knex } from "knex";
import {
  db,
  guardedForTenant,
  physicalKeyOf,
  rawCoreInstance,
} from "../database/registry";
import { DB_KEYS, DbKey, PhysicalKey } from "../database/keys";
import { type ForeignKeyDeleteRule } from "../database/cross-plane-refs";
import { GENERATED_CROSS_PLANE_REFS } from "../database/cross-plane-refs.generated";
import {
  closeDedicatedTenant,
  listDedicatedTenants,
  openDedicatedTenant,
  type DedicatedTenantTarget,
} from "../database/dedicated-tenants";
import { PURGE_HOOKS, declaredUserReferences } from "../modules/registry";

export { NODE_FILES_PURGE_ORDER } from "../modules/node-files/purge.hook";

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
 * T12a/D-orch-1: a `tenant_databases` row that never reached live never had a
 * database "handed to a tenant" — `failed` (the attempt errored out) or
 * `provisioning` (still building, or abandoned mid-build). RESTRICT (I-14)
 * exists to force an explicit decommission of a row a tenant actually used,
 * not to block deleting a company that never got one, so these are removed
 * here, before the `companies` delete, in the same transaction. A
 * `decommissioning`/`suspended`/`active` row is untouched by this and still
 * blocks the delete below via the FK (I-14 intent unchanged) — decommission
 * remains required first for any row a tenant actually used.
 */
const NON_LIVE_TENANT_DATABASE_STATUSES = ["failed", "provisioning"] as const;

/**
 * T12b/D-orch-1: named so the company-purge.db.test.ts suite can build its
 * "every table purgeCompany explicitly reaches" expectation from this real
 * value instead of a second, driftable copy of the string.
 */
export const NON_LIVE_TENANT_DATABASES_TABLE = "tenant_databases";

/**
 * Every table whose company rows no `ON DELETE CASCADE` from `companies`
 * removes, because this routine deletes them itself. The P scripts refuse a
 * database holding any other such table. `tenant_databases` belongs here: its
 * RESTRICT key is met by `deleteNonLiveTenantDatabaseRows`, and a live row
 * still refuses the company delete.
 */
export const EXPLICITLY_PURGED_TABLES: readonly string[] = [
  "audit_logs",
  NON_LIVE_TENANT_DATABASES_TABLE,
  ...PURGE_HOOKS.flatMap((hook) =>
    hook.companyRows === "explicit" ? hook.tables : [],
  ),
];

/** `is_local = true` — see the "two settings" note above. Never `false`. */
const MAINTENANCE_ON =
  "select set_config('mobius.audit_maintenance', 'on', true)";
const SKIP_ON = "select set_config('mobius.audit_skip', 'on', true)";

const deleteNonLiveTenantDatabaseRows = (
  trx: Knex.Transaction,
  companyId: number,
): Promise<number> =>
  trx(NON_LIVE_TENANT_DATABASES_TABLE)
    .where({ companyId })
    .whereIn("status", NON_LIVE_TENANT_DATABASE_STATUSES)
    .delete();

/**
 * Remove a company: its audit trail first (explicitly — `audit_logs."companyId"`
 * carries NO foreign key under ruling R-B, so nothing cascades it away), then
 * the rows of every module whose purge hook deletes explicitly (node-files, for
 * the same reason — see `modules/node-files/purge.hook.ts`), then the company
 * row itself, whose existing `ON DELETE CASCADE`s take the other modules'
 * business data with it.
 *
 * `decommissioningTenantDatabaseId` (T9, model I-14): `tenant_databases.companyId`
 * is `ON DELETE RESTRICT`, so a still-live row — even one already
 * `decommissioning` — blocks the `companies` delete below. Decommission
 * passes its own row's id here so it is removed, guarded to that exact
 * status, in the SAME transaction as the `companies` delete, immediately
 * before it: a failure earlier in this function leaves both rows exactly as
 * they were (I-14's "a rerun completes").
 *
 * @param companyId internal numeric id (`CompanyDAO.getIdByUuid` / `.getByUuid`)
 */
export async function purgeCompany(
  companyId: number,
  options: { decommissioningTenantDatabaseId?: number } = {},
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
        for (const hook of PURGE_HOOKS) {
          if (hook.companyRows === "explicit") {
            await hook.purgeCompany(trx, companyId);
          }
        }
      }

      // `companies` lives in core, and `core` is always a target (see
      // `purgeTargets`), so this branch always runs exactly once.
      if (key === "core") {
        await deleteNonLiveTenantDatabaseRows(trx, companyId);
        if (options.decommissioningTenantDatabaseId !== undefined) {
          await trx("tenant_databases")
            .where({
              id: options.decommissioningTenantDatabaseId,
              status: "decommissioning",
            })
            .delete();
        }
        const deleted = await trx("companies")
          .where({ id: companyId })
          .delete();
        companyDeleted = deleted > 0;
      }
    });
  }

  return { companyDeleted, ledgerRowsDeleted };
}

/**
 * The core-plane half of a purge, with none of `purgeCompany`'s tenant-plane
 * hook deletes (model D-20, D-38; brief T9 AC-55). Used by decommission for a
 * DEDICATED tenant: its business rows leave with the whole parked database
 * (I-14 — never dropped here, but never read again either), so explicitly
 * deleting them row by row would mean writing into a database this same
 * operation just renamed out from under its own connection pool.
 */
export async function purgeCompanyCentralOnly(
  companyId: number,
  options: { decommissioningTenantDatabaseId?: number } = {},
): Promise<CompanyPurgeResult> {
  let ledgerRowsDeleted = 0;
  let companyDeleted = false;
  await db("core").transaction(async (trx) => {
    await trx.raw(MAINTENANCE_ON);
    await trx.raw(SKIP_ON);
    ledgerRowsDeleted = await trx("audit_logs").where({ companyId }).delete();
    await deleteNonLiveTenantDatabaseRows(trx, companyId);
    if (options.decommissioningTenantDatabaseId !== undefined) {
      await trx("tenant_databases")
        .where({
          id: options.decommissioningTenantDatabaseId,
          status: "decommissioning",
        })
        .delete();
    }
    companyDeleted =
      (await trx("companies").where({ id: companyId }).delete()) > 0;
  });
  return { companyDeleted, ledgerRowsDeleted };
}

/** What `purgeUser` does to the rows holding one user reference. */
export type UserReferenceAction = "delete" | "set-null" | "refuse";

/** A tenant column holding a `users.id`, and what purging that user does to it. */
export type UserReference = {
  table: string;
  column: string;
  action: UserReferenceAction;
  source: "foreign-key" | "manifest";
};

/**
 * Each foreign key's own delete rule, applied by hand so the result is the same
 * once the tenant's database has no foreign key to `users`. RESTRICT and NO
 * ACTION refuse because that is what the database does today; SET DEFAULT has
 * no default to set a user id to, so it refuses too.
 */
const ACTION_BY_DELETE_RULE: Record<ForeignKeyDeleteRule, UserReferenceAction> =
  {
    CASCADE: "delete",
    "SET NULL": "set-null",
    RESTRICT: "refuse",
    "NO ACTION": "refuse",
    "SET DEFAULT": "refuse",
  };

const referenceName = (ref: { table: string; column: string }): string =>
  `${ref.table}.${ref.column}`;

/**
 * Every user reference in the tenant plane: the generated cross-plane
 * foreign keys (T12a — captured once while both planes shared a database;
 * `crossPlaneRefs` can no longer discover them live once a tenant has its
 * own database) plus the columns module manifests declare because they have
 * none. Where both name a column the foreign key's rule wins, since it is
 * what the database enforced when it was captured.
 */
export function userReferences(): UserReference[] {
  const fromForeignKeys = new Map<string, UserReference>();
  for (const ref of GENERATED_CROSS_PLANE_REFS) {
    if (ref.referencedTable !== "users") continue;
    fromForeignKeys.set(referenceName(ref), {
      table: ref.table,
      column: ref.column,
      action: ACTION_BY_DELETE_RULE[ref.deleteRule],
      source: "foreign-key",
    });
  }
  const fromManifests = declaredUserReferences()
    .filter((ref) => !fromForeignKeys.has(referenceName(ref)))
    .map(
      (ref): UserReference => ({
        table: ref.table,
        column: ref.column,
        action: ref.nullable ? "set-null" : "refuse",
        source: "manifest",
      }),
    );
  return [...fromForeignKeys.values(), ...fromManifests];
}

export type UserReferenceBlocker = { reference: string; rows: number };

/**
 * A user still referenced where the reference may not be removed. `code` is
 * the foreign-key-violation SQLSTATE, so the error middleware answers exactly
 * what deleting that user answered before the purge existed.
 */
export class UserPurgeRefusedError extends Error {
  readonly code = "23503";

  constructor(
    readonly userId: number,
    readonly blockers: readonly UserReferenceBlocker[],
  ) {
    super(
      `user ${userId} cannot be purged: still referenced by ${blockers
        .map(
          (b) => `${b.reference} (${b.rows} ${b.rows === 1 ? "row" : "rows"})`,
        )
        .join(", ")}`,
    );
    this.name = "UserPurgeRefusedError";
  }
}

export type UserPurgeResult = {
  userDeleted: boolean;
  /** `table.column` → rows deleted because they referenced the user. */
  rowsDeleted: Record<string, number>;
  /** `table.column` → values set to NULL. */
  valuesNulled: Record<string, number>;
};

const rowCountOf = (result: unknown): number =>
  (result as { rowCount?: number | null } | undefined)?.rowCount ?? 0;

/**
 * Remove a user and every tenant reference to it, per `userReferences`:
 * CASCADE rows deleted, SET NULL values nulled, and a refusal — before any
 * write — while a RESTRICT / NO ACTION or declared NOT NULL reference remains.
 *
 * The tenant plane goes first and the `users` row last, so a failure never
 * leaves tenant rows pointing at a user that is already gone. Audit capture
 * stays on: each deleted or nulled row writes its own trail, and the
 * ledger's rows by this user are kept.
 */
const countBlockers = async (
  runner: Knex,
  refuseRefs: readonly UserReference[],
  userId: number,
): Promise<UserReferenceBlocker[]> => {
  const blockers: UserReferenceBlocker[] = [];
  for (const ref of refuseRefs) {
    const result = (await runner.raw(
      "select count(*)::int as n from ?? where ?? = ?",
      [ref.table, ref.column, userId],
    )) as { rows: { n: number }[] };
    const rows = result.rows[0]?.n ?? 0;
    if (rows > 0) blockers.push({ reference: referenceName(ref), rows });
  }
  return blockers;
};

/** Deletes first (a row about to go needs no NULL written and audited), then nulls, `userId`'s references — inside whatever transaction `trx` already is. */
const writeReferences = async (
  trx: Knex,
  references: readonly UserReference[],
  userId: number,
  outcome: UserPurgeResult,
): Promise<void> => {
  for (const ref of references.filter((r) => r.action === "delete")) {
    const name = referenceName(ref);
    outcome.rowsDeleted[name] =
      (outcome.rowsDeleted[name] ?? 0) +
      rowCountOf(
        await trx.raw("delete from ?? where ?? = ?", [
          ref.table,
          ref.column,
          userId,
        ]),
      );
  }
  for (const ref of references.filter((r) => r.action === "set-null")) {
    const name = referenceName(ref);
    outcome.valuesNulled[name] =
      (outcome.valuesNulled[name] ?? 0) +
      rowCountOf(
        await trx.raw("update ?? set ?? = null where ?? = ?", [
          ref.table,
          ref.column,
          ref.column,
          userId,
        ]),
      );
  }
};

/** Recounts (T4/D-124) then writes `userId`'s references in one dedicated tenant database's own transaction. */
const purgeReferencesInOneTenant = async (
  tenantKnex: Knex,
  references: readonly UserReference[],
  refuseRefs: readonly UserReference[],
  userId: number,
  outcome: UserPurgeResult,
): Promise<void> => {
  await tenantKnex.transaction(async (trx) => {
    // T4/D-124: recount inside this transaction, immediately before any
    // write, closes most of the window a pre-flight taken outside any
    // transaction leaves open — a reference row written between the
    // pre-flight below and here is caught before anything is mutated in
    // THIS database.
    const raced = await countBlockers(
      trx as unknown as Knex,
      refuseRefs,
      userId,
    );
    if (raced.length > 0) throw new UserPurgeRefusedError(userId, raced);
    await writeReferences(trx as unknown as Knex, references, userId, outcome);
  });
};

export type PurgeUserDeps = {
  /** The shared/legacy target — pre-cutover, where "tenant" IS core (C0/C1, D-31's dedupe). */
  sharedTarget: () => Knex;
  listDedicatedTenants: () => Promise<DedicatedTenantTarget[]>;
  openTenant: (target: DedicatedTenantTarget) => Promise<Knex>;
  closeTenant: (knex: Knex) => Promise<void>;
};

/**
 * `guardedForTenant(rawCoreInstance())`, not `db("tenant")`: `purgeUser` runs
 * with no ambient tenant scope (a superAdmin's own request resolves no
 * tenant at all, D-62), and `db("tenant")` outside one throws (AC-49).
 */
const defaultPurgeUserDeps: PurgeUserDeps = {
  sharedTarget: () => guardedForTenant(rawCoreInstance()),
  listDedicatedTenants,
  openTenant: openDedicatedTenant,
  closeTenant: closeDedicatedTenant,
};

/**
 * T9/D-8, T4/D-124 follow-up (T12a, required before the first company move,
 * C2): loops the shared target plus every separate dedicated `tenant_*`
 * database (brief D-62's "every live tenant"), deduped by physical database
 * the same way `purgeCompany` is. Every target is recounted for refusals
 * BEFORE any of them is written to, so a refusal anywhere leaves every
 * database unchanged in the case that matters — a blocker already present
 * when the purge starts. Each target's writes then run inside that target's
 * OWN transaction (immediately preceded by its own race-closing recount), so
 * a race or a core-side RESTRICT cannot corrupt a target's own data; as with
 * `purgeCompany` (see its "Failure semantics" note), there is no cross-database
 * two-phase commit, so a race caught only in a LATER target's transaction can
 * still leave an earlier target's transaction already committed — an
 * accepted, stated limitation, not silently different from `purgeCompany`'s.
 * The `users` row is deleted last, in core, only once every tenant database
 * has succeeded.
 */
export async function purgeUser(
  userId: number,
  deps: PurgeUserDeps = defaultPurgeUserDeps,
): Promise<UserPurgeResult> {
  const references = userReferences();
  const refuseRefs = references.filter((r) => r.action === "refuse");

  const shared = deps.sharedTarget();
  const dedicated = await deps.listDedicatedTenants();

  const sharedPreflight = await countBlockers(shared, refuseRefs, userId);
  if (sharedPreflight.length > 0) {
    throw new UserPurgeRefusedError(userId, sharedPreflight);
  }

  const opened: { target: DedicatedTenantTarget; knex: Knex }[] = [];
  try {
    for (const target of dedicated) {
      const knex = await deps.openTenant(target);
      opened.push({ target, knex });
      const blockers = await countBlockers(knex, refuseRefs, userId);
      if (blockers.length > 0)
        throw new UserPurgeRefusedError(userId, blockers);
    }

    const outcome: UserPurgeResult = {
      userDeleted: false,
      rowsDeleted: {},
      valuesNulled: {},
    };

    // Dedicated tenants first, each in its own transaction.
    for (const { knex } of opened) {
      await purgeReferencesInOneTenant(
        knex,
        references,
        refuseRefs,
        userId,
        outcome,
      );
    }

    // The shared target LAST, and combined with the `users` delete in ONE
    // transaction: it is physically core (D-31's dedupe) — the same target
    // `db("core")` reaches — so this is D-108's "while tenants share one
    // database, one transaction covers everything," and it only runs once
    // every dedicated tenant above has already committed.
    await shared.transaction(async (trx) => {
      const raced = await countBlockers(
        trx as unknown as Knex,
        refuseRefs,
        userId,
      );
      if (raced.length > 0) throw new UserPurgeRefusedError(userId, raced);
      await writeReferences(
        trx as unknown as Knex,
        references,
        userId,
        outcome,
      );
      // Raw, not `trx("users")`: `shared` is guarded as "tenant" (T11/D-6's
      // shape), and `users` belongs to core — the wrong-database guard would
      // reject the callable form even though this transaction's connection
      // IS core (D-31's dedupe).
      outcome.userDeleted =
        rowCountOf(
          await (trx as unknown as Knex).raw("delete from users where id = ?", [
            userId,
          ]),
        ) > 0;
    });

    return outcome;
  } finally {
    for (const { knex } of opened) await deps.closeTenant(knex);
  }
}
