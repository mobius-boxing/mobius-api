import { ICompany } from "../company/company.interfaces";
import { IUser } from "../user/user.interfaces";

export interface IInvitation {
  id?: number;
  uuid?: string;
  email: string;
  // SECURITY (C4): the raw token is sensitive. It is set on create and on internal token lookups,
  // but stripped from list / single-record responses returned to clients (see InvitationDAO).
  token?: string;
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
