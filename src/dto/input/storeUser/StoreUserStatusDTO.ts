export class StoreUserStatusDTO {
  isActive: boolean;

  constructor(data: any) {
    this.isActive = data.isActive;
  }

  public build(): this {
    return this;
  }
}
