import crypto from "crypto";

/**
 * SECURITY (M5): one-way hash for single-use tokens (password-reset + invitation tokens) so the
 * raw value is never stored at rest. We use SHA-256 (hex): these are high-entropy random tokens
 * (32 random bytes), so a fast hash is appropriate — no salt/slow-KDF needed (unlike passwords).
 *
 * Flow: generate raw token (crypto.randomBytes(32).toString("hex")) → email the RAW token to the
 * user → store hashToken(raw) in the DB. On redemption, hash the incoming raw token and look it up.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
