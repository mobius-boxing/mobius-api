/**
 * Diff engine for child-collection upserts.
 *
 * Seven DAO writes used to persist a child collection by deleting every row and
 * re-inserting the whole payload. That churns row identity (uuids and numeric
 * ids change on every save) and buries the one thing an audit ledger cares
 * about — what the user actually changed — under a full rewrite. These two
 * helpers are the shared answer: the caller hands over the incoming payload and
 * the rows currently stored, and gets back the three (or four) buckets it needs
 * to emit DELETE / UPDATE / INSERT.
 *
 * Deliberately pure: no knex, no registry, no I/O, no async. The caller owns the
 * transaction, the SQL, the column allowlist and the server-side `uuidv4()`.
 * `architecture.test.ts` (AC-5, AC-56) enforces that this file stays that way.
 */

/** Result of a diff over rows that have a stable identity key. */
export type KeyedDiff<TIn, TEx> = {
  /** Matched pairs whose comparable columns differ; `changes` is never empty. */
  updates: Array<{
    existing: TEx;
    incoming: TIn;
    index: number;
    changes: Record<string, unknown>;
  }>;
  /** Incoming rows with no counterpart in `existing`. */
  inserts: Array<{ incoming: TIn; index: number }>;
  /** Existing rows no incoming row claimed, in the order `existing` was given. */
  deletes: TEx[];
};

/** Options for {@link diffKeyedRows}. */
export type KeyedDiffOptions<TIn, TEx> = {
  /** Client-supplied identity. `null`/`undefined` means "this row has none". */
  keyOfIncoming: (row: TIn) => string | null | undefined;
  keyOfExisting: (row: TEx) => string;
  /**
   * The comparable columns that differ, as a partial update patch. Returning
   * `{}` means "identical" — the caller decides which columns are comparable
   * (never `id`, `uuid`, the parent FK or `createdAt`).
   */
  changedColumns: (incoming: TIn, existing: TEx) => Record<string, unknown>;
  /** Default `true`. See the ordinal-fallback note on {@link diffKeyedRows}. */
  ordinalFallback?: boolean;
};

/**
 * Pair an incoming collection against the stored one by identity key.
 *
 * A matched pair whose `changedColumns` come back empty appears in **none** of
 * the three buckets — that is what makes "an identical payload writes nothing"
 * achievable.
 *
 * **Client uuids are references, never values.** An incoming key that is not in
 * `existing` (it belongs to another parent, or to nothing at all) is an INSERT,
 * never an UPDATE: the caller mints a fresh server-side uuid for it. The same
 * goes for a key that a *previous* incoming row already claimed.
 *
 * **Ordinal fallback.** When *every* incoming row is unkeyed — the state the API
 * lives in until the web app starts sending child uuids — `incoming[i]` pairs
 * with `existing[i]` (the caller passes `existing` in its natural order:
 * `number`/`position` ASC, or `id` ASC). Surplus incoming rows are inserts,
 * surplus existing rows are deletes. It is all-or-nothing on purpose: in a mixed
 * payload an unkeyed row is a genuinely new row, so the fallback cannot mispair
 * once uuids start arriving. Pass `ordinalFallback: false` to opt out entirely,
 * which makes every unkeyed row an insert.
 *
 * Duplicate incoming keys: the first occurrence wins the match; later ones are
 * treated as new rows. Two UPDATEs against one stored row would be conflicting
 * writes, and silently dropping the row would lose data and leave an ordinal
 * gap. Duplicate *existing* keys: the first wins the match, the rest are
 * deletes.
 *
 * Neither argument is mutated.
 */
export function diffKeyedRows<TIn, TEx>(
  incoming: readonly TIn[],
  existing: readonly TEx[],
  opts: KeyedDiffOptions<TIn, TEx>,
): KeyedDiff<TIn, TEx> {
  const updates: KeyedDiff<TIn, TEx>["updates"] = [];
  const inserts: KeyedDiff<TIn, TEx>["inserts"] = [];
  const matched: boolean[] = existing.map(() => false);

  const useOrdinal =
    opts.ordinalFallback !== false &&
    incoming.length > 0 &&
    incoming.every((row) => {
      const key = opts.keyOfIncoming(row);
      return key === null || key === undefined;
    });

  // First existing row wins a key; a later duplicate stays unmatched (deleted).
  const existingIndexByKey = new Map<string, number>();
  if (!useOrdinal) {
    existing.forEach((row, position) => {
      const key = opts.keyOfExisting(row);
      if (!existingIndexByKey.has(key)) existingIndexByKey.set(key, position);
    });
  }

  incoming.forEach((row, index) => {
    const position = useOrdinal
      ? index < existing.length
        ? index
        : undefined
      : resolveExistingIndex(row, opts, existingIndexByKey);

    if (position === undefined || matched[position]) {
      inserts.push({ incoming: row, index });
      return;
    }

    matched[position] = true;
    const pair = existing[position];
    const changes = opts.changedColumns(row, pair);
    if (Object.keys(changes).length > 0) {
      updates.push({ existing: pair, incoming: row, index, changes });
    }
  });

  const deletes = existing.filter((_row, position) => !matched[position]);

  return { updates, inserts, deletes };
}

/** Where an incoming row's key sits in `existing`, or `undefined` if nowhere. */
function resolveExistingIndex<TIn, TEx>(
  row: TIn,
  opts: KeyedDiffOptions<TIn, TEx>,
  existingIndexByKey: Map<string, number>,
): number | undefined {
  const key = opts.keyOfIncoming(row);
  if (key === null || key === undefined) return undefined;
  return existingIndexByKey.get(key);
}

/** Result of a diff over rows that carry no identity beyond their key. */
export type SetDiff<TIn, TEx> = {
  inserts: TIn[];
  deletes: TEx[];
  /** Existing rows the payload still contains — nothing to write for them. */
  unchanged: TEx[];
};

/**
 * Diff two collections that are pure sets: join rows whose key *is* the whole
 * row (`role_permissions`, `paper_class_papers`, group members, document
 * assignments). There is nothing to update, so the caller emits at most one bulk
 * DELETE and one bulk INSERT — and, for an unchanged set, neither.
 *
 * Duplicate incoming keys: the last occurrence wins (it is the row the caller
 * would have inserted last anyway), keeping the position of the first, so one
 * key can never produce two INSERTs. Duplicate existing keys land together in
 * `unchanged` or together in `deletes`, which is what a bulk delete by key does.
 *
 * Neither argument is mutated.
 */
export function diffSets<TIn, TEx>(
  incoming: readonly TIn[],
  existing: readonly TEx[],
  opts: {
    keyOfIncoming: (row: TIn) => string;
    keyOfExisting: (row: TEx) => string;
  },
): SetDiff<TIn, TEx> {
  const incomingByKey = new Map<string, TIn>();
  incoming.forEach((row) => incomingByKey.set(opts.keyOfIncoming(row), row));

  const existingKeys = new Set<string>();
  existing.forEach((row) => existingKeys.add(opts.keyOfExisting(row)));

  const inserts: TIn[] = [];
  incomingByKey.forEach((row, key) => {
    if (!existingKeys.has(key)) inserts.push(row);
  });

  const deletes: TEx[] = [];
  const unchanged: TEx[] = [];
  existing.forEach((row) => {
    if (incomingByKey.has(opts.keyOfExisting(row))) unchanged.push(row);
    else deletes.push(row);
  });

  return { inserts, deletes, unchanged };
}
