import {
  emailText,
  idOrUuid,
  oneOfText,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/user.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   users.email     varchar(255) NOT NULL, UNIQUE (email) — GLOBAL
 *   users.password  varchar(255) NOT NULL
 *   users.firstName varchar(255) NOT NULL
 *   users.lastName  varchar(255) NOT NULL
 *   users.role      text         NOT NULL, default 'member'
 *   users.companyId integer      NULL
 *
 * THE ONLY REAL CHECK CONSTRAINT IN THIS SCHEMA:
 *   CHECK (role = ANY (ARRAY['member','admin','superAdmin']))
 * `USER_ROLES` is that array verbatim from `pg_constraint`. Off-list values are
 * a 23514 whose message carries the constraint name, so catching them here is
 * the difference between a field error and a leaked constraint.
 *
 * `companyId` accepts a uuid OR a numeric id (`idOrUuid`). The old constructor
 * ran `parseInt(companyId, 10)`, which on the uuid the clients actually send
 * yields the leading digits or NaN — the users controller already carried a
 * `/^\d+$/` guard for this on the update path (SECURITY C3); this puts the same
 * guard on create.
 *
 * The password MINIMUM is not enforced here: this DTO also serves internal
 * callers that pass an already-hashed value, and a hash is not the string the
 * user typed. Length is bounded; the 8-character product rule lives on the
 * client and in the auth flows that accept a typed password.
 */
export const USER_ROLES = ["member", "admin", "superAdmin"] as const;

export const USER_LIMITS = {
  email: 255,
  password: 255,
  firstName: 255,
  lastName: 255,
};

export const USER_LABELS = {
  email: "El correo electrónico",
  password: "La contraseña",
  firstName: "El nombre",
  lastName: "El apellido",
  role: "El rol",
  companyId: "La empresa",
  isActive: "El estado",
  emailVerified: "La verificación de correo",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class UserCreateInputDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  companyId?: number | string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.email = source.email as string;
    this.password = source.password as string;
    this.firstName = source.firstName as string;
    this.lastName = source.lastName as string;
    this.role = source.role as string;
    this.companyId = source.companyId as number | string | undefined;
  }

  public build(): this {
    collect((field) => {
      this.email = field("email", () =>
        emailText(this.email, USER_LIMITS.email, USER_LABELS.email),
      );
      this.password = field("password", () =>
        requiredText(this.password, USER_LIMITS.password, USER_LABELS.password),
      );
      this.firstName = field("firstName", () =>
        requiredText(
          this.firstName,
          USER_LIMITS.firstName,
          USER_LABELS.firstName,
        ),
      );
      this.lastName = field("lastName", () =>
        requiredText(this.lastName, USER_LIMITS.lastName, USER_LABELS.lastName),
      );
      // `role` is NOT NULL but carries a DEFAULT ('member'), so per the
      // brief's rule it is OPTIONAL on the server: an API caller that omits it
      // gets the default, exactly as before this batch. When it IS sent it must
      // still satisfy `users_role_check`. The client form marks it required —
      // that is a UI rule, and a stricter client is fine; a stricter API is a
      // contract change this batch may not make.
      if (this.role !== undefined) {
        this.role = field("role", () =>
          oneOfText(this.role, USER_ROLES, USER_LABELS.role),
        );
      }
      this.companyId = field("companyId", () =>
        idOrUuid(this.companyId, USER_LABELS.companyId),
      );
    });

    // `inputValidator` rejects ANY own key holding `undefined`, so an absent
    // optional field used to 400 a request the nullable column would accept.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
