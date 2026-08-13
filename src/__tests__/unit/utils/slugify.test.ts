/**
 * `toDnsSlug` / `isValidDnsSlug` are the single definition of "what may appear
 * as a whitelabel hostname label". The migration backfill, the company DTOs and
 * the public branding endpoint all lean on them, so a regression here silently
 * produces companies that no subdomain can reach.
 *
 * No database, no mocks — pure functions.
 */
import { describe, it, expect } from "@jest/globals";
import {
  MAX_DNS_LABEL_LENGTH,
  RESERVED_DNS_SLUGS,
  isReservedDnsSlug,
  isValidDnsSlug,
  toDnsSlug,
} from "../../../utils/slugify";

describe("toDnsSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(toDnsSlug("QA Demo")).toBe("qa-demo");
    expect(toDnsSlug("ACME")).toBe("acme");
  });

  it("folds accents instead of dropping the letter", () => {
    expect(toDnsSlug("Cañuelas Envases")).toBe("canuelas-envases");
    expect(toDnsSlug("Ártículo Único")).toBe("articulo-unico");
    expect(toDnsSlug("Höfner Straße")).toBe("hofner-stra-e");
  });

  it("collapses runs of symbols into a single hyphen", () => {
    expect(toDnsSlug("Foo & Bar, S.A.")).toBe("foo-bar-s-a");
    expect(toDnsSlug("a___b   c")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toDnsSlug("  ¡Hola!  ")).toBe("hola");
    expect(toDnsSlug("---acme---")).toBe("acme");
  });

  it("caps at the 63-character DNS label limit without a trailing hyphen", () => {
    const long = `${"a".repeat(62)} tail`;
    const slug = toDnsSlug(long);

    expect(slug.length).toBeLessThanOrEqual(MAX_DNS_LABEL_LENGTH);
    // Truncation lands on the hyphen at index 62; it must not survive.
    expect(slug).toBe("a".repeat(62));
    expect(slug.endsWith("-")).toBe(false);
  });

  it("is deterministic — the migration backfill and the API must agree", () => {
    expect(toDnsSlug("Empresa Ñandú S.R.L.")).toBe(
      toDnsSlug("Empresa Ñandú S.R.L."),
    );
    expect(toDnsSlug("Empresa Ñandú S.R.L.")).toBe("empresa-nandu-s-r-l");
  });

  it("returns an empty string when nothing usable survives", () => {
    expect(toDnsSlug("¿?¡!")).toBe("");
    expect(toDnsSlug("   ")).toBe("");
    expect(toDnsSlug("")).toBe("");
  });

  it("always produces a valid slug when it produces anything at all", () => {
    for (const input of [
      "QA Demo",
      "Cañuelas Envases",
      "Foo & Bar, S.A.",
      "---acme---",
      "9 de Julio",
      `${"z".repeat(80)}`,
    ]) {
      const slug = toDnsSlug(input);
      expect(slug.length).toBeGreaterThan(0);
      expect(isValidDnsSlug(slug)).toBe(true);
    }
  });
});

describe("isValidDnsSlug", () => {
  it("accepts lowercase alphanumerics and inner hyphens", () => {
    expect(isValidDnsSlug("acme")).toBe(true);
    expect(isValidDnsSlug("qa-demo")).toBe(true);
    expect(isValidDnsSlug("a1")).toBe(true);
    expect(isValidDnsSlug("a")).toBe(true);
  });

  it("rejects leading or trailing hyphens", () => {
    expect(isValidDnsSlug("-acme")).toBe(false);
    expect(isValidDnsSlug("acme-")).toBe(false);
    expect(isValidDnsSlug("-")).toBe(false);
  });

  it("rejects anything that is not a bare DNS label", () => {
    expect(isValidDnsSlug("ACME")).toBe(false);
    expect(isValidDnsSlug("acme.com")).toBe(false);
    expect(isValidDnsSlug("acme_demo")).toBe(false);
    expect(isValidDnsSlug("acme demo")).toBe(false);
    expect(isValidDnsSlug("acmé")).toBe(false);
    expect(isValidDnsSlug("acme/../etc")).toBe(false);
    expect(isValidDnsSlug("")).toBe(false);
  });

  it("rejects all-numeric labels (ambiguous with an IPv4 literal)", () => {
    expect(isValidDnsSlug("123")).toBe(false);
    expect(isValidDnsSlug("123a")).toBe(true);
  });

  it("rejects anything longer than 63 characters", () => {
    expect(isValidDnsSlug("a".repeat(MAX_DNS_LABEL_LENGTH))).toBe(true);
    expect(isValidDnsSlug("a".repeat(MAX_DNS_LABEL_LENGTH + 1))).toBe(false);
  });
});

describe("isReservedDnsSlug", () => {
  it("flags every label we keep for ourselves", () => {
    for (const reserved of RESERVED_DNS_SLUGS) {
      expect(isReservedDnsSlug(reserved)).toBe(true);
    }
    // The module's own slug is reserved: `countdown.vencimientos...` must never
    // be a customer.
    expect(isReservedDnsSlug("countdown")).toBe(true);
    expect(isReservedDnsSlug("API")).toBe(true);
  });

  it("leaves ordinary slugs alone", () => {
    expect(isReservedDnsSlug("acme")).toBe(false);
    expect(isReservedDnsSlug("api-cliente")).toBe(false);
    expect(isReservedDnsSlug("")).toBe(false);
  });

  it("keeps every reserved label a syntactically valid slug", () => {
    // Otherwise the reserved check would be unreachable behind validation.
    for (const reserved of RESERVED_DNS_SLUGS) {
      expect(isValidDnsSlug(reserved)).toBe(true);
    }
  });
});
