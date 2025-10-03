export class LoginInputDTO {
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
