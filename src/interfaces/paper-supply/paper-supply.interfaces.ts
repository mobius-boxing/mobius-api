import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { ICompany } from "../company/company.interfaces";
import { IPaperType } from "../paper-type/paper-type.interfaces";

/**
 * Corrected shape (§L.3): Procusto paper StockMinimo is a CantidadBobina —
 * weight (kg) + diameter (mm). Values stored before the 20260720000001
 * migration are preserved under `legacy`.
 */
export interface IMinimumStock {
  weightKg?: number | null;
  diameterMm?: number | null;
  legacy?: { pallets?: number; boxes?: number } | null;
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
  /** Free text — Procusto Papel.Color is NOT a FK (unlike consumables). */
  color?: string;
  fscTypeId?: number | null;
  minimumStock?: IMinimumStock;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  manufacturer?: IManufacturer;
  supplier?: ISupplier;
  company?: ICompany;
  paperType?: IPaperType;
  fscType?: { uuid: string; code?: string | null; description?: string | null } | null;
}
