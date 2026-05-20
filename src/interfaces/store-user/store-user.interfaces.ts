// passwordHash is intentionally NOT part of the public interface returned to clients.
// It exists only as an internal DB column; mapToInterface omits it (see UserDAO password-strip).
export interface IStoreUser {
  id?: number;
  uuid?: string;
  companyId?: number;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean;
  emailVerified?: boolean;
  invitationExpiresAt?: Date | null;
  invitedBy?: number | null;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  // NOTE: passwordHash and invitationToken are deliberately excluded from this
  // public interface. They are written via dedicated DAO methods (setPassword /
  // setInvitation) and never surfaced through mapToInterface.
}

// Optional internal shape for create / internal auth flows that DO carry secrets.
// Used only inside the DAO / auth service, never serialized to the client.
export interface IStoreUserInternal extends IStoreUser {
  passwordHash?: string | null;
  invitationToken?: string | null;
}
