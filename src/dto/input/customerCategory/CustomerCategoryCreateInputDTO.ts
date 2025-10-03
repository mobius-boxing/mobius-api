export class CustomerCategoryCreateInputDTO {
    customerCategoryUuid: string;
    name: string;
    companyId: number;

    constructor(data: any) {
        this.customerCategoryUuid = data.customerCategoryUuid;
        this.name = data.name;
        this.companyId = data.companyId;
    }

    public build(): this {
        return this;
    }
}
