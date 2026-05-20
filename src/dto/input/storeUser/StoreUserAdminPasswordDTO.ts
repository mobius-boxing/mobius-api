export class StoreUserAdminPasswordDTO {
  password: string;

  constructor(data: any) {
    this.password = data.password;
  }

  public build(): this {
    return this;
  }
}
