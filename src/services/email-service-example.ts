/**
 * Email Service Usage Examples
 *
 * This file contains practical examples of how to use the EmailService
 * and EmailTokenService in your controllers and routes.
 *
 * DO NOT IMPORT THIS FILE IN PRODUCTION CODE - It's for reference only
 */

import { EmailService } from './email.service';
import { EmailTokenService } from './email-token.service';
import { UserDAO } from '../dao/user/user.dao';

/**
 * Example 1: Password Reset Flow
 */
export async function examplePasswordResetFlow(userEmail: string): Promise<void> {
  try {
    // 1. Find user by email
    const userDAO = new UserDAO();
    const user = await userDAO.getByEmail(userEmail);

    if (!user || !user.id) {
      throw new Error('User not found');
    }

    // 2. Generate password reset token (expires in 24h)
    const tokenService = new EmailTokenService();
    const tokenRecord = await tokenService.generateEmailToken(
      user.id,
      'password_reset'
    );

    // 3. Send password reset email
    const emailService = new EmailService();
    await emailService.sendPasswordResetEmail(
      user.email,
      tokenRecord.token,
      user.firstName
    );

    console.log('Password reset email sent successfully');
  } catch (error) {
    console.error('Error in password reset flow:', error);
    throw error;
  }
}

/**
 * Example 2: Verify Password Reset Token and Update Password
 */
export async function exampleVerifyResetToken(
  tokenString: string,
  newPassword: string
): Promise<void> {
  try {
    // 1. Verify the token is valid
    const tokenService = new EmailTokenService();
    const verifiedToken = await tokenService.verifyEmailToken(
      tokenString,
      'password_reset'
    );

    if (!verifiedToken) {
      throw new Error('Invalid or expired token');
    }

    // 2. Update user password (hash it first in real code!)
    const userDAO = new UserDAO();
    await userDAO.update(verifiedToken.userId, {
      password: newPassword, // Should be hashed with bcrypt
    });

    // 3. Invalidate the token so it can't be used again
    await tokenService.invalidateToken(tokenString);

    console.log('Password updated successfully');
  } catch (error) {
    console.error('Error verifying reset token:', error);
    throw error;
  }
}

/**
 * Example 3: Email Verification Flow for New User
 */
export async function exampleEmailVerificationFlow(
  userEmail: string
): Promise<void> {
  try {
    // 1. Find user
    const userDAO = new UserDAO();
    const user = await userDAO.getByEmail(userEmail);

    if (!user || !user.id) {
      throw new Error('User not found');
    }

    // 2. Check if email is already verified
    if (user.emailVerified) {
      console.log('Email already verified');
      return;
    }

    // 3. Generate verification token (expires in 48h)
    const tokenService = new EmailTokenService();
    const tokenRecord = await tokenService.generateEmailToken(
      user.id,
      'email_verification'
    );

    // 4. Send verification email
    const emailService = new EmailService();
    await emailService.sendEmailVerificationEmail(
      user.email,
      tokenRecord.token,
      user.firstName
    );

    console.log('Verification email sent successfully');
  } catch (error) {
    console.error('Error in email verification flow:', error);
    throw error;
  }
}

/**
 * Example 4: Process Email Verification Token
 */
export async function exampleProcessVerificationToken(
  tokenString: string
): Promise<void> {
  try {
    // 1. Verify the token
    const tokenService = new EmailTokenService();
    const verifiedToken = await tokenService.verifyEmailToken(
      tokenString,
      'email_verification'
    );

    if (!verifiedToken) {
      throw new Error('Invalid or expired token');
    }

    // 2. Mark email as verified
    const userDAO = new UserDAO();
    await userDAO.update(verifiedToken.userId, {
      emailVerified: true,
    });

    // 3. Invalidate the token
    await tokenService.invalidateToken(tokenString);

    console.log('Email verified successfully');
  } catch (error) {
    console.error('Error processing verification token:', error);
    throw error;
  }
}

/**
 * Example 5: Send User Invitation Email
 */
export async function exampleSendInvitation(
  inviteeEmail: string,
  companyName: string,
  role: 'member' | 'admin',
  firstName?: string
): Promise<void> {
  try {
    // In a real scenario, you'd create a user record first and get their ID
    // For this example, assume userId = 1
    const userId = 1;

    // 1. Generate invitation token (reuse email_verification type or create new type)
    const tokenService = new EmailTokenService();
    const tokenRecord = await tokenService.generateEmailToken(
      userId,
      'email_verification'
    );

    // 2. Send invitation email
    const emailService = new EmailService();
    await emailService.sendInvitationEmail(
      inviteeEmail,
      companyName,
      role,
      tokenRecord.token,
      firstName
    );

    console.log('Invitation email sent successfully');
  } catch (error) {
    console.error('Error sending invitation:', error);
    throw error;
  }
}

