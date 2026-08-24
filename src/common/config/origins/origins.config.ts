export const getAllowedOrigins = (): string[] => {
  let origins: string = process.env.CORS_ALLOWED_ORIGINS || "localhost";
  origins = origins
    .split("\n")
    .join("")
    .split("\r")
    .join("")
    .split(" ")
    .join("");
  return origins.split(",").filter((o) => o.length > 0);
};

/**
 * SECURITY (H4): in production, refuse to start without an explicit CORS allowlist. Falling back to
 * "localhost" (or worse, reflecting arbitrary origins) alongside credentials:true would be unsafe.
 * Call this at app boot so a misconfiguration fails fast rather than silently opening CORS.
 */
export const validateAllowedOrigins = (): void => {
  if (process.env.NODE_ENV !== "production") return;

  const raw = process.env.CORS_ALLOWED_ORIGINS;
  const origins = raw
    ? raw
        .split(/[\n\r ]/)
        .join("")
        .split(",")
        .filter((o) => o.length > 0)
    : [];

  if (origins.length === 0) {
    throw new Error(
      "CORS_ALLOWED_ORIGINS must be set to a non-empty allowlist in production.",
    );
  }
};

/** A hostname label: what a single `*` is allowed to stand for. Fixed pattern — never built from input. */
const DNS_LABEL_PATTERN = /^[a-zA-Z0-9-]+$/;

/**
 * Does one allowlist entry match this Origin?
 *
 * Two entry shapes:
 *   - exact:    `https://app.mobiusboxing.com`  → plain string equality.
 *   - wildcard: `https://*.vencimientos.mobiusboxing.com` → the `*` stands for
 *     EXACTLY ONE hostname label (no dots), matching the DNS/TLS wildcard rule.
 *
 * SECURITY: no regular expression is ever built from the pattern or the origin —
 * matching is prefix/suffix string comparison plus a fixed label pattern. That
 * removes both regex injection and the classic `.` -> "any char" mistake, so
 * `https://vencimientos.mobiusboxing.com.evil.com` and
 * `https://a.b.vencimientos.mobiusboxing.com` are both rejected.
 */
const originMatchesPattern = (origin: string, pattern: string): boolean => {
  const star = pattern.indexOf("*");
  if (star === -1) return origin === pattern;

  // Exactly one wildcard, and only in the leftmost label position:
  // "<scheme>://" + "*" + ".rest.of.host". Anything else is a malformed entry
  // and matches nothing (fail closed rather than guess).
  if (pattern.indexOf("*", star + 1) !== -1) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!prefix.endsWith("://")) return false;
  if (!suffix.startsWith(".") || suffix.length < 2) return false;

  if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;

  const label = origin.slice(prefix.length, origin.length - suffix.length);
  // Guards the degenerate overlap case (origin shorter than prefix+suffix) as
  // well as multi-label and port-carrying values.
  if (label.length === 0) return false;
  return DNS_LABEL_PATTERN.test(label);
};

/**
 * Is this Origin header value allowed?
 *
 * Wildcard entries exist so that onboarding a whitelabel customer
 * (`{client}.vencimientos.mobiusboxing.com`) is a DNS + database change only —
 * it must NEVER require editing CORS_ALLOWED_ORIGINS and redeploying the API.
 *
 * An origin that matches nothing gets no CORS headers at all; the caller never
 * reflects an arbitrary origin back.
 */
export const isOriginAllowed = (
  origin: string,
  allowedOrigins: string[] = getAllowedOrigins(),
): boolean => {
  if (typeof origin !== "string" || origin.length === 0) return false;
  return allowedOrigins.some((pattern) =>
    originMatchesPattern(origin, pattern),
  );
};
