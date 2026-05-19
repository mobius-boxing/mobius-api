import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { ICorrugation } from "../corrugation/corrugation.interfaces";

export interface IPaperSheet {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  name: string;
  description?: string;
  supplierId?: number;
  manufacturerId?: number;
  corrugationId?: number;
  minimumStock?: number;
  length?: number;
  width?: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  supplier?: ISupplier;
  manufacturer?: IManufacturer;
  corrugation?: ICorrugation;
}
