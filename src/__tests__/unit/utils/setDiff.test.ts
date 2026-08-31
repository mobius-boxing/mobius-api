/**
 * `setDiff` is the shared engine behind seven child-collection upserts. Every
 * rule it encodes is a write the DAOs must or must not emit:
 *
 * - a matched-and-identical row lands in no bucket at all → an identical PUT
 *   issues zero statements (AC-3);
 * - the ordinal fallback fires only when the *whole* incoming array is unkeyed,
 *   so it cannot mispair once the web app starts sending uuids (AC-2);
 * - an unknown incoming uuid is an INSERT, never an UPDATE, so a client-supplied
 *   uuid is never trusted or written through (AC-9);
 * - `index` is the incoming array position, because the DAOs assign
 *   `number`/`position` from it.
 *
 * No database, no mocks — pure functions.
 */
import { describe, expect, it } from "@jest/globals";
import {
  KeyedDiff,
  SetDiff,
  diffKeyedRows,
  diffSets,
} from "../../../utils/setDiff";

type IncomingRow = { uuid?: string | null; label: string };
type ExistingRow = { id: number; uuid: string; label: string };

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";
/** A uuid the client made up, or that belongs to another parent. */
const FOREIGN = "ffffffff-0000-0000-0000-00000000000f";

const stored = (id: number, uuid: string, label: string): ExistingRow => ({
  id,
  uuid,
  label,
});

const keyedOptions = {
  keyOfIncoming: (row: IncomingRow) => row.uuid,
  keyOfExisting: (row: ExistingRow) => row.uuid,
  changedColumns: (incoming: IncomingRow, existing: ExistingRow) =>
    incoming.label === existing.label ? {} : { label: incoming.label },
};

/** Compact, assertable shape: which bucket, at which incoming index. */
type DiffSummary = {
  updates: Array<{ index: number; existingId: number; label: string }>;
  inserts: Array<{ index: number; label: string }>;
  deletes: number[];
};

const summarise = (diff: KeyedDiff<IncomingRow, ExistingRow>): DiffSummary => ({
  updates: diff.updates.map((u) => ({
    index: u.index,
    existingId: u.existing.id,
    label: String(u.changes.label),
  })),
  inserts: diff.inserts.map((i) => ({
    index: i.index,
    label: i.incoming.label,
  })),
  deletes: diff.deletes.map((d) => d.id),
});

const EXISTING_THREE = [
  stored(10, A, "one"),
  stored(11, B, "two"),
  stored(12, C, "three"),
];

