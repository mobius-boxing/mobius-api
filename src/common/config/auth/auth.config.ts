export interface AuthConfig {
  accessTtlSeconds: number;
  refreshIdleTtlSeconds: number;
  refreshAbsoluteTtlSeconds: number;
  refreshGraceSeconds: number;
  cookieName: string;
  cookieDomain?: string;
  cookieSecure: boolean;
}

const positiveInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Read per call so a test or a restart-free env change is honoured; all durations are integer seconds. */
export const getAuthConfig = (): AuthConfig => ({
  accessTtlSeconds: positiveInt("ACCESS_TOKEN_TTL_SECONDS", 900),
  refreshIdleTtlSeconds: positiveInt("REFRESH_IDLE_TTL_SECONDS", 259200),
  refreshAbsoluteTtlSeconds: positiveInt(
    "REFRESH_ABSOLUTE_TTL_SECONDS",
    2592000,
  ),
  refreshGraceSeconds: positiveInt("REFRESH_GRACE_SECONDS", 30),
  cookieName: `${process.env.COOKIE_PREFIX || "mobius"}_refresh`,
  cookieDomain: process.env.REFRESH_COOKIE_DOMAIN || undefined,
  cookieSecure: process.env.REFRESH_COOKIE_SECURE !== "false",
});

// A deployed .env still carrying JWT_EXPIRE=5h must not look like it controls access-token life.
if (process.env.JWT_EXPIRE) {
  console.warn(
    "JWT_EXPIRE is ignored; set ACCESS_TOKEN_TTL_SECONDS (access token lifetime in seconds).",
  );
}
