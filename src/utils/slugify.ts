/**
 * DNS-safe slugs for whitelabeled hostnames (`{client}.vencimientos.mobiusboxing.com`).
 *
 * A company's slug becomes ONE DNS label, so the rules here are the DNS label
 * rules, not "pretty url" rules: lowercase a-z0-9 plus hyphens, never starting
 * or ending with a hyphen, at most 63 characters (the hard per-label limit in
 * RFC 1035 §2.3.4), and never all-numeric (an all-numeric label is ambiguous
 * with an IPv4 literal in some resolvers).
 *
 * Single definition on purpose: the `companies.slug` migration backfill, the
 * company DTOs and the public whitelabel endpoint must all agree on what a
 * valid slug is, or a company gets a slug nobody can look up.
 */

/** RFC 1035 §2.3.4 — a DNS label is at most 63 octets. */
export const MAX_DNS_LABEL_LENGTH = 63;

/**
 * Labels we keep for ourselves. They either already resolve to something of
 * ours (www/api/app/backoffice/mail/ftp), name a first-class product surface
 * (store/admin/countdown), or would confuse local development (localhost).
 * A customer that legitimately wants one of these gets a suffixed slug.
 */
export const RESERVED_DNS_SLUGS: readonly string[] = [
  "www",
  "api",
  "app",
  "backoffice",
  "store",
  "admin",
  "mail",
  "ftp",
  "localhost",
  "countdown",
];

/** Fixed pattern — never built from user input. */
const DNS_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ALL_DIGITS_PATTERN = /^[0-9]+$/;
const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/g;
const HYPHEN_RUN_PATTERN = /-{2,}/g;
const EDGE_HYPHENS_PATTERN = /^-+|-+$/g;

/**
 * Derive a DNS label from free text. Deterministic: the same input always
 * yields the same slug, which is what lets the migration backfill and the API
 * produce identical values.
 *
 * Accents are folded (NFD + drop combining marks) rather than dropped, so
 * "Cañuelas Envases" becomes "canuelas-envases" and not "c-uelas-envases".
 *
 * Returns "" when the input carries no usable characters — callers decide what
 * to do with that (throw, or fall back to a synthetic slug).
 */
export function toDnsSlug(input: string): string {
  if (typeof input !== "string") return "";
  return (
    input
      .normalize("NFD")
      .replace(COMBINING_MARKS_PATTERN, "")
      .toLowerCase()
      .replace(NON_ALPHANUMERIC_PATTERN, "-")
      .replace(HYPHEN_RUN_PATTERN, "-")
      .replace(EDGE_HYPHENS_PATTERN, "")
      .slice(0, MAX_DNS_LABEL_LENGTH)
      // Truncating can expose a trailing hyphen ("...foo-bar" cut mid-word).
      .replace(EDGE_HYPHENS_PATTERN, "")
  );
}

/**
 * Is this string usable as-is as a hostname label? Deliberately stricter than
 * `toDnsSlug`'s output needs to be: it is the gate for slugs typed by a human
 * in the backoffice.
 */
export function isValidDnsSlug(s: string): boolean {
  if (typeof s !== "string") return false;
  if (s.length === 0 || s.length > MAX_DNS_LABEL_LENGTH) return false;
  if (ALL_DIGITS_PATTERN.test(s)) return false;
  return DNS_SLUG_PATTERN.test(s);
}

/** Reserved check is case-insensitive because slugs are compared lowercased. */
export function isReservedDnsSlug(s: string): boolean {
  if (typeof s !== "string") return false;
  return RESERVED_DNS_SLUGS.includes(s.toLowerCase());
}
