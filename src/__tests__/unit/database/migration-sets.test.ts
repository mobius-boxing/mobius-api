import path from "path";
import { describe, it, expect } from "@jest/globals";
import {
  isRunningCompiled,
  migrationConfigFor,
  migrationsDirectory,
  seedsDirectory,
} from "../../../database/migration-sets";

/**
 * F3 (T12b): `migrations/tenant/*.ts` never reached `dist/`, so a compiled
 * `node dist/server.js` process (no ts-node) couldn't load them at runtime
 * provisioning time. These pin the mode-aware resolution the fix adds — the
 * real end-to-end proof (build, then load/provision against `dist/`) is a
 * one-off script, not a jest test (see decisions.md).
 */
describe("migration-sets — F3 compiled-mode resolution", () => {
  it("isRunningCompiled is true only for a .js caller", () => {
    expect(isRunningCompiled("/app/src/database/migration-sets.ts")).toBe(
      false,
    );
    expect(isRunningCompiled("/app/dist/database/migration-sets.js")).toBe(
      true,
    );
  });

  it("ts-node mode (default) resolves the source migrations/seeds directories with a .ts extension", () => {
    expect(migrationsDirectory("tenant", false)).toBe(
      path.join(process.cwd(), "migrations", "tenant"),
    );
    expect(seedsDirectory("tenant", false)).toBe(
      path.join(process.cwd(), "seeds", "tenant"),
    );
    const config = migrationConfigFor("tenant", {}, false);
    expect(config.migrations).toMatchObject({
      directory: path.join(process.cwd(), "migrations", "tenant"),
      extension: "ts",
    });
    expect(config.seeds).toStrictEqual({
      directory: path.join(process.cwd(), "seeds", "tenant"),
    });
  });

  it("compiled mode resolves the dist migrations/seeds directories with a .js extension", () => {
    expect(migrationsDirectory("tenant", true)).toBe(
      path.join(process.cwd(), "dist", "migrations", "tenant"),
    );
    expect(seedsDirectory("tenant", true)).toBe(
      path.join(process.cwd(), "dist", "seeds", "tenant"),
    );
    const config = migrationConfigFor("tenant", {}, true);
    expect(config.migrations).toMatchObject({
      directory: path.join(process.cwd(), "dist", "migrations", "tenant"),
      extension: "js",
    });
    expect(config.seeds).toStrictEqual({
      directory: path.join(process.cwd(), "dist", "seeds", "tenant"),
    });
  });

  it("the same distinction applies to the core set", () => {
    expect(migrationsDirectory("core", false)).toBe(
      path.join(process.cwd(), "migrations", "core"),
    );
    expect(migrationsDirectory("core", true)).toBe(
      path.join(process.cwd(), "dist", "migrations", "core"),
    );
  });

  it("defaults to the calling module's own real mode when compiled isn't passed explicitly (this file runs under ts-jest, i.e. uncompiled)", () => {
    expect(migrationsDirectory("tenant")).toBe(
      path.join(process.cwd(), "migrations", "tenant"),
    );
    expect(migrationConfigFor("tenant", {}).migrations?.extension).toBe("ts");
  });
});
