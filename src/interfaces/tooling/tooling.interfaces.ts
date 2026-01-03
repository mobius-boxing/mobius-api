import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { IToolingType } from "../tooling-type/tooling-type.interfaces";

export interface ITooling {
  id?: number;
  uuid?: string;
  name: string;
  description?: string;
  manufacturerId?: number;
  supplierId?: number;
  minimumStock?: number;
  toolingTypeId?: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  manufacturer?: IManufacturer;
  supplier?: ISupplier;
  toolingType?: IToolingType;
}
