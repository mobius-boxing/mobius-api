import { ISupplier } from "../supplier/supplier.interfaces";
import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { IConsumableType } from "../consumable-type/consumable-type.interfaces";

export interface IConsumableSupply {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  name: string;
  description?: string;
  supplierId?: number;
  manufacturerId?: number;
  consumableTypeId?: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  supplier?: ISupplier;
  manufacturer?: IManufacturer;
  consumableType?: IConsumableType;
}
