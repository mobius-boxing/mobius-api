import { Knex } from "knex";
import { AuditParent } from "./audit-coverage";

/**
 * The audit ledger's DDL and its trigger library (P2 / §P2.2 + §P2.3).
 *
 * This module is **inert**: it exports SQL text and helpers that build SQL.
 * Nothing here runs until the migration (T4) calls it, and nothing here holds a
 * connection of its own — every helper takes the `knex` handle to run on, so
 * the database-per-module split later changes *which* connection the migration
 * uses and not a line of this file.
 *
 * Two rules govern every string below.
 *
 * 1. **§0 rule 6 — no bare `?` in raw SQL.** knex reads every `?` as a binding
 *    placeholder, so the jsonb key-existence operator is written
 *    `jsonb_exists(col, key)`. The unit test greps the generated SQL for `?`.
 * 2. **Idempotence (Amendment constraint 1).** `CREATE TABLE IF NOT EXISTS`,
 *    `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`.
 *    At the split's cutover this same migration re-runs against each new
 *    database and must be create-or-no-op, never a rewrite.
 *
 * `CREATE TRIGGER` and `CREATE TABLE` are utility statements: PostgreSQL does
 * not accept bind parameters in them, so identifiers and trigger arguments are
 * interpolated. Everything interpolated is validated first
 * (`assertTableName` / `assertColumnName`) or generated here (partition names
 * and bounds); no caller-supplied value ever reaches the string unchecked.
 */

/** Trigger name on every audited table, and the function it executes. */
export const AUDIT_TRIGGER_NAME = "audit_row_change";

/** Months of partitions the migration creates ahead of today (§0.3-11). */
export const DEFAULT_MONTHS_AHEAD = 13;

/**
 * Table identifiers. Every audited table is lowercase snake_case — the one
 * camelCase table in the schema, `emailTokens`, is in `AUDIT_EXCLUDED`.
 */
const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Column identifiers are *not* lowercase-only: most of the schema is camelCase
 * (`corrugationId`, `secretCiphertext`), a few tables are snake_case
 * (`warehouse_id`). They still may not contain a quote, a comma or a space —
 * they travel inside the single-quoted trigger arguments.
 */
const COLUMN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertTableName(name: string): string {
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error(`audit: invalid table identifier "${name}"`);
  }
  return name;
}

function assertColumnName(name: string): string {
  if (!COLUMN_NAME_RE.test(name)) {
    throw new Error(`audit: invalid column identifier "${name}"`);
  }
  return name;
}

/**
 * The v2 ledger (§P2.2).
 *
 * Partitioned by month on `"occurredAt"` from creation, with a DEFAULT
 * partition as the catch-all. **A row that lands in `audit_logs_default` with
 * an `occurredAt` inside month M permanently blocks
 * `CREATE TABLE … PARTITION OF … FOR VALUES FROM (M) TO (M+1)`** — the
 * statement fails until that row is moved. `ensureAuditPartitions` therefore
 * runs 13 months ahead, far enough that the default partition should always be
 * empty; the schema test asserts that it is.
 *
 * No foreign keys, deliberately (ruling R-B, 2026-09-01):
 * - `"companyId"` is a *value*, not a reference. It keeps this DDL
 *   byte-identical for all four database keys at the split's cutover, where
 *   three of them will not contain `companies` at all — and it is what makes
 *   ruling R-A (a company's own rows attributed to itself) expressible, since
 *   a `Baja` row would otherwise reference the company just deleted.
 * - `"userId"` likewise: an FK with `ON DELETE SET NULL` would *rewrite the
 *   ledger* when a user is deleted, which an append-only table must never do.
 *
 * `operation` and `source` are text with CHECK constraints, never PG enums
 * (code-style: enums are painful to extend). The partition key must appear in
 * every unique constraint, hence the composite PK and UNIQUE.
 */
