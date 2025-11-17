export class UserUpdateInputDTO {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  companyId?: number;
  isActive?: boolean;
  emailVerified?: boolean;

  constructor(data: any) {
    if (data.email !== undefined) this.email = data.email;
    if (data.password !== undefined) this.password = data.password;
    if (data.firstName !== undefined) this.firstName = data.firstName;
    if (data.lastName !== undefined) this.lastName = data.lastName;
    if (data.role !== undefined) this.role = data.role;
    if (data.companyId !== undefined)
      this.companyId =
        typeof data.companyId === "string"
          ? parseInt(data.companyId, 10)
          : data.companyId;
    if (data.isActive !== undefined) this.isActive = data.isActive;
    if (data.emailVerified !== undefined)
      this.emailVerified = data.emailVerified;
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
