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
