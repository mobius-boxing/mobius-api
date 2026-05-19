import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { EmailTokenDAO } from "../dao/email-token/email-token.dao";
import { IEmailToken } from "../interfaces/email-token/email-token.interfaces";

export class EmailTokenService {
  private emailTokenDAO: EmailTokenDAO;

  constructor() {
    this.emailTokenDAO = new EmailTokenDAO();
  }

  // 32 bytes → 64-char hex; used as the user-facing token in links.
  private generateSecureToken(): string {
    return randomBytes(32).toString("hex");
  }

  public async generateEmailToken(
    userId: number,
    type: "email_verification" | "password_reset",
  ): Promise<IEmailToken> {
    try {
      const tokenString = this.generateSecureToken();

      // Expiry differs by purpose: password resets are short-lived, verification links are not.
      const expiresAt = new Date();
      if (type === "password_reset") {
        expiresAt.setHours(expiresAt.getHours() + 24);
      } else if (type === "email_verification") {
        expiresAt.setHours(expiresAt.getHours() + 48);
      }

      const tokenData: IEmailToken = {
        uuid: uuidv4(),
        userId,
        token: tokenString,
        type,
        expiresAt,
        isUsed: false,
      };

      const createdToken = await this.emailTokenDAO.create(tokenData);

      return createdToken;
    } catch (error) {
      console.error("Error generating email token:", error);
      throw new Error("Failed to generate email token");
    }
  }

  public async verifyEmailToken(
    tokenString: string,
    type: "email_verification" | "password_reset",
  ): Promise<IEmailToken | null> {
    try {
      const token = await this.emailTokenDAO.getByToken(tokenString);

      if (!token) {
        console.warn("Token not found:", tokenString);
        return null;
      }

      if (token.type !== type) {
        console.warn(
          "Token type mismatch. Expected:",
          type,
          "Got:",
          token.type,
        );
        return null;
      }

      if (token.isUsed) {
        console.warn("Token already used:", tokenString);
        return null;
      }

      const now = new Date();
      if (token.expiresAt && new Date(token.expiresAt) < now) {
        console.warn("Token expired:", tokenString, "Expiry:", token.expiresAt);
        return null;
      }

      return token;
    } catch (error) {
      console.error("Error verifying email token:", error);
      throw new Error("Failed to verify email token");
    }
  }

  public async invalidateToken(tokenString: string): Promise<boolean> {
    try {
      const token = await this.emailTokenDAO.getByToken(tokenString);

      if (!token || !token.id) {
        console.warn("Token not found for invalidation:", tokenString);
        return false;
      }

      await this.emailTokenDAO.update(token.id, { isUsed: true });

      return true;
    } catch (error) {
      console.error("Error invalidating token:", error);
      throw new Error("Failed to invalidate token");
    }
  }

  public async getValidTokenForUser(
    userId: number,
    type: "email_verification" | "password_reset",
  ): Promise<IEmailToken | null> {
    try {
      return await this.emailTokenDAO.getValidToken(userId, type);
    } catch (error) {
      console.error("Error getting valid token:", error);
      throw new Error("Failed to get valid token");
    }
  }

  // TODO: needs a DAO method that invalidates all tokens for (userId, type) in one query.
  // Currently this only invalidates the most-recent valid token, leaving older ones intact.
  public async invalidateAllUserTokens(
    userId: number,
    type: "email_verification" | "password_reset",
  ): Promise<void> {
    try {
      const validToken = await this.getValidTokenForUser(userId, type);

      if (validToken && validToken.token) {
        await this.invalidateToken(validToken.token);
      }
    } catch (error) {
      console.error("Error invalidating user tokens:", error);
      // Cleanup helper — swallow errors so callers don't fail because of stale tokens.
    }
  }

  // TODO: intended to be called from a periodic job; not implemented yet.
  public async cleanupExpiredTokens(): Promise<number> {
    try {
      console.log("Cleanup expired tokens - Not implemented yet");
      return 0;
    } catch (error) {
      console.error("Error cleaning up expired tokens:", error);
      return 0;
    }
  }
}
