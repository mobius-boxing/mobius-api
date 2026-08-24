export class CustomerUpdateInputDTO {
  companyId?: number;
  customerUuid?: string;
  name?: string;
  code?: string;
  dispatchable?: boolean;
  notes?: string;
  excludeLogoOnLabels?: boolean;
  requiresQualityCertificate?: boolean;
  supplierCode?: string;
  salesPersonId?: number;
  categoryId?: number;
  legalName?: string;
  legalCode?: string;
  address?: string;
  tradeName?: string;
  contacts?: any;

  constructor(data: any) {
    if (data.companyId !== undefined)
      this.companyId =
        typeof data.companyId === "string"
          ? parseInt(data.companyId, 10)
          : data.companyId;
    if (data.customerUuid !== undefined) this.customerUuid = data.customerUuid;
    if (data.name !== undefined) this.name = data.name;
    if (data.code !== undefined) this.code = data.code;
    if (data.dispatchable !== undefined) this.dispatchable = data.dispatchable === true;
    if (data.notes !== undefined) this.notes = data.notes;
    if (data.excludeLogoOnLabels !== undefined) this.excludeLogoOnLabels = data.excludeLogoOnLabels === true;
    if (data.requiresQualityCertificate !== undefined) this.requiresQualityCertificate = data.requiresQualityCertificate === true;
    if (data.supplierCode !== undefined) this.supplierCode = data.supplierCode;
    if (data.salesPersonId !== undefined)
      this.salesPersonId =
        typeof data.salesPersonId === "string"
          ? parseInt(data.salesPersonId, 10)
          : data.salesPersonId;
    if (data.categoryId !== undefined)
      this.categoryId =
        typeof data.categoryId === "string"
          ? parseInt(data.categoryId, 10)
          : data.categoryId;
    if (data.legalName !== undefined) this.legalName = data.legalName;
    if (data.legalCode !== undefined) this.legalCode = data.legalCode;
    if (data.address !== undefined) this.address = data.address;
    if (data.tradeName !== undefined) this.tradeName = data.tradeName;
    if (data.contacts !== undefined) this.contacts = data.contacts;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
