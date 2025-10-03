import * as sgMail from '@sendgrid/mail';
import {
  invitationEmailTemplate,
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  emailVerificationTemplate,
} from '../templates/email-templates';

export class EmailService {
  private isConfigured: boolean;
  private fromEmail: string;
  private fromName: string;
  private frontendUrl: string;

  constructor() {
    // Check if SendGrid API key is configured
    const apiKey = process.env.SENDGRID_API_KEY;
    this.isConfigured = !!apiKey && apiKey.trim() !== '';

    if (this.isConfigured) {
      sgMail.setApiKey(apiKey as string);
      console.log('✓ SendGrid email service initialized');
    } else {
      console.warn('⚠ SendGrid API key not configured. Emails will be logged only.');
    }

    // Set email configuration from environment variables
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@mobius-tms.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Mobius';
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  /**
   * Send an email or log it if SendGrid is not configured
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - HTML content
   */
  private async send(to: string, subject: string, html: string): Promise<void> {
    const emailData = {
      to,
      from: {
        email: this.fromEmail,
        name: this.fromName,
      },
      subject,
      html,
    };

    if (this.isConfigured) {
      try {
        await sgMail.send(emailData);
        console.log(`✓ Email sent to ${to}: ${subject}`);
      } catch (error: any) {
        console.error('✗ Error sending email:', error);
        if (error.response) {
          console.error('SendGrid error details:', error.response.body);
        }
        throw new Error('Failed to send email');
      }
    } else {
      // Graceful degradation: log email instead of sending
      console.log('\n====== EMAIL (NOT SENT - SendGrid not configured) ======');
      console.log('To:', to);
      console.log('From:', `${this.fromName} <${this.fromEmail}>`);
      console.log('Subject:', subject);
      console.log('HTML Preview:', html.substring(0, 200) + '...');
      console.log('=========================================================\n');
    }
  }

  /**
   * Send invitation email to a new user
   * @param email - Recipient email address
   * @param companyName - Company name
   * @param role - User role (member or admin)
   * @param token - Invitation token
   * @param firstName - User's first name (optional)
   */
  public async sendInvitationEmail(
    email: string,
    companyName: string,
    role: 'member' | 'admin',
    token: string,
    firstName?: string
  ): Promise<void> {
    try {
      const actionUrl = `${this.frontendUrl}/accept-invitation?token=${token}`;

      const html = invitationEmailTemplate({
        firstName,
        companyName,
        role,
        actionUrl,
      });

      const subject = `You've been invited to join ${companyName} on Mobius`;

      await this.send(email, subject, html);
    } catch (error) {
      console.error('Error sending invitation email:', error);
      throw error;
    }
  }

  /**
   * Send welcome email to a new user after successful registration
   * @param email - Recipient email address
   * @param firstName - User's first name
   */
  public async sendWelcomeEmail(email: string, firstName: string): Promise<void> {
    try {
      const html = welcomeEmailTemplate({
        firstName,
      });

      const subject = 'Welcome to Mobius!';

      await this.send(email, subject, html);
    } catch (error) {
      console.error('Error sending welcome email:', error);
      throw error;
    }
  }

  /**
   * Send password reset email
   * @param email - Recipient email address
   * @param token - Password reset token
   * @param firstName - User's first name (optional)
   */
  public async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName?: string
  ): Promise<void> {
    try {
      const actionUrl = `${this.frontendUrl}/reset-password?token=${token}`;

      const html = passwordResetEmailTemplate({
        firstName,
        email,
        actionUrl,
      });

      const subject = 'Reset Your Mobius Password';

      await this.send(email, subject, html);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw error;
    }
  }

  /**
   * Send email verification email
   * @param email - Recipient email address
   * @param token - Email verification token
   * @param firstName - User's first name (optional)
   */
  public async sendEmailVerificationEmail(
    email: string,
    token: string,
    firstName?: string
  ): Promise<void> {
    try {
      const actionUrl = `${this.frontendUrl}/verify-email?token=${token}`;

      const html = emailVerificationTemplate({
        firstName,
        email,
        actionUrl,
      });

      const subject = 'Verify Your Mobius Email Address';

      await this.send(email, subject, html);
    } catch (error) {
      console.error('Error sending email verification email:', error);
      throw error;
    }
  }

  /**
   * Check if email service is properly configured
   * @returns True if SendGrid is configured
   */
  public isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Get email service configuration status
   * @returns Configuration status object
   */
  public getStatus(): {
    configured: boolean;
    fromEmail: string;
    fromName: string;
    frontendUrl: string;
  } {
    return {
      configured: this.isConfigured,
      fromEmail: this.fromEmail,
      fromName: this.fromName,
      frontendUrl: this.frontendUrl,
    };
  }
}