const AUDIT_LOGS_V2_DDL = `
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                  bigserial   NOT NULL,
  uuid                uuid        NOT NULL DEFAULT gen_random_uuid(),
  "companyId"         integer,
  "entityName"        text        NOT NULL,
  "entityId"          integer,
  "entityUuid"        uuid,
  "entityCode"        text,
  "entityDescription" text,
  operation           text        NOT NULL CHECK (operation IN ('Alta','Baja','Modificacion')),
  before              jsonb,
  after               jsonb,
  "changedKeys"       text[],
  "rootEntity"        text,
  "rootUuid"          uuid,
  action              text,
  source              text        NOT NULL DEFAULT 'sql'
                        CHECK (source IN ('api','job','seed','migration','script','sql')),
  "txId"              bigint,
  "requestId"         uuid,
  username            text,
  "userId"            integer,
  "actorRole"         text,
  "actorCompanyId"    integer,
  context             jsonb,
  "entityLegacyId"    integer,
  "legacyId"          integer,
  "occurredAt"        timestamptz NOT NULL DEFAULT now(),
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, "occurredAt"),
  UNIQUE (uuid, "occurredAt")
) PARTITION BY RANGE ("occurredAt");

CREATE TABLE IF NOT EXISTS public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON public.audit_logs ("companyId","entityName","entityUuid","occurredAt");
CREATE INDEX IF NOT EXISTS audit_logs_company_time_idx
  ON public.audit_logs ("companyId","occurredAt");
CREATE INDEX IF NOT EXISTS audit_logs_root_idx
  ON public.audit_logs ("companyId","rootEntity","rootUuid","occurredAt");
CREATE INDEX IF NOT EXISTS audit_logs_user_idx
  ON public.audit_logs ("companyId","userId","occurredAt");
CREATE INDEX IF NOT EXISTS audit_logs_tx_idx
  ON public.audit_logs ("txId");
CREATE INDEX IF NOT EXISTS audit_logs_changed_keys_idx
  ON public.audit_logs USING gin ("changedKeys");
`;

/**
 * The row trigger every audited table executes (§P2.3, plus the corrections of
 * §0.3-1 and rulings R-A / R-B).
 *
 * Arguments are positional and match `AUDIT_PARENT`'s flat shape:
 * `(exclude_csv, parent, fk, grand, grand_fk)`; an absent argument is `''`,
 * which the function reads as NULL.
 *
 * Properties worth knowing before reading the SQL:
 *
 * - **Record the event, never the value** (ruling 2026-09-01). Change detection
 *   runs on the *unredacted* rows, so a change confined to a redacted column
 *   still writes a `Modificacion`: `changedKeys` names the column, and both
 *   `before` and `after` omit that key **entirely** — absent, not null, so
 *   nothing downstream can mistake a redaction for a real NULL. You can see
 *   that user X's password changed and when; never what it was or became.
 *   The rejected alternative was to redact before diffing, which wrote **no row
 *   at all** for a password reset — leaving an attacker who resets a password
 *   invisible in the ledger, the one event a security audit most wants.
 *   This applies **uniformly to every `AUDIT_REDACT` column**, not only to
 *   `users.password`. The ruling was phrased around passwords, but
 *   `invitations.token` and `nf_credentials.secret*` are the same shape of
 *   secret; a password-only special case would be more code and more
 *   surprising than the rule it implements. Recorded here so the uniformity is
 *   a decision, not an accident.
 * - **V-1, diff only on `Modificacion`.** Whole row in `after` for `Alta`,
 *   whole row in `before` for `Baja`, and on UPDATE only the columns that
 *   actually changed, on both sides, plus a sorted `changedKeys`.
 *   `updatedAt`/`updated_at` alone never makes a row look changed, and an
 *   UPDATE that changes nothing writes nothing (the no-op guard) — which is
 *   what P1b's diff-and-upsert child writes exist to make possible.
 * - **snake_case is real here** (§0.3-1). `warehouses.company_id` and
 *   `warehouse_locations.warehouse_id` are snake_case while most of the schema
 *   is camelCase, so the company lookup COALESCEs over both spellings and the
 *   parent-fk lookups derive the other spelling and try it too. A single
 *   `full_row ->> 'companyId'` would silently attribute every warehouse row to
 *   no company at all.
 * - **`companies` is special-cased** (ruling R-A): it has no `companyId`
 *   column, so without this its own history would be attributed to the
 *   *actor's* company (usually a superAdmin's null) and be invisible to the
 *   tenant it is about. The row is attributed to the company being edited.
 * - **Cascade deletes lose `rootUuid`** (§0.3-9). The `AFTER DELETE` trigger on
 *   a child runs after the parent row is already gone, so the
 *   `SELECT uuid FROM <parent>` finds nothing and `rootUuid` is NULL. Accepted:
 *   the parent's own `Baja` row shares the `txId`, and grouping by `txId` is
 *   already how the viewer reconstructs a transaction.
 * - **Escape hatches.** `mobius.audit_skip = 'on'` (seeds, bulk loads, the
 *   purge path) returns NULL before anything else happens. Both settings are
 *   read with `current_setting(…, true)`, so a missing setting is not an error.
 * - The `BEGIN … EXCEPTION` block around the jsonb cast is what makes a
 *   malformed `mobius.audit` harmless: the row is still audited, without
 *   context. It opens a subtransaction per audited row; measure before
 *   replacing it with PG 16's `IS JSON` predicate.
 */
