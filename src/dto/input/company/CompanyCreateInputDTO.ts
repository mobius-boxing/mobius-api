import {
  isReservedDnsSlug,
  isValidDnsSlug,
  toDnsSlug,
} from "../../../utils/slugify";

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
    if (typeof this.name !== "string" || this.name.trim().length === 0) {
      throw new Error("El nombre de la empresa es obligatorio");
    }
    // A slug is part of a live hostname, so an invalid one is a hard error and
    // never a silently-corrected value: the subdomain the operator was told to
    // configure must be exactly the slug that got stored.
    if (!isValidDnsSlug(this.slug)) {
      throw new Error(
        "El identificador (slug) debe tener entre 1 y 63 caracteres, sólo minúsculas, números y guiones, sin guión al principio ni al final, y no puede ser sólo números",
      );
    }
    if (isReservedDnsSlug(this.slug)) {
      throw new Error(
        `El identificador (slug) "${this.slug}" está reservado. Elegí otro.`,
      );
    }
    return this;
  }
}
