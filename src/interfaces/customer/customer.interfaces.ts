import { ICompany } from "../company/company.interfaces";
import { ICustomerCategory } from "../customer-category/customer-category.interfaces";
import { IUser } from "../user/user.interfaces";

export interface IContactInfo {
  name: string;
  position?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface IDeliveryLocation {
  name: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  contactName?: string;
  instructions?: string;
  isDefault?: boolean;
}

export interface IDeliveryDay {
  day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";
  timeWindow?: string;
  notes?: string;
}

export interface ICustomer {
  id?: number;
  uuid?: string;
  companyId: number;
  name: string;
  supplierCode?: string;
  salesPersonId?: number;
  categoryId?: number;
  active?: boolean;
  legalName?: string;
  legalCode?: string;
  address?: string;
  tradeName?: string;
  contacts?: IContactInfo[];
  deliveryLocations?: IDeliveryLocation[];
  deliveryDays?: IDeliveryDay[];
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  company?: ICompany;
  category?: ICustomerCategory;
  salesPerson?: IUser;
}
