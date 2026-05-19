import { IWarehouse } from "../warehouse/warehouse.interfaces";
import { IWarehouseLocation } from "../warehouseLocation/warehouseLocation.interfaces";
import { ISupplier } from "../supplier/supplier.interfaces";
import { IManufacturer } from "../manufacturer/manufacturer.interfaces";
import { IConsumableSupply } from "../consumable-supply/consumable-supply.interfaces";

export interface IConsumableStock {
  id?: number;
  uuid?: string;
  warehouseId: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  consumableSupplyId: number;
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
  consumableSupply?: IConsumableSupply;
}