export const AUDIT_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $audit_row_change$
DECLARE
  ctx          jsonb;
  excluded     text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[0], ''), ','), ARRAY[]::text[]);
  parent_tbl   text   := NULLIF(TG_ARGV[1], '');
  parent_fk    text   := NULLIF(TG_ARGV[2], '');
  grand_tbl    text   := NULLIF(TG_ARGV[3], '');
  grand_fk     text   := NULLIF(TG_ARGV[4], '');   -- column ON THE PARENT pointing at the grandparent
  ignored      text[] := ARRAY['updatedAt','updated_at'];
  op           text;
  b            jsonb;   -- OLD: whole row while diffing, redacted before it is stored
  a            jsonb;   -- NEW: same
  full_row     jsonb;   -- whole row, for entityCode / entityDescription / companyId / fks
  changed      text[];
  company      integer;
  parent_id    integer;
  alt_fk       text;
  alt_grand_fk text;
  grand_id     text;
  root_entity  text;
  root_uuid    uuid;
BEGIN
  IF current_setting('mobius.audit_skip', true) = 'on' THEN RETURN NULL; END IF;

  BEGIN
    ctx := NULLIF(current_setting('mobius.audit', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    ctx := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    op := 'Alta';
    a := to_jsonb(NEW) - excluded;  b := NULL;  full_row := a;
  ELSIF TG_OP = 'UPDATE' THEN
    op := 'Modificacion';
    -- Unredacted on purpose: change detection must SEE a redacted column change
    -- (record the event); the values are stripped once the diff is taken.
    b := to_jsonb(OLD);  a := to_jsonb(NEW);  full_row := a - excluded;
    -- no-op guard: an UPDATE that changed nothing, or only a timestamp, is not history
    IF (b - ignored) = (a - ignored) THEN RETURN NULL; END IF;
    SELECT array_agg(k ORDER BY k) INTO changed FROM (
      SELECT e.key AS k FROM jsonb_each(a) e
       WHERE NOT jsonb_exists(b, e.key) OR (b -> e.key) IS DISTINCT FROM (a -> e.key)
      UNION
      SELECT e.key FROM jsonb_each(b) e WHERE NOT jsonb_exists(a, e.key)
    ) s WHERE NOT (k = ANY(ignored));
    -- V-1: keep only the changed keys, on both sides. The trailing \`- excluded\`
    -- drops the redacted VALUES while \`changed\` keeps their NAMES: the event is
    -- recorded, the secret is not.
    b := COALESCE((SELECT jsonb_object_agg(k, b -> k) FROM unnest(changed) k WHERE jsonb_exists(b, k)), '{}'::jsonb) - excluded;
    a := COALESCE((SELECT jsonb_object_agg(k, a -> k) FROM unnest(changed) k WHERE jsonb_exists(a, k)), '{}'::jsonb) - excluded;
  ELSE
    op := 'Baja';
    b := to_jsonb(OLD) - excluded;  a := NULL;  full_row := b;
  END IF;

  -- §0.3-1: \`warehouses.company_id\` is snake_case; \`full_row ->> 'companyId'\`
  -- alone would attribute every warehouse row to no company.
  company := COALESCE(
    (full_row ->> 'companyId')::integer,
    (full_row ->> 'company_id')::integer,
    (ctx ->> 'companyId')::integer);

  -- R-A: \`companies\` has no companyId column. Attribute its rows to itself,
  -- not to the actor's company, or a tenant can never see its own history.
  IF TG_TABLE_NAME = 'companies' THEN
    company := (full_row ->> 'id')::integer;
  END IF;

  -- The parent fk may be recorded in either convention, and the table may use
  -- the other one (\`warehouse_locations.warehouse_id\` next to
  -- \`corrugation_layers.corrugationId\`): try the recorded spelling, then the
  -- opposite one. \`initcap\` capitalises space-separated words, which is why the
  -- snake -> camel direction goes through '_' -> ' ' and back.
  IF parent_tbl IS NOT NULL AND parent_fk IS NOT NULL THEN
    alt_fk := CASE
      WHEN position('_' in parent_fk) > 0 THEN
        lower(left(replace(initcap(replace(parent_fk, '_', ' ')), ' ', ''), 1))
          || substr(replace(initcap(replace(parent_fk, '_', ' ')), ' ', ''), 2)
      ELSE lower(regexp_replace(parent_fk, '([a-z0-9])([A-Z])', '\\1_\\2', 'g'))
    END;
    parent_id := COALESCE((full_row ->> parent_fk)::integer, (full_row ->> alt_fk)::integer);
    IF parent_id IS NOT NULL THEN
      IF grand_tbl IS NOT NULL AND grand_fk IS NOT NULL THEN
        alt_grand_fk := CASE
          WHEN position('_' in grand_fk) > 0 THEN
            lower(left(replace(initcap(replace(grand_fk, '_', ' ')), ' ', ''), 1))
              || substr(replace(initcap(replace(grand_fk, '_', ' ')), ' ', ''), 2)
          ELSE lower(regexp_replace(grand_fk, '([a-z0-9])([A-Z])', '\\1_\\2', 'g'))
        END;
        EXECUTE format(
          'SELECT COALESCE(to_jsonb(p.*) ->> %L, to_jsonb(p.*) ->> %L) FROM public.%I p WHERE p.id = $1',
          grand_fk, alt_grand_fk, parent_tbl)
          INTO grand_id USING parent_id;
        parent_id := grand_id::integer;
        root_entity := grand_tbl;
        EXECUTE format('SELECT uuid FROM public.%I WHERE id = $1', grand_tbl)
          INTO root_uuid USING parent_id;
      ELSE
        root_entity := parent_tbl;
        EXECUTE format('SELECT uuid FROM public.%I WHERE id = $1', parent_tbl)
          INTO root_uuid USING parent_id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    "companyId","entityName","entityId","entityUuid","entityCode","entityDescription",
    operation, before, after, "changedKeys","rootEntity","rootUuid", action, source,
    "txId","requestId", username,"userId","actorRole","actorCompanyId", context)
  VALUES (
    company, TG_TABLE_NAME, (full_row ->> 'id')::integer, (full_row ->> 'uuid')::uuid,
    COALESCE(full_row ->> 'code', full_row ->> 'number'),
    COALESCE(full_row ->> 'description', full_row ->> 'name', full_row ->> 'title'),
    op, b, a, changed, root_entity, root_uuid, ctx ->> 'action', COALESCE(ctx ->> 'source', 'sql'),
    txid_current(), (ctx ->> 'requestId')::uuid, ctx ->> 'username', (ctx ->> 'userId')::integer,
    ctx ->> 'role', (ctx ->> 'actorCompanyId')::integer, ctx -> 'context');
  RETURN NULL;
END $audit_row_change$;
`;

/**
 * Append-only enforcement in the database itself (decision Q-F1).
 *
 * `mobius.audit_maintenance = 'on'` is the one door: the purge path sets it
 * transaction-locally so `purgeCompany` can remove a tenant's trail, and the
 * db-guarded tests set it to clean up after themselves (L-013). Everything
 * else — including a stray `DELETE FROM audit_logs` in a test suite — gets
 * `P0001`.
 */
export const PROTECTION_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION public.audit_logs_protect() RETURNS trigger
LANGUAGE plpgsql AS $audit_logs_protect$
BEGIN
  IF current_setting('mobius.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (%.% on id=%)', TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id
    USING ERRCODE = 'P0001';
END $audit_logs_protect$;

DROP TRIGGER IF EXISTS audit_logs_protect ON public.audit_logs;
CREATE TRIGGER audit_logs_protect BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_protect();
`;

/** Creates the v2 ledger, its DEFAULT partition and its six indexes. */
export async function createAuditLogsV2(knex: Knex): Promise<void> {
  await knex.raw(AUDIT_LOGS_V2_DDL);
}

/** One monthly partition: its table name and its half-open bounds. */
export type AuditPartitionSpec = {
  name: string;
  from: string;
  to: string;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `2026-09-01 00:00:00+00` — explicit UTC, so the session's TimeZone cannot
 * shift a partition boundary between the migration and the next run. */
const bound = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-01 00:00:00+00`;

/**
 * The months to create, from `start`'s month through `monthsAhead` months later
 * inclusive. `Date.UTC` normalises the December -> January rollover: month
 * index 12 of year Y is month 0 of year Y+1.
 */
export function auditPartitionSpecs(
  start: Date,
  monthsAhead: number = DEFAULT_MONTHS_AHEAD,
): AuditPartitionSpec[] {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const specs: AuditPartitionSpec[] = [];
  for (let i = 0; i <= monthsAhead; i += 1) {
    const from = new Date(Date.UTC(year, month + i, 1));
    const to = new Date(Date.UTC(year, month + i + 1, 1));
    specs.push({
      name: `audit_logs_y${from.getUTCFullYear()}m${pad2(from.getUTCMonth() + 1)}`,
      from: bound(from),
      to: bound(to),
    });
  }
  return specs;
}

/**
 * Creates the monthly partitions from this month forward.
 *
 * Called by the migration; P5 owns the scheduled run. Nothing schedules it in
 * P2, so `monthsAhead` is also the deadline: once the last partition's month
 * passes, rows fall into `audit_logs_default` and — see `AUDIT_LOGS_V2_DDL` —
 * that month can no longer be partitioned off without moving them.
 */
export async function ensureAuditPartitions(
  knex: Knex,
  monthsAhead: number = DEFAULT_MONTHS_AHEAD,
): Promise<void> {
  for (const spec of auditPartitionSpecs(new Date(), monthsAhead)) {
    await knex.raw(
      `CREATE TABLE IF NOT EXISTS public."${spec.name}" PARTITION OF public.audit_logs ` +
        `FOR VALUES FROM ('${spec.from}') TO ('${spec.to}');`,
    );
  }
}

export type AttachAuditOptions = {
  /** Columns the trigger strips before it looks at the row (`AUDIT_REDACT`). */
  exclude?: string[];
  /** The row's owning entity (`AUDIT_PARENT`) — flat, as the trigger reads it. */
  parent?: AuditParent;
};

/**
 * Attaches (or re-attaches) `audit_row_change` to one table.
 *
 * `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` rather than
 * `CREATE OR REPLACE TRIGGER` so the statement is idempotent on every
 * supported version, and so re-running the migration after a coverage change
 * rewrites the arguments instead of leaving stale ones.
 *
 * The five arguments are positional and every absent one is `''`.
 */
export async function attachAudit(
  knex: Knex,
  table: string,
  opts: AttachAuditOptions = {},
): Promise<void> {
  const target = assertTableName(table);
  const exclude = (opts.exclude ?? []).map(assertColumnName).join(",");
  const parent = opts.parent;
  const args = [
    exclude,
    parent ? assertTableName(parent.parent) : "",
    parent ? assertColumnName(parent.fk) : "",
    parent?.grand ? assertTableName(parent.grand) : "",
    parent?.grandFk ? assertColumnName(parent.grandFk) : "",
  ]
    .map((arg) => `'${arg}'`)
    .join(", ");

  await knex.raw(
    `DROP TRIGGER IF EXISTS ${AUDIT_TRIGGER_NAME} ON public."${target}";\n` +
      `CREATE TRIGGER ${AUDIT_TRIGGER_NAME} AFTER INSERT OR UPDATE OR DELETE ON public."${target}"\n` +
      `  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(${args});`,
  );
}

/**
 * Removes the trigger from one table. The emergency stop for the whole phase is
 * this, for each audited table — or `DROP FUNCTION public.audit_row_change()
 * CASCADE`, which drops all of them in one statement and leaves the ledger in
 * place with capture off.
 */
export async function detachAudit(knex: Knex, table: string): Promise<void> {
  const target = assertTableName(table);
  await knex.raw(
    `DROP TRIGGER IF EXISTS ${AUDIT_TRIGGER_NAME} ON public."${target}";`,
  );
}
