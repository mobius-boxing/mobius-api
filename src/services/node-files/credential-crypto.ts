import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

/**
 * Credential encryption (brief D-5) — the first `createCipheriv` in this repo.
 *
 * `tokenHash.ts` next door cannot serve: it is one-way SHA-256, which is
 * exactly right for verifying a token someone hands back and exactly useless
 * for a secret that must be REPLAYED at an external API.
 *
 * AES-256-GCM, key from `NF_SECRET_KEY`, stored as three columns
 * (`secretCiphertext`, `secretIv`, `secretTag`). GCM rather than CBC because
 * the tag makes tampering detectable: a ciphertext edited in the database fails
 * to decrypt instead of silently producing a different secret.
 *
 * **Never throws at construction, ever** — the `ANTHROPIC_API_KEY` precedent in
 * `claude-extraction.provider.ts:95-99`, which exists because the API has to
 * boot on a laptop and in a prod box that is missing a key. A missing or
 * malformed `NF_SECRET_KEY` fails THAT ONE encrypt/decrypt with a sentence a
 * human can act on. It does not crash the worker, it does not fail the module
 * gate, and it does not stop the process from starting. The blast radius of a
 * missing key is "HTTP nodes with credentials fail", not "the API is down".
 */

/** A key or ciphertext problem. The message is tenant-facing Spanish. */
export class NodeFilesSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeFilesSecretError";
  }
}

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the GCM standard nonce size.

/** Longer than any sane API token and short enough to keep a row small. */
export const MAX_SECRET_LENGTH = 4096;

export interface IEncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * The key, read from the environment on every call.
 *
 * Accepts 64 hex characters or 44-character base64 — both are 32 bytes, and
 * insisting on one spelling only guarantees the wrong one gets pasted into the
 * deploy. Read per call, not cached at import, so a process that gets the
 * variable added by a restart does not also need a code change to believe it.
 */
function readKey(): Buffer {
  const raw = (process.env.NF_SECRET_KEY ?? "").trim();
  if (raw === "") {
    throw new NodeFilesSecretError(
      "No hay clave de cifrado configurada (NF_SECRET_KEY): no se pueden usar credenciales",
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new NodeFilesSecretError(
      "La clave de cifrado (NF_SECRET_KEY) debe tener 32 bytes en hex o base64",
    );
  }
  return key;
}

/** Whether a usable key is present — for a health answer, never for a decision. */
export function hasSecretKey(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): IEncryptedSecret {
  if (plaintext === "") {
    throw new NodeFilesSecretError("El secreto no puede estar vacío");
  }
  if (plaintext.length > MAX_SECRET_LENGTH) {
    throw new NodeFilesSecretError(
      `El secreto no puede superar los ${MAX_SECRET_LENGTH} caracteres`,
    );
  }

  const key = readKey();
  // A fresh IV per secret. Reusing one under GCM leaks plaintext outright, so
  // it is generated here and never derived from anything about the row.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(parts: IEncryptedSecret): string {
  const key = readKey();
  const iv = Buffer.from(parts.iv, "base64");
  const tag = Buffer.from(parts.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new NodeFilesSecretError(
      "La credencial guardada está corrupta y no se puede descifrar",
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(parts.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered row — indistinguishable on purpose, and neither is
    // worth describing to whoever is reading the run.
    throw new NodeFilesSecretError(
      "No se pudo descifrar la credencial (¿cambió NF_SECRET_KEY?)",
    );
  }
}

/**
 * Constant-time comparison of two secrets. Not used by the nodes today; it is
 * here so that the first person who needs to compare a secret does not reach
 * for `===` and add a timing oracle.
 */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
