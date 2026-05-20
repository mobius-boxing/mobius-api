// NOTE: companyId is intentionally NOT a field here. For non-superAdmin it comes
// from the JWT via getCompanyForCreate; for superAdmin it is read directly from
// the request body by getCompanyForCreate (not whitelisted onto the DTO).
export class StoreUserCreateInputDTO {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;

  constructor(data: any) {
    this.email = data.email;
    if (data.firstName !== undefined) this.firstName = data.firstName;
    if (data.lastName !== undefined) this.lastName = data.lastName;
    if (data.password !== undefined) this.password = data.password;
  }

  public build(): this {
    return this;
  }
}
