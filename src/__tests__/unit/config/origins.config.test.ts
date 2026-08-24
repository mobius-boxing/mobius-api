/**
 * The CORS allowlist is a security boundary: `credentials: true` means a
 * reflected origin hands an attacker's page an authenticated session. Wildcard
 * entries widen that boundary on purpose (so onboarding a whitelabel customer
 * needs no redeploy), which makes the "what must NOT match" half of this file
 * the important half.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import {
  getAllowedOrigins,
  isOriginAllowed,
  validateAllowedOrigins,
} from "../../../common/config/origins/origins.config";

const WILDCARD = "https://*.vencimientos.mobiusboxing.com";
const EXACT = "https://app.mobiusboxing.com";
const ALLOWLIST = [EXACT, WILDCARD];

describe("isOriginAllowed — exact entries", () => {
  it("accepts an exact match and nothing near it", () => {
    expect(isOriginAllowed(EXACT, ALLOWLIST)).toBe(true);
    expect(isOriginAllowed("http://app.mobiusboxing.com", ALLOWLIST)).toBe(
      false,
    );
    expect(
      isOriginAllowed("https://app.mobiusboxing.com:8443", ALLOWLIST),
    ).toBe(false);
    expect(
      isOriginAllowed("https://app.mobiusboxing.com.evil.com", ALLOWLIST),
    ).toBe(false);
  });

  it("rejects an empty or non-string origin", () => {
    expect(isOriginAllowed("", ALLOWLIST)).toBe(false);
    expect(isOriginAllowed(undefined as unknown as string, ALLOWLIST)).toBe(
      false,
    );
  });
});

describe("isOriginAllowed — single-label wildcards", () => {
  it("accepts exactly one label in the wildcard position", () => {
    expect(
      isOriginAllowed("https://acme.vencimientos.mobiusboxing.com", ALLOWLIST),
    ).toBe(true);
    expect(
      isOriginAllowed("https://qa-demo.vencimientos.mobiusboxing.com", [
        WILDCARD,
      ]),
    ).toBe(true);
  });

  it("does NOT match an unrelated host", () => {
    expect(isOriginAllowed("https://evil.com", ALLOWLIST)).toBe(false);
    expect(isOriginAllowed("http://evil.com", ALLOWLIST)).toBe(false);
  });

  it("does NOT match more than one label (`*` is one label, like TLS)", () => {
    expect(
      isOriginAllowed("https://a.b.vencimientos.mobiusboxing.com", ALLOWLIST),
    ).toBe(false);
  });

  it("does NOT match a suffix-extension attack", () => {
    expect(
      isOriginAllowed(
        "https://vencimientos.mobiusboxing.com.evil.com",
        ALLOWLIST,
      ),
    ).toBe(false);
    expect(
      isOriginAllowed(
        "https://acme.vencimientos.mobiusboxing.com.evil.com",
        ALLOWLIST,
      ),
    ).toBe(false);
  });

  it("does NOT match the bare apex, an empty label, or a scheme swap", () => {
    expect(
      isOriginAllowed("https://vencimientos.mobiusboxing.com", ALLOWLIST),
    ).toBe(false);
    expect(
      isOriginAllowed("https://.vencimientos.mobiusboxing.com", ALLOWLIST),
    ).toBe(false);
    expect(
      isOriginAllowed("http://acme.vencimientos.mobiusboxing.com", ALLOWLIST),
    ).toBe(false);
  });

  it("does NOT let a port or path ride along in the wildcard label", () => {
    expect(
      isOriginAllowed(
        "https://acme:8443.vencimientos.mobiusboxing.com",
        ALLOWLIST,
      ),
    ).toBe(false);
    expect(
      isOriginAllowed(
        "https://acme/x.vencimientos.mobiusboxing.com",
        ALLOWLIST,
      ),
    ).toBe(false);
    expect(
      isOriginAllowed("https://acme.vencimientos.mobiusboxing.com/", ALLOWLIST),
    ).toBe(false);
  });

  it("treats the `.` in a pattern as a literal dot, not a regex wildcard", () => {
    expect(
      isOriginAllowed("https://acme.vencimientosXmobiusboxing.com", ALLOWLIST),
    ).toBe(false);
  });

  it("fails closed on a malformed wildcard entry", () => {
    // `*` outside the leftmost label position, or more than one `*`.
    expect(
      isOriginAllowed("https://a.b.mobiusboxing.com", ["https://a.*.b.com"]),
    ).toBe(false);
    expect(isOriginAllowed("https://a.b.c.com", ["https://*.*.com"])).toBe(
      false,
    );
    expect(isOriginAllowed("https://anything.com", ["*"])).toBe(false);
    expect(isOriginAllowed("https://anything.com", ["https://*"])).toBe(false);
  });

  it("matches nothing when the allowlist is empty", () => {
    expect(
      isOriginAllowed("https://acme.vencimientos.mobiusboxing.com", []),
    ).toBe(false);
  });
});

describe("allowlist parsing and production guard", () => {
  const originalOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalOrigins;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("reads wildcard entries out of the env allowlist", () => {
    process.env.CORS_ALLOWED_ORIGINS = `${EXACT}, ${WILDCARD}`;

    expect(getAllowedOrigins()).toEqual([EXACT, WILDCARD]);
    expect(isOriginAllowed("https://acme.vencimientos.mobiusboxing.com")).toBe(
      true,
    );
    expect(isOriginAllowed("https://evil.com")).toBe(false);
  });

  it("still fails closed in production without an allowlist", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ALLOWED_ORIGINS;

    expect(() => validateAllowedOrigins()).toThrow("CORS_ALLOWED_ORIGINS");

    process.env.CORS_ALLOWED_ORIGINS = WILDCARD;
    expect(() => validateAllowedOrigins()).not.toThrow();
  });
});
