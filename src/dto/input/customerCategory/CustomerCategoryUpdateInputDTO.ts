import { collect } from "../shared/ValidationError";
import { validateCategoryName } from "./CustomerCategoryCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset. A present `name` gets the create rules (max 100, min
 * 2 — see the create DTO for why those, not the column's 255): blanking it
 * must fail here rather than as a NOT NULL violation whose knex message
 * carries the generated SQL.
 *
 * `companyId` is deliberately absent: an update never moves a category between
 * tenants, and the controller re-derives the caller's company to scope the
 * lookup (L-009).
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class CustomerCategoryUpdateInputDTO {
  name?: string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.name !== undefined) {
      this.name = source.name as string;
    }
  }

  public build(): this {
    collect((field) => {
      if (this.name !== undefined) {
        this.name = field("name", () => validateCategoryName(this.name));
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
