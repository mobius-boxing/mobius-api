import { ICustomer } from "../customer/customer.interfaces";
import { IProductType } from "../product-type/product-type.interfaces";
import { IBoxType } from "../box-type/box-type.interfaces";

export interface IProduct {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  clientCode?: string;
  description?: string;
  customerId?: number;
  revision?: number;
  vip?: boolean;
  productTypeId?: number | null;
  boxTypeId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  customer?: ICustomer;
  productType?: IProductType;
  boxType?: IBoxType;
}
