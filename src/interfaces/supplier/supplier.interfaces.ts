export interface ISupplier {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  suppliesSheets?: boolean;
  suppliesElaborated?: boolean;
  suppliesConsumables?: boolean;
  suppliesPaper?: boolean;
  suppliesTooling?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
