import {
  emailText,
  idOrUuid,
  oneOfText,
  requiredInt,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { USER_ROLES } from "../user/UserCreateInputDTO";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/invitation.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   invitations.email     varchar(255) NOT NULL
 *   invitations.role      text         NOT NULL
 *   invitations.companyId integer      NULL
 *   invitations.invitedBy integer      NOT NULL
 *   invitations.token     varchar(255) NOT NULL, UNIQUE — server-generated
 *   invitations.expiresAt timestamptz  NOT NULL       — server-generated
 *
 * `invitations.role` carries the SAME CHECK constraint as `users.role`, so
 * `USER_ROLES` is imported rather than restated — two copies of one database
 * constraint is one too many.
 *
 * `invitedBy` is NOT NULL and is set by the controller from the authenticated
 * caller, never by the client; it is validated as a required id because by the
 * time `build()` runs it must be there, and a missing one would otherwise
 * surface as a NOT NULL violation carrying the SQL.
 *
 * `token` and `expiresAt` stay out of this DTO on purpose: a client that could
 * set either could forge an invitation or extend its life.
 */
export const INVITATION_LIMITS = {
  email: 255,
  id: { min: 1, max: 2147483647 },
};

export const INVITATION_LABELS = {
  email: "El correo electrónico",
  role: "El rol",
  companyId: "La empresa",
  invitedBy: "El usuario que invita",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class InvitationCreateInputDTO {
  email: string;
  role: string;
  companyId?: number | string;
  invitedBy: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.email = source.email as string;
    this.role = source.role as string;
    this.companyId = source.companyId as number | string | undefined;
    this.invitedBy = source.invitedBy as number;
  }

  public build(): this {
    collect((field) => {
      this.email = field("email", () =>
        emailText(this.email, INVITATION_LIMITS.email, INVITATION_LABELS.email),
      );
      this.role = field("role", () =>
        oneOfText(this.role, USER_ROLES, INVITATION_LABELS.role),
      );
      this.companyId = field("companyId", () =>
        idOrUuid(this.companyId, INVITATION_LABELS.companyId),
      );
      this.invitedBy = field("invitedBy", () =>
        requiredInt(
          this.invitedBy,
          INVITATION_LIMITS.id,
          INVITATION_LABELS.invitedBy,
        ),
      );
    });

    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
