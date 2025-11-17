export class SupplierCreateInputDTO {
  code: string;
  suppliesSheets?: boolean;
  suppliesElaborated?: boolean;
  suppliesConsumables?: boolean;
  suppliesPaper?: boolean;
  suppliesTooling?: boolean;

  constructor(data: any) {
    this.code = data.code;
    this.suppliesSheets = data.suppliesSheets ?? false;
    this.suppliesElaborated = data.suppliesElaborated ?? false;
    this.suppliesConsumables = data.suppliesConsumables ?? false;
    this.suppliesPaper = data.suppliesPaper ?? false;
    this.suppliesTooling = data.suppliesTooling ?? false;
  }

  public build(): this {
    return this;
  }
}
