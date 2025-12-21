import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { ICompany } from "../company/company.interfaces";
import { IPaperType } from "../paper-type/paper-type.interfaces";

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
  paperTypeId?: number;
  grammage?: number;
  price?: number;
  minimumStock?: IMinimumStock;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  manufacturer?: IManufacturer;
  supplier?: ISupplier;
  company?: ICompany;
  paperType?: IPaperType;
}
