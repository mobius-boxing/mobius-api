/**
 * SECURITY (C3): self/admin profile-update DTO. Only ever carries non-privileged profile fields
 * (firstName, lastName, email). It deliberately omits role, isActive, emailVerified, companyId and
 * password so those can never be set through this path. Privileged fields are handled exclusively
 * by UserUpdateInputDTO under a superAdmin-only branch in the controller.
 */
export class UserSelfUpdateInputDTO {
  email?: string;
  firstName?: string;
  lastName?: string;

  constructor(data: any) {
    if (data.email !== undefined) this.email = data.email;
    if (data.firstName !== undefined) this.firstName = data.firstName;
    if (data.lastName !== undefined) this.lastName = data.lastName;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
