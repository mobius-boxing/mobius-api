import { ICustomer } from "../customer/customer.interfaces";

export interface IProduct {
  id?: number;
  uuid?: string;
  companyId: number;
  code: string;
  clientCode?: string;
  description?: string;
  customerId?: number;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  customer?: ICustomer;
}
