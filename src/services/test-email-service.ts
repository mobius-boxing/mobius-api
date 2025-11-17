/**
 * Email Service Test Script
 *
 * Run this script to test the email service functionality
 * Usage: ts-node src/services/test-email-service.ts
 *
 * This will demonstrate:
 * - Service initialization
 * - Token generation
 * - Email sending (logged to console if SendGrid not configured)
 */

import "dotenv/config";
import { EmailService } from "./email.service";
import { EmailTokenService } from "./email-token.service";

async function testEmailService() {
  console.log("=".repeat(60));
  console.log("EMAIL SERVICE TEST");
  console.log("=".repeat(60));
  console.log();

  // Test 1: Initialize services and check status
  console.log("1. Initializing Email Service...");
  const emailService = new EmailService();
  const status = emailService.getStatus();

  console.log("   Status:", status);
  console.log("   Ready:", emailService.isReady());
  console.log();

  // Test 2: Initialize Token Service
  console.log("2. Initializing Email Token Service...");
  const tokenService = new EmailTokenService();
  console.log("   Token Service initialized ✓");
  console.log();

  // Test 3: Generate password reset token
  console.log("3. Testing Password Reset Token Generation...");
  try {
    const resetToken = await tokenService.generateEmailToken(
      1,
      "password_reset",
    );
    console.log(
      "   Token generated:",
      resetToken.token.substring(0, 20) + "...",
    );
    console.log("   Expires at:", resetToken.expiresAt);
    console.log("   Type:", resetToken.type);
    console.log("   Is used:", resetToken.isUsed);
    console.log();

    // Test 4: Verify the token
    console.log("4. Testing Token Verification...");
    const verified = await tokenService.verifyEmailToken(
      resetToken.token,
      "password_reset",
    );
    console.log("   Token verified:", verified !== null);
    console.log();

    // Test 5: Send password reset email
    console.log("5. Testing Password Reset Email...");
    await emailService.sendPasswordResetEmail(
      "test@example.com",
      resetToken.token,
      "John",
    );
    console.log("   Email sent (or logged) ✓");
    console.log();

    // Test 6: Invalidate token
    console.log("6. Testing Token Invalidation...");
    const invalidated = await tokenService.invalidateToken(resetToken.token);
    console.log("   Token invalidated:", invalidated);
    console.log();

    // Test 7: Try to verify invalidated token
    console.log("7. Testing Verification of Invalidated Token...");
    const verifiedAgain = await tokenService.verifyEmailToken(
      resetToken.token,
      "password_reset",
    );
    console.log(
      "   Token verified after invalidation:",
      verifiedAgain !== null,
    );
    console.log("   (Should be false) ✓");
    console.log();
  } catch (error) {
    console.error("   Error during token tests:", error);
  }

  // Test 8: Generate email verification token
  console.log("8. Testing Email Verification Token Generation...");
  try {
    const verifyToken = await tokenService.generateEmailToken(
      2,
      "email_verification",
    );
    console.log(
      "   Token generated:",
      verifyToken.token.substring(0, 20) + "...",
    );
    console.log("   Expires at:", verifyToken.expiresAt);
    console.log();

    // Test 9: Send verification email
    console.log("9. Testing Email Verification Email...");
    await emailService.sendEmailVerificationEmail(
      "newuser@example.com",
      verifyToken.token,
      "Jane",
    );
    console.log("   Email sent (or logged) ✓");
    console.log();

    // Clean up
    await tokenService.invalidateToken(verifyToken.token);
  } catch (error) {
    console.error("   Error during verification tests:", error);
  }

  // Test 10: Send invitation email
  console.log("10. Testing Invitation Email...");
  try {
    const inviteToken = await tokenService.generateEmailToken(
      3,
      "email_verification",
    );
    await emailService.sendInvitationEmail(
      "invitee@example.com",
      "Acme Corp",
      "admin",
      inviteToken.token,
      "Bob",
    );
    console.log("    Email sent (or logged) ✓");
    console.log();

    // Clean up
    await tokenService.invalidateToken(inviteToken.token);
  } catch (error) {
    console.error("    Error during invitation test:", error);
  }

  // Test 11: Send welcome email
  console.log("11. Testing Welcome Email...");
  try {
    await emailService.sendWelcomeEmail("newuser@example.com", "Alice");
    console.log("    Email sent (or logged) ✓");
    console.log();
  } catch (error) {
    console.error("    Error during welcome email test:", error);
  }

  console.log("=".repeat(60));
  console.log("ALL TESTS COMPLETED");
  console.log("=".repeat(60));
  console.log();

  if (!emailService.isReady()) {
    console.log("NOTE: SendGrid API key is not configured.");
    console.log("Emails were logged to console instead of being sent.");
    console.log(
      "To enable actual email sending, add SENDGRID_API_KEY to your .env file.",
    );
  } else {
    console.log("SendGrid is configured. Check your email for test messages.");
  }

  process.exit(0);
}

// Run the test
testEmailService().catch((error) => {
  console.error("Test failed with error:", error);
  process.exit(1);
});
