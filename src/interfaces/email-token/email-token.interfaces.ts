import { IUser } from "../user/user.interfaces";

export interface IEmailToken {
  id?: number;
  uuid?: string;
  userId: number;
  token: string;
  type: "email_verification" | "password_reset";
  expiresAt: Date;
  isUsed?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  user?: IUser;
}
