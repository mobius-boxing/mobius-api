import { ICompanyBranding } from "../interfaces/company/company.interfaces";

/**
 * Fail-soft reading of whitelabel branding.
 *
 * Two callers share this file on purpose:
 *  - the public, unauthenticated `GET /api/public/whitelabel/:module/:client`,
 *    which reads `companies.branding`;
 *  - the `companies.branding` backfill migration, which reads the legacy
 *    `company_modules.config.<slug>.branding` blob.
 *
 * Both look at a JSONB column that carries no constraints, so both need the
 * same answer to "is this actually a colour / a uuid / a name?". Duplicating
 * the rules would let the migration copy something the endpoint then drops.
 *
 * NOTHING here throws: a half-written blob yields nulls and the caller's
 * defaults, never a 500 on a public endpoint or a failed migration. Validation
 * that rejects belongs in `CompanyBrandingInputDTO`, on the write path.
 */

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
// UUID v4 (RFC 4122 §4.4) — same shape the validateUUID middleware enforces.
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Every field unset — the shape a caller gets for junk input. */
const emptyBranding = (): ICompanyBranding => ({
  displayName: null,
  brandColor: null,
  accentColor: null,
  logoFileUuid: null,
  loginMessage: null,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Non-empty string, or null. */
const readText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Non-empty string matching `pattern`, or null. */
const readPattern = (value: unknown, pattern: RegExp): string | null =>
  typeof value === "string" && pattern.test(value) ? value : null;

/**
 * Coerce an arbitrary JSONB value into the five branding fields. Anything that
 * is not a usable value for its field becomes `null`.
 */
export function normalizeBranding(raw: unknown): ICompanyBranding {
  try {
    const branding = asRecord(raw);

    return {
      displayName: readText(branding.displayName),
      brandColor: readPattern(branding.brandColor, HEX_COLOR_PATTERN),
      accentColor: readPattern(branding.accentColor, HEX_COLOR_PATTERN),
      logoFileUuid: readPattern(branding.logoFileUuid, UUID_V4_PATTERN),
      loginMessage: readText(branding.loginMessage),
    };
  } catch {
    return emptyBranding();
  }
}

/**
 * The legacy home of branding: `company_modules.config[<moduleSlug>].branding`
 * (written by `PUT /api/companies/:uuid/modules/:slug/config`). Read only by
 * the backfill migration — the public endpoint stopped reading it when branding
 * moved to the company.
 */
export function readLegacyModuleBranding(
  config: unknown,
  moduleSlug: string,
): ICompanyBranding {
  const moduleSection = asRecord(asRecord(config)[moduleSlug]);
  return normalizeBranding(moduleSection.branding);
}

/** True when every field is unset — "this company has no branding". */
export function isEmptyBranding(branding: ICompanyBranding): boolean {
  return (
    branding.displayName === null &&
    branding.brandColor === null &&
    branding.accentColor === null &&
    branding.logoFileUuid === null &&
    branding.loginMessage === null
  );
}
