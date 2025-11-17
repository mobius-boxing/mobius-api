export class InvitationCreateInputDTO {
  email: string;
  role: string;
  companyId: number;
  invitedBy: number;

  constructor(data: any) {
    this.email = data.email;
    this.role = data.role;
    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : data.companyId;
    this.invitedBy =
      typeof data.invitedBy === "string"
        ? parseInt(data.invitedBy, 10)
        : data.invitedBy;
  }

  public build(): this {
    return this;
  }
}
