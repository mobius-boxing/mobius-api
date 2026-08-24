import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
  invitationEmailTemplate,
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  emailVerificationTemplate,
} from "../templates/email-templates";

export class EmailService {
  private isConfigured: boolean;
  private ses: SESClient | null = null;
  private fromEmail: string;
  private fromName: string;
  private frontendUrl: string;

  constructor() {
    // SES authenticates via the ambient AWS credential chain: the EC2 instance role
    // in production (no API key to store/leak), or ~/.aws / env vars locally. We only
    // need a region + a verified sender. With no region (typical local dev) we degrade
    // to logging instead of failing.
    const region = process.env.SES_REGION || process.env.AWS_REGION;
    this.isConfigured = !!region;

    if (this.isConfigured) {
      this.ses = new SESClient({ region });
      console.log("✓ SES email service initialized");
    } else {
      console.warn("⚠ SES region not configured. Emails will be logged only.");
    }

    this.fromEmail = process.env.EMAIL_FROM || "noreply@mobius-tms.com";
    this.fromName = process.env.EMAIL_FROM_NAME || "Mobius";
    this.frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  }

  // If SES is not configured (no region) we degrade gracefully by logging the email
  // instead of failing — keeps local/dev environments usable without credentials.
  private async send(to: string, subject: string, html: string): Promise<void> {
    if (this.isConfigured && this.ses) {
      try {
        await this.ses.send(
          new SendEmailCommand({
            Source: `${this.fromName} <${this.fromEmail}>`,
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: { Html: { Data: html, Charset: "UTF-8" } },
            },
          }),
        );
        console.log(`✓ Email sent to ${to}: ${subject}`);
      } catch (error: any) {
        console.error(
          "✗ Error sending email via SES:",
          error?.message || error,
        );
        throw new Error("Failed to send email");
      }
    } else {
      console.log("\n====== EMAIL (NOT SENT - SES not configured) ======");
      console.log("To:", to);
      console.log("From:", `${this.fromName} <${this.fromEmail}>`);
      console.log("Subject:", subject);
      console.log("HTML Preview:", html.substring(0, 200) + "...");
      console.log(
        "=========================================================\n",
      );
    }
  }

  public async sendInvitationEmail(
    email: string,
    companyName: string,
    role: "member" | "admin",
    token: string,
    firstName?: string,
  ): Promise<void> {
    try {
      const actionUrl = `${this.frontendUrl}/accept-invitation/${token}`;

      const html = invitationEmailTemplate({
        firstName,
        companyName,
        role,
        actionUrl,
      });

      const subject = `Has sido invitado a unirte a ${companyName} en Mobius`;

      await this.send(email, subject, html);
    } catch (error) {
      console.error("Error sending invitation email:", error);
      throw error;
    }
  }

  public async sendWelcomeEmail(
    email: string,
    firstName: string,
  ): Promise<void> {
    try {
      const html = welcomeEmailTemplate({
        firstName,
      });

      const subject = "¡Bienvenido a Mobius!";

      await this.send(email, subject, html);
    } catch (error) {
      console.error("Error sending welcome email:", error);
      throw error;
    }
  }

  public async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName?: string,
    baseUrl?: string,
  ): Promise<void> {
    try {
      // baseUrl returns the link to the app that requested the reset (web app vs backoffice).
      // The caller passes only origins it has validated against the allowlist; never an
      // arbitrary client-supplied URL (open-redirect). Falls back to the web app URL.
      const actionUrl = `${baseUrl || this.frontendUrl}/reset-password?token=${token}`;

      const html = passwordResetEmailTemplate({
        firstName,
        email,
        actionUrl,
      });

      const subject = "Restablece tu Contraseña de Mobius";

      await this.send(email, subject, html);
    } catch (error) {
      console.error("Error sending password reset email:", error);
      throw error;
    }
  }

  public async sendEmailVerificationEmail(
    email: string,
    token: string,
    firstName?: string,
  ): Promise<void> {
    try {
      const actionUrl = `${this.frontendUrl}/verify-email?token=${token}`;

      const html = emailVerificationTemplate({
        firstName,
        email,
        actionUrl,
      });

      const subject = "Verifica tu Correo Electrónico de Mobius";

      await this.send(email, subject, html);
    } catch (error) {
      console.error("Error sending email verification email:", error);
      throw error;
    }
  }

  public isReady(): boolean {
    return this.isConfigured;
  }

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
