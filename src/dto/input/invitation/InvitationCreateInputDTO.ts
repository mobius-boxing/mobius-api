export class InvitationCreateInputDTO {
    email: string;
    role: string;
    companyId: number;
    invitedBy: number;

    constructor(data: any) {
        this.email = data.email;
        this.role = data.role;
        this.companyId = data.companyId;
        this.invitedBy = data.invitedBy;
    }

    public build(): this {
        return this;
    }
}
