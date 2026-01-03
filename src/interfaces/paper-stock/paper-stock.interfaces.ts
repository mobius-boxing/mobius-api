import { IWarehouse } from "../warehouse/warehouse.interfaces";
import { IWarehouseLocation } from "../warehouseLocation/warehouseLocation.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { IPaperSupply } from "../paper-supply/paper-supply.interfaces";

export interface IPaperStock {
  id?: number;
  uuid?: string;
  warehouseId: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  paperSupplyId: number;
  comments?: string;
  price?: number;
  weight?: number;
  diameter?: number;
  width?: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  warehouse?: IWarehouse;
  warehouseLocation?: IWarehouseLocation;
  supplier?: ISupplier;
  manufacturer?: IManufacturer;
  paperSupply?: IPaperSupply;
}
