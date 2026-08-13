import { isReservedDnsSlug, isValidDnsSlug } from "../../../utils/slugify";

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
    if (this.slug !== undefined) {
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
    }

    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
