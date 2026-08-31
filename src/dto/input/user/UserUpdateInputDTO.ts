import {
  emailText,
  idOrUuid,
  oneOfText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { USER_LABELS, USER_LIMITS, USER_ROLES } from "./UserCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. A present `email`/`firstName`/`lastName` is still held to the create
 * rule: blanking a NOT NULL column must fail here, not as a knex error.
 *
 * `companyId` is the one field this DTO deliberately does NOT resolve: the
 * users controller clears it on `""`/`null` and resolves a uuid to an id
 * itself (SECURITY C3), so this only checks the SHAPE and leaves the meaning
 * to the controller. `null` therefore passes through untouched — it means
 * "detach this user from their company".
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class UserUpdateInputDTO {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  companyId?: number | string | null;
  isActive?: boolean;
  emailVerified?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.email !== undefined) this.email = source.email as string;
    if (source.password !== undefined)
      this.password = source.password as string;
    if (source.firstName !== undefined)
      this.firstName = source.firstName as string;
    if (source.lastName !== undefined)
      this.lastName = source.lastName as string;
    if (source.role !== undefined) this.role = source.role as string;
    if (source.companyId !== undefined)
      this.companyId = source.companyId as number | string | null;
    if (source.isActive !== undefined)
      this.isActive = source.isActive as boolean;
    if (source.emailVerified !== undefined)
      this.emailVerified = source.emailVerified as boolean;
  }

  public build(): this {
    collect((field) => {
      if (this.email !== undefined) {
        this.email = field("email", () =>
          emailText(this.email, USER_LIMITS.email, USER_LABELS.email),
        );
      }
      if (this.password !== undefined) {
        this.password = field("password", () =>
          requiredText(
            this.password,
            USER_LIMITS.password,
            USER_LABELS.password,
          ),
        );
      }
      if (this.firstName !== undefined) {
        this.firstName = field("firstName", () =>
          requiredText(
            this.firstName,
            USER_LIMITS.firstName,
            USER_LABELS.firstName,
          ),
        );
      }
      if (this.lastName !== undefined) {
        this.lastName = field("lastName", () =>
          requiredText(
            this.lastName,
            USER_LIMITS.lastName,
            USER_LABELS.lastName,
          ),
        );
      }
      if (this.role !== undefined) {
        this.role = field("role", () =>
          oneOfText(this.role, USER_ROLES, USER_LABELS.role),
        );
      }
      // `null`/`""` means "detach from company" and is the controller's to
      // interpret; only a real value is shape-checked.
      if (
        this.companyId !== undefined &&
        this.companyId !== null &&
        this.companyId !== ""
      ) {
        this.companyId = field("companyId", () =>
          idOrUuid(this.companyId, USER_LABELS.companyId),
        );
      }
      if (this.isActive !== undefined) {
        this.isActive = field("isActive", () =>
          toBoolean(this.isActive, USER_LABELS.isActive),
        );
      }
      if (this.emailVerified !== undefined) {
        this.emailVerified = field("emailVerified", () =>
          toBoolean(this.emailVerified, USER_LABELS.emailVerified),
        );
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
