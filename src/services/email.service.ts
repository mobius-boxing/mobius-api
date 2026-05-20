import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
  invitationEmailTemplate,
  storeInvitationEmailTemplate,
  storeOrderNotificationEmailTemplate,
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
  private storeAppUrl: string | undefined;

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
    // STORE_APP_URL points at the customer-facing store app. It may be unset:
    // mobius-store-app does not exist yet, so the invite link will not resolve
    // until that app is built. Invite creation still succeeds (token persisted);
    // the email send is fail-soft at the caller. Primary v1 path is admin-set-password.
    this.storeAppUrl = process.env.STORE_APP_URL;
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
        console.error("✗ Error sending email via SES:", error?.message || error);
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

  /**
   * Store-user invitation. Links to STORE_APP_URL (customer-facing store app).
   *
   * ⚠ FLAG: mobius-store-app does not exist yet, so STORE_APP_URL may be unset and
   * the invite link will not resolve until that app is built. We fall back to
   * FRONTEND_URL only so the email is well-formed; the link is effectively dormant.
   * Callers MUST invoke this fail-soft (try/catch → console.error) — the store user
   * and token are already persisted, and the primary v1 path is admin-set-password.
   */
  public async sendStoreInvitationEmail(
    email: string,
    token: string,
    name?: string,
  ): Promise<void> {
    try {
      const baseUrl = this.storeAppUrl || this.frontendUrl;
      const actionUrl = `${baseUrl}/accept-invitation/${token}`;

      const html = storeInvitationEmailTemplate({
        firstName: name,
        actionUrl,
      });

      const subject = "Has sido invitado a la tienda en Mobius";

      await this.send(email, subject, html);
    } catch (error) {
      console.error("Error sending store invitation email:", error);
      throw error;
    }
  }

  /**
   * New-order notification to company admins. No price; the short uuid ref, the
   * buyer email and the item count only. Multi-recipient: send to each admin in a
   * loop (the private `send` takes a single `to`) so one bad address can't drop the
   * rest. Caller invokes this fail-soft — an email failure must NOT fail the order.
   */
  public async sendStoreOrderNotificationEmail(
    toEmails: string[],
    data: {
      orderRef: string;
      buyerEmail: string;
      itemCount: number;
      companyName: string;
    },
  ): Promise<void> {
    try {
      const html = storeOrderNotificationEmailTemplate({
        orderRef: data.orderRef,
        buyerEmail: data.buyerEmail,
        itemCount: data.itemCount,
        companyName: data.companyName,
        actionUrl: `${this.frontendUrl}/store-orders`,
      });
      const subject = `Nuevo pedido de tienda — ${data.companyName} (#${data.orderRef})`;

      for (const to of toEmails) {
        await this.send(to, subject, html);
      }
    } catch (error) {
      console.error("Error sending store order notification email:", error);
      throw error; // caller is fail-soft
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
  ): Promise<void> {
    try {
      const actionUrl = `${this.frontendUrl}/reset-password?token=${token}`;

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
