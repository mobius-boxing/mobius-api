/**
 * I-5 / AC-10 — a core migration newer than the product split is expand-only
 * unless it names the expand migration it contracts. Both APIs share one core
 * database and either may migrate it first, so the previous image of the other
 * product briefly runs against a schema one migration ahead.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import { migrationsDirectory } from "../../database/migration-sets";
import {
  contractViolations,
  type MigrationSource,
} from "./helpers/contract-ddl";

const FIRST_CHECKED = "20261124120000";

const violationsOf = (files: readonly MigrationSource[]): string[] =>
  contractViolations(files, { set: "core", after: FIRST_CHECKED });

const readCoreSet = (): MigrationSource[] =>
  fs
    .readdirSync(migrationsDirectory("core"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => ({
      name,
      source: fs.readFileSync(`${migrationsDirectory("core")}/${name}`, "utf8"),
    }));

describe("core migrations after the product split are expand-only (AC-10, I-5)", () => {
  it("has no unmarked contract DDL in the real core set", () => {
    expect(violationsOf(readCoreSet())).toEqual([]);
  });

  const expand: MigrationSource = {
    name: "20261124120000_add_companies_product.ts",
    source: `await knex.schema.alterTable("companies", (t) => t.text("product"));`,
  };
  const drop = (marker: string): MigrationSource => ({
    name: "20261201000000_drop_legacy.ts",
    source: `${marker}\nawait knex.raw('ALTER TABLE companies DROP COLUMN legacy');`,
  });

  it("flags a newer migration that drops a column with no marker", () => {
    expect(violationsOf([expand, drop("")])).toHaveLength(1);
  });

  it("accepts the same DDL when it names an earlier expand migration", () => {
    expect(
      violationsOf([
        expand,
        drop("// contract: 20261124120000_add_companies_product"),
      ]),
    ).toEqual([]);
  });

  it("rejects a marker that names a later or unknown migration", () => {
    expect(
      violationsOf([expand, drop("// contract: 20270101000000_nothing")]),
    ).toHaveLength(1);
  });

  it("does not apply to migrations at or before the split", () => {
    const old: MigrationSource = {
      name: "20250101000000_old.ts",
      source: `await knex.raw('ALTER TABLE companies DROP COLUMN legacy');`,
    };
    expect(violationsOf([old, expand])).toEqual([]);
  });
});