const keyedCases: Array<{
  name: string;
  incoming: IncomingRow[];
  existing: ExistingRow[];
  ordinalFallback?: boolean;
  expected: DiffSummary;
}> = [
  {
    name: "all keyed, payload identical to storage → nothing to write",
    incoming: [
      { uuid: A, label: "one" },
      { uuid: B, label: "two" },
      { uuid: C, label: "three" },
    ],
    existing: EXISTING_THREE,
    expected: { updates: [], inserts: [], deletes: [] },
  },
  {
    name: "all keyed, one field changed → exactly one update",
    incoming: [
      { uuid: A, label: "one" },
      { uuid: B, label: "TWO" },
      { uuid: C, label: "three" },
    ],
    existing: EXISTING_THREE,
    expected: {
      updates: [{ index: 1, existingId: 11, label: "TWO" }],
      inserts: [],
      deletes: [],
    },
  },
  {
    name: "all keyed, reordered → matched by key, not by position",
    incoming: [
      { uuid: C, label: "three" },
      { uuid: B, label: "two" },
      { uuid: A, label: "one" },
    ],
    existing: EXISTING_THREE,
    expected: { updates: [], inserts: [], deletes: [] },
  },
  {
    name: "a key missing from existing is an insert, never an update",
    incoming: [
      { uuid: A, label: "one" },
      { uuid: FOREIGN, label: "smuggled" },
    ],
    existing: [stored(10, A, "one"), stored(11, B, "two")],
    expected: {
      updates: [],
      inserts: [{ index: 1, label: "smuggled" }],
      deletes: [11],
    },
  },
  {
    name: "an existing row nobody claimed is a delete, in the given order",
    incoming: [{ uuid: B, label: "two" }],
    existing: EXISTING_THREE,
    expected: { updates: [], inserts: [], deletes: [10, 12] },
  },
  {
    name: "all unkeyed → ordinal fallback pairs incoming[i] with existing[i]",
    incoming: [
      { label: "one" },
      { label: "TWO" },
      { uuid: null, label: "three" },
    ],
    existing: EXISTING_THREE,
    expected: {
      updates: [{ index: 1, existingId: 11, label: "TWO" }],
      inserts: [],
      deletes: [],
    },
  },
  {
    name: "ordinal fallback: surplus incoming rows are inserts at their own index",
    incoming: [{ label: "one" }, { label: "two" }, { label: "four" }],
    existing: [stored(10, A, "one"), stored(11, B, "two")],
    expected: {
      updates: [],
      inserts: [{ index: 2, label: "four" }],
      deletes: [],
    },
  },
  {
    name: "ordinal fallback: surplus existing rows are deletes",
    incoming: [{ label: "one" }],
    existing: EXISTING_THREE,
    expected: { updates: [], inserts: [], deletes: [11, 12] },
  },
  {
    name: "mixed payload: no fallback — an unkeyed row is a genuinely new row",
    incoming: [
      { uuid: A, label: "one" },
      { label: "brand new" },
      { uuid: C, label: "three" },
    ],
    existing: EXISTING_THREE,
    expected: {
      updates: [],
      inserts: [{ index: 1, label: "brand new" }],
      deletes: [11],
    },
  },
  {
    name: "mixed payload does not shift: the unkeyed row never claims existing[1]",
    incoming: [
      { uuid: A, label: "one" },
      { label: "two" },
      { uuid: B, label: "two" },
    ],
    existing: [stored(10, A, "one"), stored(11, B, "two")],
    expected: {
      updates: [],
      inserts: [{ index: 1, label: "two" }],
      deletes: [],
    },
  },
  {
    name: "ordinalFallback: false turns an all-unkeyed payload into a rewrite",
    incoming: [{ label: "one" }, { label: "two" }],
    existing: [stored(10, A, "one"), stored(11, B, "two")],
    ordinalFallback: false,
    expected: {
      updates: [],
      inserts: [
        { index: 0, label: "one" },
        { index: 1, label: "two" },
      ],
      deletes: [10, 11],
    },
  },
  {
    name: "duplicate incoming key: the first wins the match, the rest are new rows",
    incoming: [
      { uuid: B, label: "two" },
      { uuid: B, label: "two again" },
    ],
    existing: [stored(11, B, "two")],
    expected: {
      updates: [],
      inserts: [{ index: 1, label: "two again" }],
      deletes: [],
    },
  },
  {
    name: "duplicate existing key: the first is matched, the rest are deleted",
    incoming: [{ uuid: B, label: "two" }],
    existing: [stored(11, B, "two"), stored(99, B, "two")],
    expected: { updates: [], inserts: [], deletes: [99] },
  },
  {
    name: "empty incoming: every existing row is deleted",
    incoming: [],
    existing: EXISTING_THREE,
    expected: { updates: [], inserts: [], deletes: [10, 11, 12] },
  },
  {
    name: "empty existing, keyed payload: every row is an insert at its index",
    incoming: [{ uuid: FOREIGN, label: "one" }, { label: "two" }],
    existing: [],
    expected: {
      updates: [],
      inserts: [
        { index: 0, label: "one" },
        { index: 1, label: "two" },
      ],
      deletes: [],
    },
  },
  {
    name: "empty existing, unkeyed payload: fallback has nothing to pair with",
    incoming: [{ label: "one" }, { label: "two" }],
    existing: [],
    expected: {
      updates: [],
      inserts: [
        { index: 0, label: "one" },
        { index: 1, label: "two" },
      ],
      deletes: [],
    },
  },
  {
    name: "both sides empty",
    incoming: [],
    existing: [],
    expected: { updates: [], inserts: [], deletes: [] },
  },
];

describe("diffKeyedRows", () => {
  it.each(keyedCases)(
    "$name",
    ({ incoming, existing, ordinalFallback, expected }) => {
      const diff = diffKeyedRows(incoming, existing, {
        ...keyedOptions,
        ...(ordinalFallback === undefined ? {} : { ordinalFallback }),
      });

      expect(summarise(diff)).toEqual(expected);
    },
  );

  it("returns the caller's patch verbatim as `changes`", () => {
    const diff = diffKeyedRows(
      [{ uuid: A, label: "renamed" }],
      [stored(10, A, "one")],
      {
        ...keyedOptions,
        changedColumns: (incoming, existing) => ({
          label: incoming.label,
          previous: existing.label,
        }),
      },
    );

    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual({
      label: "renamed",
      previous: "one",
    });
  });

  it("hands the matched pair back so the caller can address the row by id", () => {
    const existing = [stored(10, A, "one"), stored(11, B, "two")];

    const diff = diffKeyedRows(
      [
        { uuid: A, label: "one" },
        { uuid: B, label: "TWO" },
      ],
      existing,
      keyedOptions,
    );

    expect(diff.updates).toHaveLength(1);
    // The very row object the caller read from the DB, so its `id` is usable.
    expect(diff.updates[0].existing).toBe(existing[1]);
    expect(diff.updates[0].incoming.label).toBe("TWO");
  });

  it("mutates neither argument", () => {
    const incoming: IncomingRow[] = [
      { uuid: A, label: "ONE" },
      { label: "new" },
    ];
    const existing = [stored(10, A, "one"), stored(11, B, "two")];
    const before = JSON.stringify({ incoming, existing });

    diffKeyedRows(deepFreeze(incoming), deepFreeze(existing), keyedOptions);

    expect(JSON.stringify({ incoming, existing })).toBe(before);
  });
});

