import { isReservedDnsSlug, isValidDnsSlug } from "../../../utils/slugify";
import {
  clearableText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";
import { collect, FieldValidationError } from "../shared/ValidationError";
import { COMPANY_LABELS, COMPANY_LIMITS } from "./CompanyCreateInputDTO";

/**
 * The update half of the company DTO, matching the create half: same rules,
 * same Spanish copy, now keyed to fields so the modal can pin the slug message
 * on the slug input instead of showing a generic banner.
 *
 * A present `name` is held to the create rule — blanking a NOT NULL column
 * must fail here, not as a knex error carrying the SQL. `slug` is only checked
 * when sent, because renaming a company must never silently move its live
 * subdomain.
 */

export class CompanyUpdateInputDTO {
  name?: string;
  /**
   * Only ever set when sent explicitly — renaming a company must not silently
   * move its live subdomain.
   */
  slug?: string;
  description?: string;
  isActive?: boolean;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.slug !== undefined)
      this.slug =
        typeof data.slug === "string"
          ? data.slug.trim().toLowerCase()
          : data.slug;
    if (data.description !== undefined) this.description = data.description;
    if (data.isActive !== undefined) this.isActive = data.isActive;
  }

  public build(): this {
    collect((field) => {
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, COMPANY_LIMITS.name, COMPANY_LABELS.name),
        );
      }
      if (this.description !== undefined) {
        this.description =
          field("description", () =>
            clearableText(
              this.description,
              COMPANY_LIMITS.description,
              COMPANY_LABELS.description,
            ),
          ) ?? undefined;
      }
      if (this.isActive !== undefined) {
        this.isActive = field("isActive", () =>
          toBoolean(this.isActive, "El estado"),
        );
      }
      if (this.slug !== undefined) {
        field("slug", () => {
          const slug = this.slug as string;
          if (!isValidDnsSlug(slug)) {
            throw new FieldValidationError(
              "slug",
              "El identificador (slug) debe tener entre 1 y 63 caracteres, sólo minúsculas, números y guiones, sin guión al principio ni al final, y no puede ser sólo números",
            );
          }
          if (isReservedDnsSlug(slug)) {
            throw new FieldValidationError(
              "slug",
              `El identificador (slug) "${slug}" está reservado. Elegí otro.`,
            );
          }
          return slug;
        });
      }
    });

    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
