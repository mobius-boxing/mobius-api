export interface ISupplier {
  id?: number;
  uuid?: string;
  code: string;
  suppliesSheets?: boolean;
  suppliesElaborated?: boolean;
  suppliesConsumables?: boolean;
  suppliesPaper?: boolean;
  suppliesTooling?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
