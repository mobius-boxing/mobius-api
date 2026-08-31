import { describe, it, expect } from "@jest/globals";
import {
  UserCreateInputDTO,
  USER_ROLES,
} from "../../../dto/input/user/UserCreateInputDTO";
import { UserUpdateInputDTO } from "../../../dto/input/user/UserUpdateInputDTO";
import { InvitationCreateInputDTO } from "../../../dto/input/invitation/InvitationCreateInputDTO";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

const failure = (fn: () => unknown): ValidationError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected build() to throw a ValidationError");
};

const fields = (error: ValidationError): string[] =>
  error.errors.map((e) => e.field);

const UUID = "11111111-2222-3333-4444-555555555555";

/**
 * Server mirror of `mobius-web-app/src/__tests__/validation/b6Auth.test.ts`.
 *
 * Two things here are unique in the whole program: the only real CHECK
 * constraint (`users_role_check`), and the only field that legitimately accepts
 * two different shapes (`companyId`: a uuid from clients, an int from internal
 * callers).
 */
describe("UserCreateInputDTO / UserUpdateInputDTO", () => {
  const user = {
    email: "ada@example.com",
    password: "hashed-or-typed-value",
    firstName: "Ada",
    lastName: "Lovelace",
    role: "admin",
  };

  it("round-trips a valid user", () => {
    expect(new UserCreateInputDTO(user).build()).toEqual(user);
  });

  it("mirrors users_role_check exactly", () => {
    expect([...USER_ROLES]).toEqual(["member", "admin", "superAdmin"]);
    USER_ROLES.forEach((role) => {
      expect(
        (new UserCreateInputDTO({ ...user, role }).build() as { role: string })
          .role,
      ).toBe(role);
    });
    expect(
      fields(
        failure(() => new UserCreateInputDTO({ ...user, role: "owner" }).build()),
      ),
    ).toEqual(["role"]);
  });

  it("rejects a malformed email as a field error", () => {
    expect(
      fields(failure(() => new UserCreateInputDTO({ ...user, email: "ada@" }).build())),
    ).toEqual(["email"]);
  });

  /**
   * The bug this replaces: `parseInt("3f2b…", 10)` is 3, and
   * `parseInt("a1b2…", 10)` is NaN — either way a wrong FK reached the column.
   */
  it("accepts a uuid companyId without mangling it into a number", () => {
    const built = new UserCreateInputDTO({
      ...user,
      companyId: UUID,
    }).build() as unknown as Record<string, unknown>;
    expect(built.companyId).toBe(UUID);
  });

  it("accepts a numeric companyId from internal callers", () => {
    const built = new UserCreateInputDTO({
      ...user,
      companyId: 7,
    }).build() as unknown as Record<string, unknown>;
    expect(built.companyId).toBe(7);
  });

  it("rejects a companyId that is neither shape", () => {
    expect(
      fields(
        failure(() =>
          new UserCreateInputDTO({ ...user, companyId: "not-an-id" }).build(),
        ),
      ),
    ).toEqual(["companyId"]);
  });

  it("reports every bad field at once", () => {
    expect(
      fields(
        failure(() =>
          new UserCreateInputDTO({
            email: "nope",
            password: "",
            firstName: "",
            lastName: "Lovelace",
            role: "owner",
          }).build(),
        ),
      ).sort(),
    ).toEqual(["email", "firstName", "password", "role"]);
  });

  it("sets only the fields an update carried", () => {
    expect(new UserUpdateInputDTO({ firstName: "Grace" }).build()).toEqual({
      firstName: "Grace",
    });
  });

  /** `null` means "detach from company" and is the controller's to interpret. */
  it("passes a null companyId through untouched on update", () => {
    expect(new UserUpdateInputDTO({ companyId: null }).build()).toEqual({
      companyId: null,
    });
  });

  it("refuses to blank a NOT NULL name on update", () => {
    expect(
      fields(failure(() => new UserUpdateInputDTO({ firstName: " " }).build())),
    ).toEqual(["firstName"]);
  });
});

describe("InvitationCreateInputDTO", () => {
  const invite = {
    email: "ada@example.com",
    role: "member",
    invitedBy: 3,
  };

  it("round-trips a valid invitation", () => {
    expect(new InvitationCreateInputDTO(invite).build()).toEqual(invite);
  });

  it("shares the role constraint with users", () => {
    expect(
      fields(
        failure(() =>
          new InvitationCreateInputDTO({ ...invite, role: "owner" }).build(),
        ),
      ),
    ).toEqual(["role"]);
  });

  it("requires invitedBy, which is a NOT NULL column", () => {
    expect(
      fields(
        failure(() =>
          new InvitationCreateInputDTO({
            email: invite.email,
            role: invite.role,
          }).build(),
        ),
      ),
    ).toEqual(["invitedBy"]);
  });

  /** `token` and `expiresAt` must never be settable by a client. */
  it("drops client-supplied token and expiresAt", () => {
    const built = new InvitationCreateInputDTO({
      ...invite,
      token: "forged",
      expiresAt: "2099-01-01",
    }).build() as unknown as Record<string, unknown>;
    expect("token" in built).toBe(false);
    expect("expiresAt" in built).toBe(false);
  });
});
