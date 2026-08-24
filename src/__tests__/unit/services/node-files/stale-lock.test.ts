/**
 * The stale-lock requeue predicate (AC-9).
 *
 * `FOR UPDATE SKIP LOCKED` guarantees two workers never claim the same run; it
 * guarantees nothing about a worker that dies holding one. This predicate is
 * the whole recovery story, and it has two ways to be wrong: too eager (two
 * extractions billed for one document) or too lax (a run stuck in `extracting`
 * forever). Both directions are pinned below.
 */
import { describe, it, expect } from "@jest/globals";
import {
  NF_LOCK_CAP_MS,
  isStaleLock,
  staleRunIds,
} from "../../../../services/node-files/node-files-worker";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe("isStaleLock", () => {
  it("leaves a fresh claim alone", () => {
    expect(isStaleLock(NOW, NOW)).toBe(false);
    expect(isStaleLock(ago(1_000), NOW)).toBe(false);
    expect(isStaleLock(ago(NF_LOCK_CAP_MS - 1), NOW)).toBe(false);
  });

  it("does not requeue at exactly the cap — a run that may still be alive is not stolen", () => {
    // Strictly greater: paying twice for one extraction is the expensive
    // failure, and one more tick costs 5 seconds.
    expect(isStaleLock(ago(NF_LOCK_CAP_MS), NOW)).toBe(false);
    expect(isStaleLock(ago(NF_LOCK_CAP_MS + 1), NOW)).toBe(true);
  });

  it("requeues a claim older than the cap", () => {
    expect(isStaleLock(ago(NF_LOCK_CAP_MS * 2), NOW)).toBe(true);
  });

  it("treats a missing lock timestamp as abandoned", () => {
    // The claim sets status and lockedAt in one statement, so `extracting` with
    // no lockedAt means the row was left inconsistent: nobody is coming back
    // for it, and without this it would sit there forever.
    expect(isStaleLock(null, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as abandoned, not as alive", () => {
    expect(isStaleLock("not a date", NOW)).toBe(true);
  });

  it("reads a timestamp string exactly as it reads a Date", () => {
    // pg hands back Date objects, but a string must not quietly mean 'fresh'.
    expect(isStaleLock(ago(NF_LOCK_CAP_MS * 2).toISOString(), NOW)).toBe(true);
    expect(isStaleLock(ago(1_000).toISOString(), NOW)).toBe(false);
  });

  it("honours an explicit cap, so the rule is not welded to one constant", () => {
    expect(isStaleLock(ago(2_000), NOW, 1_000)).toBe(true);
    expect(isStaleLock(ago(2_000), NOW, 10_000)).toBe(false);
  });

  it("never requeues a claim dated in the future", () => {
    // Clock skew between the API and Postgres must not look like an old lock.
    expect(isStaleLock(new Date(NOW.getTime() + 60_000), NOW)).toBe(false);
  });
});

describe("staleRunIds", () => {
  it("selects only the abandoned rows out of everything currently held", () => {
    const candidates = [
      { id: 1, lockedAt: ago(1_000) },
      { id: 2, lockedAt: ago(NF_LOCK_CAP_MS + 60_000) },
      { id: 3, lockedAt: null },
      { id: 4, lockedAt: ago(NF_LOCK_CAP_MS - 1) },
    ];
    expect(staleRunIds(candidates, NOW)).toEqual([2, 3]);
  });

  it("asks for nothing when every claim is fresh", () => {
    expect(staleRunIds([{ id: 1, lockedAt: NOW }], NOW)).toEqual([]);
    expect(staleRunIds([], NOW)).toEqual([]);
  });
});
