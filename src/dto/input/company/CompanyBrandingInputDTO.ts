import { ICompanyBranding } from "../../../interfaces/company/company.interfaces";

/**
 * A company's whitelabel identity — the payload of
 * `PUT /api/companies/:uuid/branding`, stored in `companies.branding`.
 *
 * Body is FLAT:
 * `{displayName, brandColor, accentColor, shellColor, canvasColor,
 *   logoFileUuid, loginMessage}`.
 *
 * This is the ONLY place these fields are validated. Everything the public,
 * unauthenticated branding endpoint serves originates here and the JSONB column
 * carries no constraints: a colour that is not a colour would reach a browser as
 * a style value, and a `logoFileUuid` that is not a uuid would reach a database
 * lookup. The legacy `CompanyModuleConfigInputDTO` delegates to this class so
 * the two rule sets can never drift apart.
 *
 * Branding is replaced WHOLESALE: absent, `null` and `""` all mean "unset" and
 * become `null`, which is how a field gets cleared. A caller that sends a
 * partial body therefore clears the fields it omitted — the backoffice form
 * always submits every field.
 */

/** Rendered as the tenant's product name — long enough for a company name. */
const MAX_DISPLAY_NAME_LENGTH = 80;
/** One line of copy on the login screen, not a paragraph. */
const MAX_LOGIN_MESSAGE_LENGTH = 160;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
// UUID v4 (RFC 4122 §4.4) — same shape the validateUUID middleware enforces.
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Absent and explicit-null both mean "unset"; the public endpoint then falls back. */
const isUnset = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

/**
 * Trim a string field, leave anything else alone: a non-string survives to
 * `build()`, which is where it is rejected with a message.
 */
const cleanText = (value: unknown): unknown =>
  isUnset(value) ? null : typeof value === "string" ? value.trim() : value;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export class CompanyBrandingInputDTO {
  displayName: unknown;
  brandColor: unknown;
  accentColor: unknown;
  shellColor: unknown;
  canvasColor: unknown;
  logoFileUuid: unknown;
  loginMessage: unknown;

  constructor(data: unknown) {
    const raw = asRecord(data);

    this.displayName = cleanText(raw.displayName);
    // Colours are compared and stored lower-cased so `#2563EB` and `#2563eb`
    // are one value, not two.
    this.brandColor =
      typeof raw.brandColor === "string" && !isUnset(raw.brandColor)
        ? raw.brandColor.trim().toLowerCase()
        : cleanText(raw.brandColor);
    this.accentColor =
      typeof raw.accentColor === "string" && !isUnset(raw.accentColor)
        ? raw.accentColor.trim().toLowerCase()
        : cleanText(raw.accentColor);
    this.shellColor =
      typeof raw.shellColor === "string" && !isUnset(raw.shellColor)
        ? raw.shellColor.trim().toLowerCase()
        : cleanText(raw.shellColor);
    this.canvasColor =
      typeof raw.canvasColor === "string" && !isUnset(raw.canvasColor)
        ? raw.canvasColor.trim().toLowerCase()
        : cleanText(raw.canvasColor);
    this.logoFileUuid = cleanText(raw.logoFileUuid);
    this.loginMessage = cleanText(raw.loginMessage);
  }

  /**
   * THROWS on anything the public endpoint could not serve safely. The caller
   * turns that into a 400 (`req.statusCode = 400` + `next(err)`), never a 500.
   */
  public build(): this {
    const {
      displayName,
      brandColor,
      accentColor,
      shellColor,
      canvasColor,
      logoFileUuid,
      loginMessage,
    } = this;

    if (displayName !== null) {
      if (typeof displayName !== "string" || displayName.length === 0) {
        throw new Error("El nombre a mostrar no puede estar vacío");
      }
      if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        throw new Error(
          `El nombre a mostrar no puede tener más de ${MAX_DISPLAY_NAME_LENGTH} caracteres`,
        );
      }
    }

    if (brandColor !== null) {
      if (
        typeof brandColor !== "string" ||
        !HEX_COLOR_PATTERN.test(brandColor)
      ) {
        throw new Error(
          "El color de marca debe ser un hexadecimal con el formato #rrggbb",
        );
      }
    }

    if (accentColor !== null) {
      if (
        typeof accentColor !== "string" ||
        !HEX_COLOR_PATTERN.test(accentColor)
      ) {
        throw new Error(
          "El color de acento debe ser un hexadecimal con el formato #rrggbb",
        );
      }
    }

    if (shellColor !== null) {
      if (
        typeof shellColor !== "string" ||
        !HEX_COLOR_PATTERN.test(shellColor)
      ) {
        throw new Error(
          "El color de la barra debe ser un hexadecimal con el formato #rrggbb",
        );
      }
    }

    if (canvasColor !== null) {
      if (
        typeof canvasColor !== "string" ||
        !HEX_COLOR_PATTERN.test(canvasColor)
      ) {
        throw new Error(
          "El color de fondo debe ser un hexadecimal con el formato #rrggbb",
        );
      }
    }

    if (logoFileUuid !== null) {
      if (
        typeof logoFileUuid !== "string" ||
        !UUID_V4_PATTERN.test(logoFileUuid)
      ) {
        throw new Error("El logo debe referenciar un archivo válido (uuid)");
      }
    }

    if (loginMessage !== null) {
      if (typeof loginMessage !== "string") {
        throw new Error("El mensaje de login debe ser texto");
      }
      if (loginMessage.length > MAX_LOGIN_MESSAGE_LENGTH) {
        throw new Error(
          `El mensaje de login no puede tener más de ${MAX_LOGIN_MESSAGE_LENGTH} caracteres`,
        );
      }
    }

    return this;
  }

  /**
   * The validated value to store. Only callable meaningfully after `build()` —
   * before it, the fields are still whatever the client sent.
   */
  public toBranding(): ICompanyBranding {
    return {
      displayName: this.displayName as string | null,
      brandColor: this.brandColor as string | null,
      accentColor: this.accentColor as string | null,
      shellColor: this.shellColor as string | null,
      canvasColor: this.canvasColor as string | null,
      logoFileUuid: this.logoFileUuid as string | null,
      loginMessage: this.loginMessage as string | null,
    };
  }
}
