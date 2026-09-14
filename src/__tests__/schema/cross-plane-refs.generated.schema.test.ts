/**
 * db-per-company T12a, scope B — the committed `cross-plane-refs.generated.ts`
 * against the live local schema, and the generator's `--check` mode.
 *
 * `crossPlaneRefs`/`foreign-keys.schema.test.ts` still read the catalogue
 * live; this suite proves the SEPARATE generated file `purgeUser` and
 * `db-check-integrity` actually read at run time is not stale, and that the
 * generator's own source-history refusal (shared with
 * `generate-tenant-baseline.ts`'s `coreHistoryMismatch`, W2) is wired in.
 *
 * `SQL_DATABASE` must be migrated to exactly `migrations/core/` (same
 * refusal as the tenant baseline generator): point it at a database built by
 * `npm run db:bootstrap` on this branch, not a shared local one with a
 * peer's extra migrations:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *     SQL_DATABASE=zz_core_<you>
 *   npm run db:bootstrap
 *   npx jest src/__tests__/schema/cross-plane-refs.generated.schema.test.ts
 *   # then drop zz_core_<you>
 */
import { describe, it, expect } from "@jest/globals";
import {
  generateCrossPlaneRefsDeps,
  generatedFilePath,
  runGenerateCrossPlaneRefs,
} from "../../scripts/generate-cross-plane-refs";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

describeIfLocalDb(
  "cross-plane-refs.generated.ts against the live local schema (T12a)",
  () => {
    it("is current: --check against the local database finds no difference", async () => {
      const errors: string[] = [];
      const code = await runGenerateCrossPlaneRefs(["--check"], {
        ...generateCrossPlaneRefsDeps(process.env),
        out: () => undefined,
        err: (line) => errors.push(line),
      });
      expect({ code, errors }).toEqual({ code: 0, errors: [] });
    }, 30000);

    it("refuses when the source database's history is not migrations/core (W2)", async () => {
      const errors: string[] = [];
      const code = await runGenerateCrossPlaneRefs(["--check"], {
        ...generateCrossPlaneRefsDeps(process.env),
        coreMigrationFiles: () => ["not_a_real_migration.ts"],
        out: () => undefined,
        err: (line) => errors.push(line),
      });
      expect(code).toBe(1);
      expect(errors).toEqual([
        expect.stringContaining("not in migrations/core"),
      ]);
    }, 30000);

    it("names the file it writes under src/database/", () => {
      expect(generatedFilePath()).toMatch(
        /src[\\/]database[\\/]cross-plane-refs\.generated\.ts$/,
      );
    });
  },
);
