/**
 * Credential encryption (brief D-5).
 *
 * Two invariants matter more than the round trip itself: a missing key must
 * fail ONE operation with a readable sentence rather than crash anything (the
 * `ANTHROPIC_API_KEY` precedent), and a tampered ciphertext must fail rather
 * than decrypt to something else — which is the whole reason for GCM.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  decryptSecret,
  encryptSecret,
  hasSecretKey,
  MAX_SECRET_LENGTH,
  NodeFilesSecretError,
  secretsMatch,
} from "../../../../services/node-files/credential-crypto";

const HEX_KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const previousKey = process.env.NF_SECRET_KEY;

beforeEach(() => {
  process.env.NF_SECRET_KEY = HEX_KEY;
});

afterEach(() => {
  if (previousKey === undefined) delete process.env.NF_SECRET_KEY;
  else process.env.NF_SECRET_KEY = previousKey;
});

describe("round trip", () => {
  it("returns the same secret it was given", () => {
    const encrypted = encryptSecret("sk_live_ñ_123");
    expect(decryptSecret(encrypted)).toBe("sk_live_ñ_123");
  });

  it("never produces the same ciphertext twice for the same secret", () => {
    // A fresh IV per secret. Repeating one under GCM leaks plaintext outright.
    const first = encryptSecret("token");
    const second = encryptSecret("token");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it("accepts a base64 key as well as a hex one", () => {
    process.env.NF_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(hasSecretKey()).toBe(true);
    expect(decryptSecret(encryptSecret("hola"))).toBe("hola");
  });
});

describe("a missing or wrong key fails ONE operation, loudly", () => {
  it("says what is missing instead of throwing something opaque", () => {
    delete process.env.NF_SECRET_KEY;
    expect(hasSecretKey()).toBe(false);
    expect(() => encryptSecret("token")).toThrow(NodeFilesSecretError);
    expect(() => encryptSecret("token")).toThrow(/NF_SECRET_KEY/);
  });

  it("refuses a key of the wrong size rather than padding it", () => {
    process.env.NF_SECRET_KEY = "demasiado-corta";
    expect(() => encryptSecret("token")).toThrow(/32 bytes/);
  });

  it("fails to decrypt under a different key", () => {
    const encrypted = encryptSecret("token");
    process.env.NF_SECRET_KEY = OTHER_KEY;
    expect(() => decryptSecret(encrypted)).toThrow(/NF_SECRET_KEY/);
  });
});

describe("tampering is detected, not decrypted", () => {
  it("refuses a ciphertext that was edited in the database", () => {
    const encrypted = encryptSecret("token");
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") }),
    ).toThrow(NodeFilesSecretError);
  });

  it("refuses a tag that does not belong to the ciphertext", () => {
    const encrypted = encryptSecret("token");
    const other = encryptSecret("otro");
    expect(() => decryptSecret({ ...encrypted, tag: other.tag })).toThrow(
      NodeFilesSecretError,
    );
  });

  it("refuses truncated bookkeeping rather than guessing", () => {
    const encrypted = encryptSecret("token");
    expect(() => decryptSecret({ ...encrypted, iv: "AAAA" })).toThrow(
      /corrupta/,
    );
  });
});

describe("input limits", () => {
  it("refuses an empty secret", () => {
    expect(() => encryptSecret("")).toThrow(/vacío/);
  });

  it("refuses an oversized secret", () => {
    expect(() => encryptSecret("x".repeat(MAX_SECRET_LENGTH + 1))).toThrow(
      new RegExp(String(MAX_SECRET_LENGTH)),
    );
  });

  it("compares secrets without a length-independent shortcut", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });
});
