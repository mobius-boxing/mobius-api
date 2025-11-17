import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { EmailTokenDAO } from "../dao/email-token/email-token.dao";
import { IEmailToken } from "../interfaces/email-token/email-token.interfaces";

export class EmailTokenService {
  private emailTokenDAO: EmailTokenDAO;

  constructor() {
    this.emailTokenDAO = new EmailTokenDAO();
  }

  /**
   * Generate a cryptographically secure random token
   * @returns Hex string token (32 bytes = 64 characters)
   */
  private generateSecureToken(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Generate and save an email token
   * @param userId - User ID to associate with the token
   * @param type - Type of token (email_verification or password_reset)
   * @returns Generated token record with token string
   */
  public async generateEmailToken(
    userId: number,
    type: "email_verification" | "password_reset",
  ): Promise<IEmailToken> {
    try {
      // Generate secure random token
      const tokenString = this.generateSecureToken();

      // Calculate expiry time based on type
      const expiresAt = new Date();
      if (type === "password_reset") {
        // 24 hours for password reset
        expiresAt.setHours(expiresAt.getHours() + 24);
      } else if (type === "email_verification") {
        // 48 hours for email verification
        expiresAt.setHours(expiresAt.getHours() + 48);
      }

      // Create token record
      const tokenData: IEmailToken = {
        uuid: uuidv4(),
        userId,
        token: tokenString,
        type,
        expiresAt,
        isUsed: false,
      };

      // Save to database
      const createdToken = await this.emailTokenDAO.create(tokenData);

      return createdToken;
    } catch (error) {
      console.error("Error generating email token:", error);
      throw new Error("Failed to generate email token");
    }
  }

  /**
   * Verify an email token is valid and not expired
   * @param tokenString - Token string to verify
   * @param type - Expected token type
   * @returns Token record if valid, null if invalid or expired
   */
  public async verifyEmailToken(
    tokenString: string,
    type: "email_verification" | "password_reset",
  ): Promise<IEmailToken | null> {
    try {
      // Get token from database
      const token = await this.emailTokenDAO.getByToken(tokenString);

      if (!token) {
        console.warn("Token not found:", tokenString);
        return null;
      }

      // Verify token type matches
      if (token.type !== type) {
        console.warn(
          "Token type mismatch. Expected:",
          type,
          "Got:",
          token.type,
        );
        return null;
      }

      // Check if token is already used
      if (token.isUsed) {
        console.warn("Token already used:", tokenString);
        return null;
      }

      // Check if token is expired
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

  /**
   * Mark a token as used (invalidate it)
   * @param tokenString - Token string to invalidate
   * @returns True if successful, false if token not found
   */
  public async invalidateToken(tokenString: string): Promise<boolean> {
    try {
      const token = await this.emailTokenDAO.getByToken(tokenString);

      if (!token || !token.id) {
        console.warn("Token not found for invalidation:", tokenString);
        return false;
      }

      // Mark as used
      await this.emailTokenDAO.update(token.id, { isUsed: true });

      return true;
    } catch (error) {
      console.error("Error invalidating token:", error);
      throw new Error("Failed to invalidate token");
    }
  }

  /**
   * Get a valid (unused and not expired) token for a user
   * @param userId - User ID
   * @param type - Token type
   * @returns Valid token if exists, null otherwise
   */
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

  /**
   * Invalidate all tokens of a specific type for a user
   * Useful when generating a new token to invalidate old ones
   * @param userId - User ID
   * @param type - Token type
   */
  public async invalidateAllUserTokens(
    userId: number,
    type: "email_verification" | "password_reset",
  ): Promise<void> {
    try {
      // This would require a custom DAO method to invalidate multiple tokens
      // For now, we'll just get the valid token and invalidate it
      const validToken = await this.getValidTokenForUser(userId, type);

      if (validToken && validToken.token) {
        await this.invalidateToken(validToken.token);
      }
    } catch (error) {
      console.error("Error invalidating user tokens:", error);
      // Don't throw - this is a cleanup operation
    }
  }

  /**
   * Clean up expired tokens from the database
   * Should be called periodically (e.g., daily cron job)
   * @returns Number of tokens deleted
   */
  public async cleanupExpiredTokens(): Promise<number> {
    try {
      // This would require a custom DAO method
      // For now, return 0 as placeholder
      console.log("Cleanup expired tokens - Not implemented yet");
      return 0;
    } catch (error) {
      console.error("Error cleaning up expired tokens:", error);
      return 0;
    }
  }
}
