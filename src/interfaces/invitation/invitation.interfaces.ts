import { ICompany } from "../company/company.interfaces";
import { IUser } from "../user/user.interfaces";

export interface IInvitation {
  id?: number;
  uuid?: string;
  email: string;
  token: string;
  role: "member" | "admin" | "superAdmin";
  companyId?: number;
  invitedBy: number;
  expiresAt: Date;
  acceptedAt?: Date;
  isUsed?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  company?: ICompany;
  inviter?: IUser;
}
