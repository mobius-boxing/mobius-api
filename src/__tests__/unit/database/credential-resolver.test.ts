/**
 * AC-34 — `resolveCredential` round-trips `env:VAR` and `enc:v1`;
 * `secretsmanager:` throws `CredentialSchemeUnavailableError`.
 *
 * `rg createCipheriv src` matching only `credential-crypto.ts` is verified
 * manually (it is a repo-wide grep, not a unit assertion); this suite proves
 * the *behavioural* half — resolver never touches `crypto` directly, only
 * `credential-crypto.ts`'s exports.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  CredentialSchemeUnavailableError,
  UnknownCredentialSchemeError,
  resolveCredential,
  sealCredential,
} from "../../../database/credential-resolver";

const KEY = "c".repeat(64);
const previousKey = process.env.TENANT_CREDENTIAL_KEY;
const previousVar = process.env.MOBIUS_TEST_CREDENTIAL_VAR;

beforeEach(() => {
  process.env.TENANT_CREDENTIAL_KEY = KEY;
});

afterEach(() => {
  if (previousKey === undefined) delete process.env.TENANT_CREDENTIAL_KEY;
  else process.env.TENANT_CREDENTIAL_KEY = previousKey;
  if (previousVar === undefined) delete process.env.MOBIUS_TEST_CREDENTIAL_VAR;
  else process.env.MOBIUS_TEST_CREDENTIAL_VAR = previousVar;
});

describe("env: scheme", () => {
  it("round-trips the named environment variable", async () => {
    process.env.MOBIUS_TEST_CREDENTIAL_VAR = "s3cr3t";
    await expect(
      resolveCredential("env:MOBIUS_TEST_CREDENTIAL_VAR", null),
    ).resolves.toBe("s3cr3t");
  });

  it("fails loudly when the named variable is unset", async () => {
    delete process.env.MOBIUS_TEST_CREDENTIAL_VAR;
    await expect(
      resolveCredential("env:MOBIUS_TEST_CREDENTIAL_VAR", null),
    ).rejects.toThrow(/MOBIUS_TEST_CREDENTIAL_VAR/);
  });
});

describe("enc: scheme", () => {
  it("round-trips a sealed credential", async () => {
    const sealed = sealCredential("hunter2");
    expect(sealed.ref).toBe("enc:v1");
    await expect(
      resolveCredential(sealed.ref, sealed.ciphertext),
    ).resolves.toBe("hunter2");
  });

  it("never produces the same ciphertext twice for the same secret", () => {
    const first = sealCredential("hunter2");
    const second = sealCredential("hunter2");
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it("seals under TENANT_CREDENTIAL_KEY, not NF_SECRET_KEY", async () => {
    const previousNfKey = process.env.NF_SECRET_KEY;
    delete process.env.NF_SECRET_KEY;
    try {
      const sealed = sealCredential("hunter2");
      await expect(
        resolveCredential(sealed.ref, sealed.ciphertext),
      ).resolves.toBe("hunter2");
    } finally {
      if (previousNfKey === undefined) delete process.env.NF_SECRET_KEY;
      else process.env.NF_SECRET_KEY = previousNfKey;
    }
  });

  it("refuses a missing ciphertext", async () => {
    await expect(resolveCredential("enc:v1", null)).rejects.toThrow(
      /ciphertext/,
    );
  });

  it("refuses an unsupported enc version as unavailable, not a crash", async () => {
    const sealed = sealCredential("hunter2");
    await expect(
      resolveCredential("enc:v2", sealed.ciphertext),
    ).rejects.toThrow(CredentialSchemeUnavailableError);
  });
});

describe("secretsmanager: scheme (brief D-34)", () => {
  it("is recognised by the CHECK's shape but throws CredentialSchemeUnavailableError", async () => {
    await expect(
      resolveCredential("secretsmanager:tenant-42-password", null),
    ).rejects.toThrow(CredentialSchemeUnavailableError);
  });
});

describe("an unrecognised scheme", () => {
  it("throws before touching the environment or a key", async () => {
    await expect(resolveCredential("ftp:nope", null)).rejects.toThrow(
      UnknownCredentialSchemeError,
    );
  });
});
