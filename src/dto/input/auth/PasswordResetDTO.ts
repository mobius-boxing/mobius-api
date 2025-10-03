export class PasswordResetDTO {
    token: string;
    newPassword: string;

    constructor(data: any) {
        this.token = data.token;
        this.newPassword = data.newPassword;
    }

    public build(): this {
        return this;
    }
}
