import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { ICompany } from "../company/company.interfaces";

export interface IMinimumStock {
  pallets: number;
  boxes: number;
}

export interface IPaperSupply {
  id?: number;
  uuid?: string;
  companyId: number;
  code: string;
  description?: string;
  name?: string;
  manufacturerId?: number;
  supplierId?: number;
  minimumStock?: IMinimumStock;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  manufacturer?: IManufacturer;
  supplier?: ISupplier;
  company?: ICompany;
}
