import { describe, it, expect } from "@jest/globals";
import {
  computeTenantNaming,
  TENANT_SLUG_MAX_LENGTH,
} from "../../../services/tenant-provisioning.service";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

describe("computeTenantNaming — D-25 naming, brief AC-52", () => {
  it.each([
    [3, "rol-pel-srl", "tenant_3_rol_pel_srl"],
    [6, "corrugadora-rio-negro-srl", "tenant_6_corrugadora_rio_negro_srl"],
    [15, "qa-demo-co", "tenant_15_qa_demo_co"],
  ])("company %i, slug %j -> %j", (companyId, slug, expectedDatabaseName) => {
    const naming = computeTenantNaming(companyId, slug);
    expect(naming.databaseName).toBe(expectedDatabaseName);
    expect(naming.dbUser).toBe(`${expectedDatabaseName}_user`);
  });

  it("cuts a 60-char slug to 40, and both names stay under 63 chars and match the CHECK regex", () => {
    const slug = "a".repeat(60);
    const naming = computeTenantNaming(999, slug);
    const convertedSlug = naming.databaseName.replace(`tenant_999_`, "");
    expect(convertedSlug.length).toBe(TENANT_SLUG_MAX_LENGTH);
    expect(naming.databaseName.length).toBeLessThanOrEqual(63);
    expect(naming.dbUser.length).toBeLessThanOrEqual(63);
    expect(naming.databaseName).toMatch(IDENTIFIER);
    expect(naming.dbUser).toMatch(IDENTIFIER);
  });

  it("strips a trailing underscore exposed by the 40-char cut", () => {
    // 40 "a"s then a hyphen: the cut lands exactly on the hyphen-turned-underscore.
    const slug = `${"a".repeat(39)}-rest-of-the-name`;
    const naming = computeTenantNaming(1, slug);
    expect(naming.databaseName.endsWith("_")).toBe(false);
    expect(naming.databaseName).toMatch(IDENTIFIER);
  });

  it("is deterministic", () => {
    expect(computeTenantNaming(3, "rol-pel-srl")).toStrictEqual(
      computeTenantNaming(3, "rol-pel-srl"),
    );
  });
});
