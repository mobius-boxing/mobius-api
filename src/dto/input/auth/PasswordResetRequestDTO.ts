export class PasswordResetRequestDTO {
    email: string;

    constructor(data: any) {
        this.email = data.email;
    }

    public build(): this {
        return this;
    }
}
