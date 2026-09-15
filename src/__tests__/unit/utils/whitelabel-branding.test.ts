/**
 * The fail-soft branding reader shared by the public whitelabel endpoint and by
 * the `companies.branding` backfill migration.
 *
 * The migration case matters most: these assertions pin the exact transform
 * that carries live production branding (`qa-demo-co`) from
 * `company_modules.config.countdown.branding` into `companies.branding`
 * (AC-18). If they drift, a real customer's login screen changes.
 */

import { describe, it, expect } from "@jest/globals";
import {
  isEmptyBranding,
  normalizeBranding,
  readLegacyModuleBranding,
} from "../../../utils/whitelabel-branding";

/** Verbatim shape of the live `qa-demo-co` row (2026-08-12). */
const PRODUCTION_COUNTDOWN_CONFIG = {
  countdown: {
    branding: {
      displayName: "QA Demo",
      brandColor: "#2563eb",
      loginMessage: "Portal de vencimientos de QA Demo.",
    },
  },
};

const VALID_UUID_V4 = "3f1a7c1e-4b2d-4a6e-9c1f-2b7d8e5a1c40";

describe("normalizeBranding", () => {
  it("keeps every valid field as-is", () => {
    expect(
      normalizeBranding({
        displayName: "Acme",
        brandColor: "#00ff00",
        accentColor: "#ffd400",
        shellColor: null,
        canvasColor: null,
        logoFileUuid: VALID_UUID_V4,
        loginMessage: "Bienvenido",
      }),
    ).toEqual({
      displayName: "Acme",
      brandColor: "#00ff00",
      accentColor: "#ffd400",
      shellColor: null,
      canvasColor: null,
      logoFileUuid: VALID_UUID_V4,
      loginMessage: "Bienvenido",
    });
  });

  it("nulls an empty display name and an empty login message", () => {
    expect(normalizeBranding({ displayName: "", loginMessage: "" })).toEqual({
      displayName: null,
      brandColor: null,
      accentColor: null,
      shellColor: null,
      canvasColor: null,
      logoFileUuid: null,
      loginMessage: null,
    });
  });

  it("nulls a colour that is not #rrggbb", () => {
    for (const brandColor of ["red", "#abc", "#GGGGGG", "018445", 16711680]) {
      expect(normalizeBranding({ brandColor }).brandColor).toBeNull();
    }
  });

  it("nulls an accent colour that is not #rrggbb, without throwing", () => {
    for (const accentColor of ["red", "#12345", "#GGGGGG", "018445", 42]) {
      expect(normalizeBranding({ accentColor }).accentColor).toBeNull();
    }
  });

  it("accepts an upper-cased hex colour verbatim", () => {
    expect(normalizeBranding({ brandColor: "#2563EB" }).brandColor).toBe(
      "#2563EB",
    );
  });

  it("nulls a logo reference that is not a v4 uuid", () => {
    for (const logoFileUuid of [
      "not-a-uuid",
      // v1 uuid: right shape, wrong version nibble.
      "3f1a7c1e-4b2d-1a6e-9c1f-2b7d8e5a1c40",
      "",
    ]) {
      expect(normalizeBranding({ logoFileUuid }).logoFileUuid).toBeNull();
    }
  });

  it("nulls non-string values instead of leaking them to a browser", () => {
    expect(
      normalizeBranding({
        displayName: { toString: "sneaky" },
        loginMessage: ["a"],
      }),
    ).toEqual({
      displayName: null,
      brandColor: null,
      accentColor: null,
      shellColor: null,
      canvasColor: null,
      logoFileUuid: null,
      loginMessage: null,
    });
  });

  it("never throws on junk input", () => {
    for (const raw of [null, undefined, "string", 42, [], true]) {
      expect(normalizeBranding(raw)).toEqual({
        displayName: null,
        brandColor: null,
        accentColor: null,
        shellColor: null,
        canvasColor: null,
        logoFileUuid: null,
        loginMessage: null,
      });
    }
  });
});

describe("readLegacyModuleBranding", () => {
  it("extracts the live qa-demo-co branding unchanged (AC-18)", () => {
    expect(
      readLegacyModuleBranding(PRODUCTION_COUNTDOWN_CONFIG, "countdown"),
    ).toEqual({
      displayName: "QA Demo",
      brandColor: "#2563eb",
      accentColor: null,
      shellColor: null,
      canvasColor: null,
      logoFileUuid: null,
      loginMessage: "Portal de vencimientos de QA Demo.",
    });
  });

  it("returns empty branding for a module namespace that is not there", () => {
    expect(
      isEmptyBranding(
        readLegacyModuleBranding(PRODUCTION_COUNTDOWN_CONFIG, "absent-module"),
      ),
    ).toBe(true);
  });

  it("ignores sibling config keys under the same module namespace", () => {
    const config = {
      countdown: {
        reminderDays: [30, 7, 1],
        branding: { displayName: "Vencimientos" },
      },
    };
    expect(readLegacyModuleBranding(config, "countdown")).toEqual({
      displayName: "Vencimientos",
      brandColor: null,
      accentColor: null,
      shellColor: null,
      canvasColor: null,
      logoFileUuid: null,
      loginMessage: null,
    });
  });

  it("never throws on a malformed config blob", () => {
    for (const config of [null, undefined, "oops", { countdown: "oops" }]) {
      expect(
        isEmptyBranding(readLegacyModuleBranding(config, "countdown")),
      ).toBe(true);
    }
  });
});

describe("isEmptyBranding", () => {
  it("is false as soon as one field is set", () => {
    expect(isEmptyBranding(normalizeBranding({ brandColor: "#018445" }))).toBe(
      false,
    );
  });

  it("is false for an accent-only branding (D-9)", () => {
    expect(isEmptyBranding(normalizeBranding({ accentColor: "#2563eb" }))).toBe(
      false,
    );
  });

  it("is true when every field is unset", () => {
    expect(isEmptyBranding(normalizeBranding({}))).toBe(true);
  });
});
