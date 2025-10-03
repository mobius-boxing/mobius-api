export class CustomerUpdateInputDTO {
    companyId?: number;
    customerUuid?: string;
    name?: string;
    supplierCode?: string;
    salesPersonId?: number;
    categoryId?: number;
    legalName?: string;
    address?: string;
    tradeName?: string;
    contacts?: any;
    deliveryLocations?: any;
    deliveryDays?: any;

    constructor(data: any) {
        if (data.companyId !== undefined) this.companyId = data.companyId;
        if (data.customerUuid !== undefined) this.customerUuid = data.customerUuid;
        if (data.name !== undefined) this.name = data.name;
        if (data.supplierCode !== undefined) this.supplierCode = data.supplierCode;
        if (data.salesPersonId !== undefined) this.salesPersonId = data.salesPersonId;
        if (data.categoryId !== undefined) this.categoryId = data.categoryId;
        if (data.legalName !== undefined) this.legalName = data.legalName;
        if (data.address !== undefined) this.address = data.address;
        if (data.tradeName !== undefined) this.tradeName = data.tradeName;
        if (data.contacts !== undefined) this.contacts = data.contacts;
        if (data.deliveryLocations !== undefined) this.deliveryLocations = data.deliveryLocations;
        if (data.deliveryDays !== undefined) this.deliveryDays = data.deliveryDays;
    }

    public build(): this {
        Object.keys(this).forEach(key => {
            if (this[key as keyof this] === undefined) {
                delete this[key as keyof this];
            }
        });
        return this;
    }
}
