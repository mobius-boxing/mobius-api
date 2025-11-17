export class RegisterInputDTO {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  invitationToken: string;

  constructor(data: any) {
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.email = data.email;
    this.password = data.password;
    this.invitationToken = data.invitationToken;
  }

  public build(): this {
    return this;
  }
}