/**
 * Example 6: Send Welcome Email After Registration
 */
export async function exampleSendWelcomeEmail(
  userEmail: string,
  firstName: string
): Promise<void> {
  try {
    const emailService = new EmailService();
    await emailService.sendWelcomeEmail(userEmail, firstName);

    console.log('Welcome email sent successfully');
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}

/**
 * Example 7: Check Email Service Status
 */
export function exampleCheckEmailServiceStatus(): void {
  const emailService = new EmailService();

  // Check if SendGrid is configured
  if (emailService.isReady()) {
    console.log('Email service is ready to send emails');
  } else {
    console.warn('Email service not configured - emails will be logged only');
  }

  // Get detailed status
  const status = emailService.getStatus();
  console.log('Email service configuration:', status);
  // Output: { configured: true/false, fromEmail, fromName, frontendUrl }
}

/**
 * Example 8: Check for Existing Valid Token
 */
export async function exampleCheckExistingToken(
  userId: number,
  type: 'email_verification' | 'password_reset'
): Promise<void> {
  try {
    const tokenService = new EmailTokenService();
    const existingToken = await tokenService.getValidTokenForUser(userId, type);

    if (existingToken) {
      console.log('User already has a valid token:', existingToken.token);
      // Optionally: resend the email or inform user
    } else {
      console.log('No valid token found for user');
      // Generate a new token
    }
  } catch (error) {
    console.error('Error checking existing token:', error);
    throw error;
  }
}

/**
 * Example Controller Method: Password Reset Request
 *
 * Usage in a controller:
 * POST /auth/forgot-password
 * Body: { email: string }
 */
export async function controllerExampleForgotPassword(
  email: string
): Promise<{ success: boolean; message: string }> {
  try {
    const userDAO = new UserDAO();
    const user = await userDAO.getByEmail(email);

    if (!user || !user.id) {
      // Security: Don't reveal if email exists
      return {
        success: true,
        message: 'If the email exists, a password reset link has been sent',
      };
    }

    // Invalidate any existing password reset tokens
    const tokenService = new EmailTokenService();
    await tokenService.invalidateAllUserTokens(user.id, 'password_reset');

    // Generate new token
    const tokenRecord = await tokenService.generateEmailToken(
      user.id,
      'password_reset'
    );

    // Send email
    const emailService = new EmailService();
    await emailService.sendPasswordResetEmail(
      user.email,
      tokenRecord.token,
      user.firstName
    );

    return {
      success: true,
      message: 'If the email exists, a password reset link has been sent',
    };
  } catch (error) {
    console.error('Error in forgot password:', error);
    throw error;
  }
}

/**
 * Example Controller Method: Reset Password
 *
 * Usage in a controller:
 * POST /auth/reset-password
 * Body: { token: string, password: string }
 */
export async function controllerExampleResetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Verify token
    const tokenService = new EmailTokenService();
    const verifiedToken = await tokenService.verifyEmailToken(
      token,
      'password_reset'
    );

    if (!verifiedToken) {
      return {
        success: false,
        message: 'Invalid or expired token',
      };
    }

    // 2. Hash password (use bcrypt in real code)
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 3. Update user password
    const userDAO = new UserDAO();
    await userDAO.update(verifiedToken.userId, {
      password: hashedPassword,
    });

    // 4. Invalidate token
    await tokenService.invalidateToken(token);

    return {
      success: true,
      message: 'Password reset successfully',
    };
  } catch (error) {
    console.error('Error resetting password:', error);
    throw error;
  }
}

/**
 * Example Controller Method: Verify Email
 *
 * Usage in a controller:
 * GET /auth/verify-email?token=xxx
 */
export async function controllerExampleVerifyEmail(
  token: string
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Verify token
    const tokenService = new EmailTokenService();
    const verifiedToken = await tokenService.verifyEmailToken(
      token,
      'email_verification'
    );

    if (!verifiedToken) {
      return {
        success: false,
        message: 'Invalid or expired verification link',
      };
    }

    // 2. Mark email as verified
    const userDAO = new UserDAO();
    await userDAO.update(verifiedToken.userId, {
      emailVerified: true,
    });

    // 3. Invalidate token
    await tokenService.invalidateToken(token);

    // 4. Optionally send welcome email
    const user = await userDAO.getById(verifiedToken.userId);
    if (user) {
      const emailService = new EmailService();
      await emailService.sendWelcomeEmail(user.email, user.firstName);
    }

    return {
      success: true,
      message: 'Email verified successfully',
    };
  } catch (error) {
    console.error('Error verifying email:', error);
    throw error;
  }
}
