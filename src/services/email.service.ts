import {
  invitationEmailTemplate,
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  emailVerificationTemplate,
} from "../templates/email-templates";
import { sendModuleEmail } from "./module-email.service";

export class EmailService {
  private isConfigured: boolean;
  private frontendUrl: string;

  constructor() {
    // Mirrors sendModuleEmail's own gate: outside production nothing is sent.
    this.isConfigured =
      process.env.NODE_ENV === "production" && !!process.env.RESEND_API_KEY;

    if (!this.isConfigured) {
      console.warn("⚠ Resend not configured. Emails will be logged only.");
    }

    this.frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.isConfigured) {
      console.log("\n====== EMAIL (NOT SENT - Resend not configured) ======");
      console.log("To:", to);
      console.log("Subject:", subject);
      console.log("HTML Preview:", html.substring(0, 200) + "...");
      console.log(
        "=========================================================\n",
      );
      return;
    }

    // sendModuleEmail fails soft; callers of EmailService expect a throw.
    if (!(await sendModuleEmail({ to, subject, html }))) {
      throw new Error("Failed to send email");
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
    frontendUrl: string;
  } {
    return {
      configured: this.isConfigured,
      frontendUrl: this.frontendUrl,
    };
  }
}
