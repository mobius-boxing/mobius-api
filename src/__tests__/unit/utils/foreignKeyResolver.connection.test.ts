/**
 * Which database `foreignKeyResolver` asks, and what it does when it cannot
 * tell.
 *
 * The table name arrives as a runtime string, so this is the one place in the
 * codebase where the target database is chosen by lookup rather than written
 * down. Two behaviours are load-bearing:
 *
 * - `files` is fanned out (G-2), so `ownerOf` returns `undefined` for it and the
 *   registry's guard cannot arbitrate. `FANNED_OUT_RESOLUTION` is the only thing
 *   standing between `POST`/`PUT /palletizations` carrying `technicalFileUuid`
 *   or `imageFileUuid` and a 500, because `connectionFor` now throws where the
 *   old `?? "erp"` silently succeeded.
 * - An unknown table throws rather than defaulting. `getIdByUuid` returns `null`
 *   on a miss and every caller reads `null` as "no value" (the L-005 shape), so
 *   a lookup sent to the wrong database would not error — the field would just
 *   go missing.
 *
 * Scope note: this file covers the *connection choice* only. T2b's
 * `foreignKeyResolver.test.ts` covers the CoreClient split and mixed payloads.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

interface TableCall {
  key: string;
  table: string;
}

const mockCalls: TableCall[] = [];
const mockRows: Record<string, { id: number } | null> = {};

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key: string) => (table: string) => {
    mockCalls.push({ key, table });
    const builder = {
      where: () => builder,
      select: () => builder,
      first: () => Promise.resolve(mockRows[key] ?? null),
    };
    return builder;
  },
}));

import {
  getIdByUuid,
  resolveUuidToId,
  validateUuidExists,
} from "../../../utils/foreignKeyResolver";

const A_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("foreignKeyResolver — connection choice", () => {
  beforeEach(() => {
    mockCalls.length = 0;
    for (const key of Object.keys(mockRows)) delete mockRows[key];
  });

  describe("a table the manifest owns outright", () => {
    it("asks the owning database", async () => {
      mockRows.erp = { id: 11 };
      mockRows.core = { id: 99 };

      await expect(getIdByUuid(A_UUID, "customers")).resolves.toBe(11);
      await expect(getIdByUuid(A_UUID, "companies")).resolves.toBe(99);

      expect(mockCalls).toEqual([
        { key: "erp", table: "customers" },
        { key: "core", table: "companies" },
      ]);
    });
  });

  describe("a fanned-out table", () => {
    it("resolves `files` on erp — palletization's technical/image assets", async () => {
      mockRows.erp = { id: 42 };

      const id = await getIdByUuid(A_UUID, "files");

      expect(id).toBe(42);
      expect(mockCalls).toEqual([{ key: "erp", table: "files" }]);
    });

    it("uses the same resolution from validateUuidExists", async () => {
      mockRows.erp = { id: 42 };

      await expect(validateUuidExists(A_UUID, "files")).resolves.toBe(true);
      expect(mockCalls).toEqual([{ key: "erp", table: "files" }]);
    });
  });

  describe("a table no database claims", () => {
    it("throws, naming the table, instead of quietly picking erp", async () => {
      await expect(getIdByUuid(A_UUID, "not_a_real_table")).rejects.toThrow(
        /no database owns table "not_a_real_table"/,
      );
      // The point of throwing: no query was issued anywhere.
      expect(mockCalls).toEqual([]);
    });

    it("throws from resolveUuidToId too", async () => {
      await expect(
        resolveUuidToId(A_UUID, { tableName: "not_a_real_table" }),
      ).rejects.toThrow(/no database owns table/);
    });

    it("names both places the table can be declared", async () => {
      // A message that only says "unknown table" sends the reader hunting.
      await expect(getIdByUuid(A_UUID, "nope")).rejects.toThrow(
        /ownership\.ts/,
      );
      await expect(getIdByUuid(A_UUID, "nope")).rejects.toThrow(
        /FANNED_OUT_RESOLUTION/,
      );
    });
  });

  describe("accepted-input behaviour is untouched by the throw", () => {
    // These branches return before any connection is chosen, so even an
    // unresolvable table name must not turn them into errors.
    it("passes a numeric string through without asking a database", async () => {
      await expect(getIdByUuid("7", "not_a_real_table")).resolves.toBe(7);
      expect(mockCalls).toEqual([]);
    });

    it("returns null for an empty or missing value", async () => {
      await expect(getIdByUuid("", "not_a_real_table")).resolves.toBeNull();
      await expect(getIdByUuid(null, "not_a_real_table")).resolves.toBeNull();
      await expect(
        getIdByUuid(undefined, "not_a_real_table"),
      ).resolves.toBeNull();
      expect(mockCalls).toEqual([]);
    });

    it("keeps resolveUuidToId's numeric pass-through and empty→null", async () => {
      await expect(
        resolveUuidToId(7, { tableName: "not_a_real_table" }),
      ).resolves.toEqual({ success: true, id: 7 });
      await expect(
        resolveUuidToId("7", { tableName: "not_a_real_table" }),
      ).resolves.toEqual({ success: true, id: 7 });
      await expect(
        resolveUuidToId("", { tableName: "not_a_real_table" }),
      ).resolves.toBeNull();
      await expect(
        resolveUuidToId(null, { tableName: "not_a_real_table" }),
      ).resolves.toBeNull();
      expect(mockCalls).toEqual([]);
    });

    it("still reports a miss as null, not as an error", async () => {
      mockRows.erp = null;

      await expect(getIdByUuid(A_UUID, "files")).resolves.toBeNull();
      expect(mockCalls).toEqual([{ key: "erp", table: "files" }]);
    });
  });
});
