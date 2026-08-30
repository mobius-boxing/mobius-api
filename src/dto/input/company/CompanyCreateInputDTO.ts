import {
  isReservedDnsSlug,
  isValidDnsSlug,
  toDnsSlug,
} from "../../../utils/slugify";
import { clearableText, requiredText } from "../shared/fieldValidators";
import { collect, FieldValidationError } from "../shared/ValidationError";

/**
 * Server mirror of the company create/edit modals' schema (B6 backoffice / B7
 * web app — both collect `name` and `description`; `slug` is server-derived).
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30):
 *   companies.name        varchar(255) NOT NULL
 *   companies.description text         NULL
 *   companies.slug        varchar(63)  NOT NULL, UNIQUE
 *   companies.branding    jsonb        NOT NULL, default '{}'
 *
 * The slug rules below are UNCHANGED — same checks, same Spanish copy. What
 * changes is how they FAIL: they were bare `Error`s, which the middleware turns
 * into a generic response with no field attached, so a form could not show the
 * message on the slug input. They are now `collect()`ed field errors like every
 * other DTO, which is the entire point of this program.
 *
 * `branding` is a separate sub-resource with its own DTO behind its own
 * endpoint, and is deliberately not touched here.
 */
export const COMPANY_LIMITS = {
  name: 255,
  description: 10000,
};

export const COMPANY_LABELS = {
  name: "El nombre",
  description: "La descripción",
};

export class CompanyCreateInputDTO {
  name: string;
  /**
   * DNS label for whitelabeled hostnames. Derived from the name when the caller
   * does not send one, so existing clients keep working; sent explicitly when
   * the superadmin wants a specific subdomain.
   */
  slug: string;
  description?: string;

  constructor(data: any) {
    this.name = data.name;
    this.slug =
      typeof data.slug === "string" && data.slug.trim().length > 0
        ? data.slug.trim().toLowerCase()
        : toDnsSlug(typeof data.name === "string" ? data.name : "");
    if (data.description !== undefined) this.description = data.description;
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () =>
        requiredText(this.name, COMPANY_LIMITS.name, COMPANY_LABELS.name),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          COMPANY_LIMITS.description,
          COMPANY_LABELS.description,
        ),
      ) as string | undefined;
      // A slug is part of a live hostname, so an invalid one is a hard error
      // and never a silently-corrected value: the subdomain the operator was
      // told to configure must be exactly the slug that got stored. Same two
      // rules as before, now keyed to the `slug` field.
      field("slug", () => {
        if (!isValidDnsSlug(this.slug)) {
          throw new FieldValidationError(
            "slug",
            "El identificador (slug) debe tener entre 1 y 63 caracteres, sólo minúsculas, números y guiones, sin guión al principio ni al final, y no puede ser sólo números",
          );
        }
        if (isReservedDnsSlug(this.slug)) {
          throw new FieldValidationError(
            "slug",
            `El identificador (slug) "${this.slug}" está reservado. Elegí otro.`,
          );
        }
        return this.slug;
      });
    });

    return this;
  }
}
