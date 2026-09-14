export type UserDeviceStatus = "pending" | "approved" | "revoked";

/** 1:1 projection of `user_devices` (DAO shape). */
export interface IUserDevice {
  id?: number;
  uuid?: string;
  userId: number;
  tokenHash: string;
  status: UserDeviceStatus;
  userAgent: string | null;
  requestIp: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  approvedBy: number | null;
  revokedAt: Date | null;
  revokedBy: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUserRef {
  uuid: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Admin list/approve/revoke wire shape — `IUserDevice` minus
 * id/userId/tokenHash/FK ints, plus the three refs.
 */
export interface IUserDeviceView {
  uuid: string;
  status: UserDeviceStatus;
  userAgent: string | null;
  requestIp: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: IUserRef;
  approvedBy: IUserRef | null;
  revokedBy: IUserRef | null;
}

/** What a user learns about their own device (login / me / device). `token` only on issuance. */
export interface IDeviceSession {
  uuid: string;
  status: UserDeviceStatus;
  requestedAt: Date;
  approvedAt: Date | null;
  revokedAt: Date | null;
  token?: string;
}
