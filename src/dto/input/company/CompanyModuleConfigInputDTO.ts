import { ICompanyBranding } from "../../../interfaces/company/company.interfaces";
import { CompanyBrandingInputDTO } from "./CompanyBrandingInputDTO";

/**
 * Per-module configuration — the payload of
 * `PUT /api/companies/:uuid/modules/:slug/config`.
 *
 * The stored shape is namespaced by module slug inside `company_modules.config`:
 *
 *   config = { "<moduleSlug>": { "branding": { ...five fields... } } }
 *
 * LEGACY: the `branding` written here is NO LONGER READ by anything. Branding
 * became a property of the COMPANY (`companies.branding`, written by
 * `PUT /api/companies/:uuid/branding`), and the public whitelabel endpoint reads
 * it from there. This endpoint stays for genuine per-module config and its
 * existing shape is kept so no caller breaks; giving it a
 * real per-module DTO — or retiring it — is a follow-up spec.
 *
 * Validation is NOT duplicated: it delegates to `CompanyBrandingInputDTO`, the
 * one place the five fields' rules live, so the two endpoints can never drift.
 */
export type IModuleBranding = ICompanyBranding;

export class CompanyModuleConfigInputDTO {
  private brandingDTO: CompanyBrandingInputDTO;

  constructor(data: unknown) {
    const raw = (data ?? {}) as { branding?: unknown };
    // Nested here, flat there: this endpoint takes `{branding: {...}}`.
    this.brandingDTO = new CompanyBrandingInputDTO(raw.branding);
  }

  /** The normalized five fields, exactly as the branding endpoint stores them. */
  get branding(): IModuleBranding {
    return this.brandingDTO.toBranding();
  }

  /** THROWS on an invalid colour / over-long text / non-uuid logo — always a 400. */
  public build(): this {
    this.brandingDTO.build();
    return this;
  }

  /**
   * The object to merge into `config[<moduleSlug>]`. `branding` is replaced
   * wholesale (the editor always sends the complete set of five fields), while
   * any sibling key under the same module namespace — e.g. countdown's
   * `reminderDays` — is left untouched by the DAO merge.
   */
  public toConfigSection(): Record<string, unknown> {
    return { branding: { ...this.branding } };
  }
}
