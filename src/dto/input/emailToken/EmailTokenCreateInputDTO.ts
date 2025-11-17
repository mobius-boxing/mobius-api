export class EmailTokenCreateInputDTO {
  userId: number;
  token: string;
  type: string;
  expiresAt: Date;

  constructor(data: any) {
    this.userId = data.userId;
    this.token = data.token;
    this.type = data.type;
    this.expiresAt = data.expiresAt;
  }

  public build(): this {
    return this;
  }
}
