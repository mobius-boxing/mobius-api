import { Request, Response, NextFunction } from "express";
import { CompanyDAO } from "../../dao/company/company.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { FileDAO } from "../../dao/file/file.dao";
import { FileStorageService } from "../../services/file-storage.service";
import {
  ICompany,
  ICompanyBranding,
} from "../../interfaces/company/company.interfaces";
import { isValidDnsSlug } from "../../utils/slugify";
import { normalizeBranding } from "../../utils/whitelabel-branding";

/** Mobius green — what a tenant gets until somebody picks a colour. */
const DEFAULT_BRAND_COLOR = "#018445";
/** Public origin of this API; the logo URL must be absolute (a different origin renders it). */
const DEFAULT_PUBLIC_API_URL = "https://api.mobiusboxing.com";
/** Branding is small, public and changes rarely — but not never. */
const LOGO_CACHE_CONTROL = "public, max-age=300";

interface ResolvedTenant {
  /**
   * id/uuid are narrowed to non-optional on purpose: the logo lookup scopes the
   * files row by company uuid, and `applyCompanyUuidScope` treats an undefined
   * uuid as "no scoping" (superAdmin semantics). An unresolvable company must
   * therefore never reach that call.
   */
  company: ICompany & { id: number; uuid: string };
  branding: ICompanyBranding;
}

/**
 * Public, UNAUTHENTICATED whitelabel branding for `{client}.<module>.mobiusboxing.com`
 * (modules.md §3). The SPA parses its own hostname, extracts the client label and
 * asks for the branding before anyone has logged in — there is no token to
 * authorize with, by design.
 *
 * SECURITY (L-009): unauthenticated does NOT mean unscoped. Everything here is
 * derived from `companies.slug` + `companies.branding` + the module's
 * `company_modules` row, and the response carries branding only: a company uuid,
 * its slug, and the four fields a login screen needs. No user, no counts, no
 * membership, no numeric ids.
 *
 * Unknown client, unknown module, module not enabled for that client, and a
 * blocked subscription all answer the SAME generic 404 — telling them apart
 * would turn this into an enumeration oracle over our customer list.
 *
 * NOTE: `:module` is the module's internal slug (`countdown`), which is NOT the
 * hostname label of the product domain (`vencimientos`). Never assume they match.
 */
export class WhitelabelController {
  private companyDAO = new CompanyDAO();
  private companyModuleDAO = new CompanyModuleDAO();
  private fileDAO = new FileDAO();
  private storage = new FileStorageService();

  /** The one and only answer for anything that does not resolve. */
  private notFound(res: Response): void {
    res.status(404).json({ success: false, message: "Not found" });
  }

  /**
   * Resolve `:client` + `:module` to a company and its branding, or null.
   *
   * The module still has to be enabled — `getEnabledConfig` remains the
   * subscription/enabled gate and a null answer is still the generic 404 — but
   * its payload is no longer the branding source: branding is a property of the
   * COMPANY (`companies.branding`), shared by every module that company has.
   *
   * Fail-soft on the stored blob (`normalizeBranding` never throws): a malformed
   * or half-written value yields empty branding and the defaults below, never a
   * 500 on a public endpoint.
   */
  private async resolve(
    moduleSlug: string,
    clientSlug: string,
  ): Promise<ResolvedTenant | null> {
    // Cheap shape guard: junk in the path never reaches a query.
    if (!isValidDnsSlug(clientSlug) || !isValidDnsSlug(moduleSlug)) return null;

    const company = await this.companyDAO.getBySlug(clientSlug);
    if (!company || !company.id || !company.uuid) return null;
    const identified = { ...company, id: company.id, uuid: company.uuid };

    // Enabled + usable subscription, exactly as CompanyModuleDAO.isEnabled
    // defines it. Kept as the gate: a module that is not enabled for this
    // company must still 404, branding or no branding.
    const enabled = await this.companyModuleDAO.getEnabledConfig(
      identified.id,
      moduleSlug,
    );
    if (enabled === null) return null;

    return {
      company: identified,
      branding: normalizeBranding(identified.branding),
    };
  }

  /** Absolute so the module SPA (a different origin) can render it in an <img>. */
  private logoUrl(moduleSlug: string, clientSlug: string): string {
    const base = (process.env.PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL).replace(
      /\/+$/,
      "",
    );
    return `${base}/api/public/whitelabel/${encodeURIComponent(
      moduleSlug,
    )}/${encodeURIComponent(clientSlug)}/logo`;
  }

  /** GET /api/public/whitelabel/:module/:client */
  public async getBranding(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { module: moduleSlug, client: clientSlug } = req.params;
      const resolved = await this.resolve(moduleSlug, clientSlug);
      if (!resolved) {
        this.notFound(res);
        return;
      }

      const { company, branding } = resolved;
      res.status(200).json({
        success: true,
        data: {
          companyUuid: company.uuid,
          slug: company.slug,
          // A company that never set a display name is simply called by its name.
          displayName: branding.displayName ?? company.name,
          brandColor: branding.brandColor ?? DEFAULT_BRAND_COLOR,
          logoUrl: branding.logoFileUuid
            ? this.logoUrl(moduleSlug, clientSlug)
            : null,
          loginMessage: branding.loginMessage,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /api/public/whitelabel/:module/:client/logo
   *
   * SECURITY: this is NOT a file endpoint with a tenant filter bolted on — the
   * file uuid is never taken from the request. The only file it can ever serve
   * is the exact `logoFileUuid` recorded in that company's own branding, and the
   * files row is additionally scoped to that company. Anything else is the same
   * generic 404.
   */
  public async getLogo(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { module: moduleSlug, client: clientSlug } = req.params;
      const resolved = await this.resolve(moduleSlug, clientSlug);
      if (!resolved || !resolved.branding.logoFileUuid) {
        this.notFound(res);
        return;
      }

      const file = await this.fileDAO.getByUuid(
        resolved.branding.logoFileUuid,
        resolved.company.uuid,
      );
      if (!file) {
        this.notFound(res);
        return;
      }

      res.setHeader("Cache-Control", LOGO_CACHE_CONTROL);

      // helmet defaults every response to `Cross-Origin-Resource-Policy:
      // same-origin`, which is right for the API but fatal here: the tenant SPA
      // is served from {client}.vencimientos.mobiusboxing.com while this image
      // comes from api.mobiusboxing.com, so the browser refused to paint it and
      // every customer logo rendered as a broken image. This is a deliberately
      // public asset — the route serves only the uuid recorded in that company's
      // own branding — so it opts out for itself alone, without loosening the
      // policy for any other endpoint.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      // S3 driver: hand the browser a short-lived signed URL. No download name
      // is passed, so the object is served inline rather than as an attachment.
      const url = await this.storage.getDownloadUrl(file.storageKey);
      if (url) {
        res.redirect(302, url);
        return;
      }

      // Local-disk driver: stream through the API.
      if (!(await this.storage.localObjectExists(file.storageKey))) {
        this.notFound(res);
        return;
      }
      if (file.contentType) res.setHeader("Content-Type", file.contentType);
      this.storage.getLocalReadStream(file.storageKey).pipe(res);
    } catch (err: any) {
      next(err);
    }
  }
}