type IncomingGrant = { permission: string };
type ExistingGrant = { roleId: number; permission: string };

const grant = (permission: string): ExistingGrant => ({
  roleId: 7,
  permission,
});

const setOptions = {
  keyOfIncoming: (row: IncomingGrant) => row.permission,
  keyOfExisting: (row: ExistingGrant) => row.permission,
};

const summariseSet = (diff: SetDiff<IncomingGrant, ExistingGrant>) => ({
  inserts: diff.inserts.map((r) => r.permission),
  deletes: diff.deletes.map((r) => r.permission),
  unchanged: diff.unchanged.map((r) => r.permission),
});

const setCases: Array<{
  name: string;
  incoming: IncomingGrant[];
  existing: ExistingGrant[];
  expected: ReturnType<typeof summariseSet>;
}> = [
  {
    name: "identical set → nothing to write, everything unchanged",
    incoming: [{ permission: "routes.edit" }, { permission: "routes.delete" }],
    existing: [grant("routes.edit"), grant("routes.delete")],
    expected: {
      inserts: [],
      deletes: [],
      unchanged: ["routes.edit", "routes.delete"],
    },
  },
  {
    name: "identical set in a different order is still identical",
    incoming: [{ permission: "routes.delete" }, { permission: "routes.edit" }],
    existing: [grant("routes.edit"), grant("routes.delete")],
    expected: {
      inserts: [],
      deletes: [],
      unchanged: ["routes.edit", "routes.delete"],
    },
  },
  {
    name: "one added",
    incoming: [{ permission: "routes.edit" }, { permission: "routes.view" }],
    existing: [grant("routes.edit")],
    expected: {
      inserts: ["routes.view"],
      deletes: [],
      unchanged: ["routes.edit"],
    },
  },
  {
    name: "one removed",
    incoming: [{ permission: "routes.edit" }],
    existing: [grant("routes.edit"), grant("routes.delete")],
    expected: {
      inserts: [],
      deletes: ["routes.delete"],
      unchanged: ["routes.edit"],
    },
  },
  {
    name: "one added and one removed",
    incoming: [{ permission: "routes.edit" }, { permission: "routes.view" }],
    existing: [grant("routes.edit"), grant("routes.delete")],
    expected: {
      inserts: ["routes.view"],
      deletes: ["routes.delete"],
      unchanged: ["routes.edit"],
    },
  },
  {
    name: "empty incoming: the whole set is deleted",
    incoming: [],
    existing: [grant("routes.edit"), grant("routes.delete")],
    expected: {
      inserts: [],
      deletes: ["routes.edit", "routes.delete"],
      unchanged: [],
    },
  },
  {
    name: "empty existing: the whole set is inserted",
    incoming: [{ permission: "routes.edit" }, { permission: "routes.view" }],
    existing: [],
    expected: {
      inserts: ["routes.edit", "routes.view"],
      deletes: [],
      unchanged: [],
    },
  },
  {
    name: "both sides empty",
    incoming: [],
    existing: [],
    expected: { inserts: [], deletes: [], unchanged: [] },
  },
  {
    name: "duplicate incoming key collapses to one insert",
    incoming: [{ permission: "routes.view" }, { permission: "routes.view" }],
    existing: [],
    expected: { inserts: ["routes.view"], deletes: [], unchanged: [] },
  },
  {
    name: "duplicate existing key: both rows share the matched row's fate",
    incoming: [{ permission: "routes.edit" }],
    existing: [grant("routes.edit"), grant("routes.edit")],
    expected: {
      inserts: [],
      deletes: [],
      unchanged: ["routes.edit", "routes.edit"],
    },
  },
];

describe("diffSets", () => {
  it.each(setCases)("$name", ({ incoming, existing, expected }) => {
    expect(summariseSet(diffSets(incoming, existing, setOptions))).toEqual(
      expected,
    );
  });

  it("keeps the last duplicate's row object, so one key yields one INSERT", () => {
    type Payload = { permission: string; note: string };
    const diff = diffSets<Payload, ExistingGrant>(
      [
        { permission: "routes.view", note: "first" },
        { permission: "routes.view", note: "last" },
      ],
      [],
      {
        keyOfIncoming: (row) => row.permission,
        keyOfExisting: (row) => row.permission,
      },
    );

    expect(diff.inserts).toEqual([{ permission: "routes.view", note: "last" }]);
  });

  it("mutates neither argument", () => {
    const incoming: IncomingGrant[] = [{ permission: "routes.view" }];
    const existing = [grant("routes.edit")];
    const before = JSON.stringify({ incoming, existing });

    diffSets(deepFreeze(incoming), deepFreeze(existing), setOptions);

    expect(JSON.stringify({ incoming, existing })).toBe(before);
  });
});

/** Frozen inputs turn any accidental write into a thrown TypeError. */
function deepFreeze<T>(rows: T[]): readonly T[] {
  rows.forEach((row) => Object.freeze(row));
  return Object.freeze(rows);
}
