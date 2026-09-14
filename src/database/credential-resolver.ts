import {
  decryptSecret,
  encryptSecret,
} from "../services/node-files/credential-crypto";

/**
 * Turns a `tenant_databases`/`db_servers` credential reference into the
 * plaintext a connection needs (db-per-company model D-8, brief D-33/D-34).
 *
 * Three schemes, one CHECK (`^(env|enc|secretsmanager):`):
 * - `env:VAR` — the password already lives in this process's environment
 *   (the shared-target rows of C1, D-31: `env:SQL_PASSWORD`).
 * - `enc:v1` — sealed by this API with `TENANT_CREDENTIAL_KEY`, reusing
 *   `credential-crypto.ts` rather than a second AES implementation (the
 *   duplication rule; `rg createCipheriv src` must match only that file).
 *   The three-column layout that file returns is packed into the one
 *   `credentialCiphertext` bytea the model gives this table:
 *   `iv(12) ‖ tag(16) ‖ ciphertext`.
 * - `secretsmanager:` — recognised, not implemented (brief D-34): there is no
 *   RDS tenant in scope, the instance role's IAM is unverified, and the AWS
 *   SDK's type surface risks the Docker build heap ceiling. Throws so a
 *   caller maps it to 503 `TENANT_DB_UNAVAILABLE` (T7), never silently
 *   returns an empty credential.
 */

const TENANT_KEY_ENV = "TENANT_CREDENTIAL_KEY";
const ENC_REF = "enc:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type CredentialScheme = "env" | "enc" | "secretsmanager";

/** A scheme the CHECK constraint allows but this deployment cannot serve. */
export class CredentialSchemeUnavailableError extends Error {
  constructor(readonly scheme: string) {
    super(
      `Credential scheme "${scheme}" is recognised but not available on this deployment.`,
    );
    this.name = "CredentialSchemeUnavailableError";
  }
}

/** A `credentialRef` that does not even match the CHECK's own shape. */
export class UnknownCredentialSchemeError extends Error {
  constructor(readonly ref: string) {
    super(`Unrecognised credential reference "${ref}".`);
    this.name = "UnknownCredentialSchemeError";
  }
}

function schemeOf(ref: string): CredentialScheme {
  const separator = ref.indexOf(":");
  const scheme = separator === -1 ? ref : ref.slice(0, separator);
  if (scheme === "env" || scheme === "enc" || scheme === "secretsmanager") {
    return scheme;
  }
  throw new UnknownCredentialSchemeError(ref);
}

async function resolveEnv(ref: string): Promise<string> {
  const varName = ref.slice("env:".length);
  const value = process.env[varName];
  if (value === undefined || value === "") {
    throw new Error(
      `Environment variable "${varName}" is not set (credentialRef "${ref}").`,
    );
  }
  return value;
}

async function resolveEnc(
  ref: string,
  ciphertext: Buffer | null,
): Promise<string> {
  // Only one packing version exists; a future one would need its own branch
  // here, not a silent reinterpretation of someone else's layout.
  if (ref !== ENC_REF) {
    throw new CredentialSchemeUnavailableError(ref);
  }
  if (ciphertext === null) {
    throw new Error(`credentialRef "${ref}" has no ciphertext to decrypt.`);
  }
  const iv = ciphertext.subarray(0, IV_BYTES);
  const tag = ciphertext.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = ciphertext.subarray(IV_BYTES + TAG_BYTES);
  return decryptSecret(
    {
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: body.toString("base64"),
    },
    TENANT_KEY_ENV,
  );
}

export async function resolveCredential(
  ref: string,
  ciphertext: Buffer | null,
): Promise<string> {
  const scheme = schemeOf(ref);
  switch (scheme) {
    case "env":
      return resolveEnv(ref);
    case "enc":
      return resolveEnc(ref, ciphertext);
    case "secretsmanager":
      throw new CredentialSchemeUnavailableError(scheme);
  }
}

/** Seals a freshly generated tenant password (D-9) for storage. */
export function sealCredential(plaintext: string): {
  ref: "enc:v1";
  ciphertext: Buffer;
} {
  const sealed = encryptSecret(plaintext, TENANT_KEY_ENV);
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  const body = Buffer.from(sealed.ciphertext, "base64");
  return { ref: ENC_REF, ciphertext: Buffer.concat([iv, tag, body]) };
}
