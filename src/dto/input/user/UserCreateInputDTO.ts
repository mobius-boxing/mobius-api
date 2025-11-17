export class UserCreateInputDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  companyId?: number;

  constructor(data: any) {
    this.email = data.email;
    this.password = data.password;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.role = data.role;
    if (data.companyId !== undefined)
      this.companyId =
        typeof data.companyId === "string"
          ? parseInt(data.companyId, 10)
          : data.companyId;
  }

  public build(): this {
    return this;
  }
}
