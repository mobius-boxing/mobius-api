import { ICompany } from "../company/company.interfaces";

export interface IUser {
  id?: number;
  uuid?: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: "member" | "admin" | "superAdmin";
  companyId?: number;
  isActive?: boolean;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  company?: ICompany;
}

export interface IUserWithCompany extends Omit<IUser, "password"> {
  company: ICompany;
}
