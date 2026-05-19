import { IWarehouse } from "../warehouse/warehouse.interfaces";
import { IWarehouseLocation } from "../warehouseLocation/warehouseLocation.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { ITooling } from "../tooling/tooling.interfaces";

export interface IToolingStock {
  id?: number;
  uuid?: string;
  warehouseId: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  toolingId: number;
  comments?: string;
  price?: number;
  quantity: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  warehouse?: IWarehouse;
  warehouseLocation?: IWarehouseLocation;
  supplier?: ISupplier;
  manufacturer?: IManufacturer;
  tooling?: ITooling;
}
