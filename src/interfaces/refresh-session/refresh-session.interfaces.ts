export type RefreshRevokedReason =
  | "logout"
  | "reuse"
  | "password_change"
  | "password_reset"
  | "user_deactivated"
  | "device_revoked"
  | "admin";

/** 1:1 projection of `refresh_sessions` (DAO shape). Never leaves the API. */
export interface IRefreshSession {
  id: number;
  uuid: string;
  userId: number;
  deviceId: number | null;
  tokenHash: string;
  previousTokenHash: string | null;
  rotatedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: RefreshRevokedReason | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What one refresh attempt resolved to. `rawToken` is present only on `rotated`:
 * the grace path must not set a cookie (the browser already holds the newer one).
 */
export type RefreshOutcome =
  | { kind: "rotated"; session: IRefreshSession; rawToken: string }
  | { kind: "grace"; session: IRefreshSession }
  | { kind: "invalid" }
  | { kind: "revoked"; session: IRefreshSession };
