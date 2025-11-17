export class SupplierUpdateInputDTO {
  code?: string;
  suppliesSheets?: boolean;
  suppliesElaborated?: boolean;
  suppliesConsumables?: boolean;
  suppliesPaper?: boolean;
  suppliesTooling?: boolean;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.suppliesSheets !== undefined)
      this.suppliesSheets = data.suppliesSheets;
    if (data.suppliesElaborated !== undefined)
      this.suppliesElaborated = data.suppliesElaborated;
    if (data.suppliesConsumables !== undefined)
      this.suppliesConsumables = data.suppliesConsumables;
    if (data.suppliesPaper !== undefined)
      this.suppliesPaper = data.suppliesPaper;
    if (data.suppliesTooling !== undefined)
      this.suppliesTooling = data.suppliesTooling;
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
