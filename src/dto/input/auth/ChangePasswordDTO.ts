export class ChangePasswordDTO {
  currentPassword: string;
  newPassword: string;

  constructor(data: any) {
    this.currentPassword = data.currentPassword;
    this.newPassword = data.newPassword;
  }

  public build(): this {
    return this;
  }
}
