// Whitelist ONLY. Must NOT carry password / passwordHash / emailVerified /
// invitationToken / companyId — mass-assignment guard for the store-user update path.
export class StoreUserUpdateInputDTO {
  firstName?: string;
  lastName?: string;
  email?: string;
  isActive?: boolean;

  constructor(data: any) {
    if (data.firstName !== undefined) this.firstName = data.firstName;
    if (data.lastName !== undefined) this.lastName = data.lastName;
    if (data.email !== undefined) this.email = data.email;
    if (data.isActive !== undefined) this.isActive = data.isActive;
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
