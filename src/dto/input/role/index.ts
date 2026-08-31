import {
  optionalText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/role.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   roles.name                   varchar(200) NOT NULL, UNIQUE ("companyId", name)
 *   roles.profileType            varchar(50)  NOT NULL, default 'general'
 *   roles.hasAccessToAllMachines boolean      NOT NULL, default true
 *   roles.isProtected            boolean      NOT NULL, default false
 *
 * WHY `profileType` IS NOT AN ENUM, matching the client schema exactly: the B3
 * sign-off recorded 10 of 62 rows in `traffic_production` carrying a
 * `profileType` outside both the dropdown and the server's list. Enumerating it
 * would make those roles unsavable. That claim cannot be re-verified from this
 * machine (the local database holds only the five known values and
 * `traffic_production` is unreachable), so the recorded production observation
 * wins over the clean local data. There is no CHECK constraint on this column —
 * unlike `users.role`, which has one and IS enumerated.
 *
 * `isProtected` is absent on purpose: it guards built-in roles from renaming,
 * the controller enforces it, and no form may set it.
 *
 * `companyId` is injected by the controller from the caller's token (L-009).
 *
 * This DTO exists because `role.controller.ts` is hand-rolled and was doing
 * `if (!name || typeof name !== "string")` inline — CLAUDE.md requires even a
 * hand-rolled controller to validate through a DTO's `build()`.
 */
export const ROLE_LIMITS = {
  name: 200,
  /** The column width. NOT an enum — see the header. */
  profileType: 50,
};

export const ROLE_LABELS = {
  name: "El nombre",
  profileType: "El tipo de perfil",
  hasAccessToAllMachines: "El acceso a todas las máquinas",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class RoleCreateInputDTO {
  name: string;
  profileType?: string | null;
  hasAccessToAllMachines?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.profileType = source.profileType as string | null | undefined;
    this.hasAccessToAllMachines = source.hasAccessToAllMachines as
      | boolean
      | undefined;
  }

  protected validate(required: boolean): void {
    collect((field) => {
      if (required || this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, ROLE_LIMITS.name, ROLE_LABELS.name),
        );
      }
      if (this.profileType !== undefined) {
        this.profileType = field("profileType", () =>
          optionalText(
            this.profileType,
            ROLE_LIMITS.profileType,
            ROLE_LABELS.profileType,
          ),
        );
      }
      if (this.hasAccessToAllMachines !== undefined) {
        this.hasAccessToAllMachines = field("hasAccessToAllMachines", () =>
          toBoolean(
            this.hasAccessToAllMachines,
            ROLE_LABELS.hasAccessToAllMachines,
          ),
        );
      }
    });
  }

  public build(): this {
    this.validate(true);
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}

/**
 * Only the fields the request carried are validated; unset keys are stripped so
 * a partial update never blanks a column it did not mention.
 */
export class RoleUpdateInputDTO extends RoleCreateInputDTO {
  public build(): this {
    this.validate(false);
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
