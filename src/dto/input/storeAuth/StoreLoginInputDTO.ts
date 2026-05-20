// Mirrors LoginInputDTO. Validated by inputValidator (@sundaysf/utils) in the controller.
export class StoreLoginInputDTO {
  email: string;
  password: string;

  constructor(data: any) {
    this.email = data.email;
    this.password = data.password;
  }

  public build(): this {
    return this;
  }
}
