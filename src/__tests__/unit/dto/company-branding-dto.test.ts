/**
 * The branding validation rules — the only gate between a superAdmin's form and
 * a JSONB column whose contents are served, unauthenticated, into a browser.
 *
 * The second describe block exists to prove the legacy
 * `CompanyModuleConfigInputDTO` still behaves EXACTLY as before now that it
 * delegates here. Two copies of these rules is how they drift.
 */

import { describe, it, expect } from "@jest/globals";
import { CompanyBrandingInputDTO } from "../../../dto/input/company/CompanyBrandingInputDTO";
import { CompanyModuleConfigInputDTO } from "../../../dto/input/company/CompanyModuleConfigInputDTO";

const VALID_UUID_V4 = "3f1a7c1e-4b2d-4a6e-9c1f-2b7d8e5a1c40";
/** Right shape, version nibble 1 — a v1 uuid must NOT pass. */
const UUID_V1 = "3f1a7c1e-4b2d-1a6e-9c1f-2b7d8e5a1c40";

const build = (body: unknown) => new CompanyBrandingInputDTO(body).build();

describe("CompanyBrandingInputDTO — accepted input", () => {
  it("keeps the five valid fields", () => {
    expect(
      build({
        displayName: "Acme Cartón",
        brandColor: "#2563eb",
        accentColor: "#ffd400",
        logoFileUuid: VALID_UUID_V4,
        loginMessage: "Bienvenido al portal",
      }).toBranding(),
    ).toEqual({
      displayName: "Acme Cartón",
      brandColor: "#2563eb",
      accentColor: "#ffd400",
      logoFileUuid: VALID_UUID_V4,
      loginMessage: "Bienvenido al portal",
    });
  });

  it("turns absent, null and empty-string into null (that is how a field is cleared)", () => {
    expect(
      build({
        displayName: null,
        brandColor: "",
        accentColor: "",
        loginMessage: undefined,
      }).toBranding(),
    ).toEqual({
      displayName: null,
      brandColor: null,
      accentColor: null,
      logoFileUuid: null,
      loginMessage: null,
    });
  });

  it("accepts an empty body — branding is optional in full", () => {
    expect(build({}).toBranding()).toEqual({
      displayName: null,
      brandColor: null,
      accentColor: null,
      logoFileUuid: null,
      loginMessage: null,
    });
  });

  it("lower-cases the colour so #2563EB and #2563eb are one value", () => {
    expect(build({ brandColor: "#2563EB" }).toBranding().brandColor).toBe(
      "#2563eb",
    );
  });

  it("lower-cases the accent colour exactly as it does the brand colour", () => {
    expect(build({ accentColor: "#2563EB" }).toBranding().accentColor).toBe(
      "#2563eb",
    );
  });

  it("treats absent, null and empty-string accent as unset (D-3 fallback)", () => {
    for (const accentColor of [undefined, null, ""]) {
      expect(build({ accentColor }).toBranding().accentColor).toBeNull();
    }
  });

  it("trims surrounding whitespace", () => {
    expect(
      build({ displayName: "  Acme  ", brandColor: " #018445 " }).toBranding(),
    ).toEqual(
      expect.objectContaining({ displayName: "Acme", brandColor: "#018445" }),
    );
  });

  it("accepts the boundary lengths", () => {
    const name = "a".repeat(80);
    const message = "b".repeat(160);
    expect(
      build({ displayName: name, loginMessage: message }).toBranding(),
    ).toEqual(
      expect.objectContaining({ displayName: name, loginMessage: message }),
    );
  });
});

describe("CompanyBrandingInputDTO — rejected input (AC-6)", () => {
  it("throws on a display name over 80 characters", () => {
    expect(() => build({ displayName: "a".repeat(81) })).toThrow(
      /80 caracteres/,
    );
  });

  it("throws on a login message over 160 characters", () => {
    expect(() => build({ loginMessage: "b".repeat(161) })).toThrow(
      /160 caracteres/,
    );
  });

  it("throws on a colour that is not #rrggbb", () => {
    for (const brandColor of [
      "#GGGGGG",
      "red",
      "#abc",
      "018445",
      "#2563eb99",
    ]) {
      expect(() => build({ brandColor })).toThrow(/color de marca/);
    }
  });

  it("throws on an accent colour that is not #rrggbb", () => {
    for (const accentColor of [
      "#GGGGGG",
      "red",
      "#12345",
      "#abc",
      "018445",
      "#2563eb99",
    ]) {
      expect(() => build({ accentColor })).toThrow(/color de acento/);
    }
  });

  it("throws on a logo reference that is not a v4 uuid", () => {
    for (const logoFileUuid of ["not-a-uuid", UUID_V1, "1234"]) {
      expect(() => build({ logoFileUuid })).toThrow(/archivo válido/);
    }
  });

  it("throws on a whitespace-only display name", () => {
    expect(() => build({ displayName: "   " })).toThrow(/no puede estar vacío/);
  });

  it("throws on non-string values instead of storing them", () => {
    expect(() => build({ displayName: 42 })).toThrow();
    expect(() => build({ brandColor: { hex: "#018445" } })).toThrow();
    expect(() => build({ logoFileUuid: ["x"] })).toThrow();
    expect(() => build({ loginMessage: 7 })).toThrow();
  });

  it("never throws in the constructor — only build() rejects", () => {
    expect(
      () => new CompanyBrandingInputDTO({ brandColor: "red" }),
    ).not.toThrow();
    expect(() => new CompanyBrandingInputDTO(null)).not.toThrow();
    expect(() => new CompanyBrandingInputDTO("nonsense")).not.toThrow();
  });
});

describe("CompanyModuleConfigInputDTO — unchanged after delegating", () => {
  it("still nests the five fields under `branding`", () => {
    const dto = new CompanyModuleConfigInputDTO({
      branding: {
        displayName: "QA Demo",
        brandColor: "#2563EB",
        accentColor: "#FFD400",
        loginMessage: "Portal de vencimientos de QA Demo.",
      },
    }).build();

    expect(dto.toConfigSection()).toEqual({
      branding: {
        displayName: "QA Demo",
        brandColor: "#2563eb",
        accentColor: "#ffd400",
        logoFileUuid: null,
        loginMessage: "Portal de vencimientos de QA Demo.",
      },
    });
  });

  it("still tolerates a body with no branding key at all", () => {
    expect(
      new CompanyModuleConfigInputDTO({}).build().toConfigSection(),
    ).toEqual({
      branding: {
        displayName: null,
        brandColor: null,
        accentColor: null,
        logoFileUuid: null,
        loginMessage: null,
      },
    });
  });

  it("still throws the same messages as the branding endpoint", () => {
    expect(() =>
      new CompanyModuleConfigInputDTO({
        branding: { brandColor: "red" },
      }).build(),
    ).toThrow(/color de marca/);
    expect(() =>
      new CompanyModuleConfigInputDTO({
        branding: { displayName: "a".repeat(81) },
      }).build(),
    ).toThrow(/80 caracteres/);
  });

  it("exposes `branding` with the same normalization as before", () => {
    const dto = new CompanyModuleConfigInputDTO({
      branding: { displayName: "  Acme  " },
    }).build();
    expect(dto.branding.displayName).toBe("Acme");
  });
});
