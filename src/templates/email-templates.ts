/**
 * Email HTML Templates for Mobius
 * All templates use Mobius branding with gradient header (#0A2559 → #1E40AF)
 * Responsive design with buttons for CTAs
 */

interface EmailTemplateParams {
  firstName?: string;
  companyName?: string;
  role?: string;
  actionUrl?: string;
  email?: string;
}

/**
 * Base email template wrapper
 */
const emailWrapper = (content: string): string => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mobius</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f5f5f5;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #0A2559 0%, #1E40AF 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .logo {
      color: #ffffff;
      font-size: 32px;
      font-weight: bold;
      margin: 0;
      letter-spacing: 1px;
    }
    .content {
      padding: 40px 30px;
      color: #333333;
      line-height: 1.6;
    }
    .greeting {
      font-size: 24px;
      font-weight: 600;
      color: #0A2559;
      margin-bottom: 20px;
    }
    .message {
      font-size: 16px;
      color: #555555;
      margin-bottom: 30px;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #0A2559 0%, #1E40AF 100%);
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 40px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
      transition: opacity 0.3s;
    }
    .cta-button:hover {
      opacity: 0.9;
    }
    .info-box {
      background-color: #f8f9fa;
      border-left: 4px solid #1E40AF;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box p {
      margin: 5px 0;
      font-size: 14px;
      color: #555555;
    }
    .info-box strong {
      color: #0A2559;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 30px;
      text-align: center;
      color: #777777;
      font-size: 14px;
      border-top: 1px solid #e0e0e0;
    }
    .footer p {
      margin: 5px 0;
    }
    .footer a {
      color: #1E40AF;
      text-decoration: none;
    }
    .divider {
      height: 1px;
      background-color: #e0e0e0;
      margin: 30px 0;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 30px 20px;
      }
      .greeting {
        font-size: 20px;
      }
      .message {
        font-size: 14px;
      }
      .cta-button {
        display: block;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1 class="logo">MOBIUS</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p><strong>Mobius TMS</strong></p>
      <p>Transportation Management System</p>
      <p style="margin-top: 15px;">
        This is an automated email. Please do not reply to this message.
      </p>
      <p style="margin-top: 10px;">
        <a href="mailto:support@mobius-tms.com">Contact Support</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
};

/**
 * Invitation Email Template
 * Sent when a user is invited to join a company
 */
export const invitationEmailTemplate = (params: EmailTemplateParams): string => {
  const { firstName = 'there', companyName = 'a company', role = 'member', actionUrl = '#' } = params;

  const roleDisplay = role === 'admin' ? 'Administrator' : 'Member';

  const content = `
    <h2 class="greeting">Hello ${firstName}!</h2>

    <p class="message">
      You've been invited to join <strong>${companyName}</strong> on Mobius as a <strong>${roleDisplay}</strong>.
    </p>

    <p class="message">
      Mobius is a comprehensive Transportation Management System that helps companies streamline their logistics operations, manage shipments, and track deliveries in real-time.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Accept Invitation</a>
    </div>

    <div class="info-box">
      <p><strong>Company:</strong> ${companyName}</p>
      <p><strong>Role:</strong> ${roleDisplay}</p>
      <p><strong>Action Required:</strong> Click the button above to set up your account</p>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      If the button doesn't work, copy and paste this link into your browser:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #777777; margin-top: 20px;">
      This invitation link will expire in 48 hours. If you didn't expect this invitation, you can safely ignore this email.
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Welcome Email Template
 * Sent after a user successfully creates their account
 */
export const welcomeEmailTemplate = (params: EmailTemplateParams): string => {
  const { firstName = 'there' } = params;

  const content = `
    <h2 class="greeting">Welcome to Mobius, ${firstName}!</h2>

    <p class="message">
      Thank you for joining Mobius Transportation Management System. We're excited to have you on board!
    </p>

    <p class="message">
      Mobius provides you with powerful tools to manage your logistics operations efficiently:
    </p>

    <div class="info-box">
      <p><strong>✓</strong> Real-time shipment tracking</p>
      <p><strong>✓</strong> Comprehensive delivery management</p>
      <p><strong>✓</strong> Advanced analytics and reporting</p>
      <p><strong>✓</strong> Team collaboration tools</p>
    </div>

    <p class="message">
      Your account is now active and ready to use. Log in to start managing your transportation operations.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="cta-button">Go to Dashboard</a>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      Need help getting started? Check out our documentation or contact our support team at
      <a href="mailto:support@mobius-tms.com" style="color: #1E40AF;">support@mobius-tms.com</a>
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Password Reset Email Template
 * Sent when a user requests to reset their password
 */
export const passwordResetEmailTemplate = (params: EmailTemplateParams): string => {
  const { firstName = 'there', actionUrl = '#', email = '' } = params;

  const content = `
    <h2 class="greeting">Password Reset Request</h2>

    <p class="message">
      Hello ${firstName},
    </p>

    <p class="message">
      We received a request to reset the password for your Mobius account (${email}).
    </p>

    <p class="message">
      Click the button below to reset your password. This link will expire in 24 hours for security reasons.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Reset Password</a>
    </div>

    <div class="info-box">
      <p><strong>Security Note:</strong> This link can only be used once and expires in 24 hours.</p>
      <p><strong>Account:</strong> ${email}</p>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      If the button doesn't work, copy and paste this link into your browser:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #ff6b6b; margin-top: 20px;">
      <strong>Didn't request a password reset?</strong> If you didn't make this request, please ignore this email.
      Your password will remain unchanged. You may want to review your account security.
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Email Verification Template
 * Sent when a user needs to verify their email address
 */
export const emailVerificationTemplate = (params: EmailTemplateParams): string => {
  const { firstName = 'there', actionUrl = '#', email = '' } = params;

  const content = `
    <h2 class="greeting">Verify Your Email Address</h2>

    <p class="message">
      Hello ${firstName},
    </p>

    <p class="message">
      Thank you for signing up for Mobius! To complete your registration and ensure the security of your account,
      please verify your email address by clicking the button below.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Verify Email</a>
    </div>

    <div class="info-box">
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Action Required:</strong> Verify your email to activate your account</p>
      <p><strong>Expires:</strong> 48 hours</p>
    </div>

    <p class="message">
      Once verified, you'll have full access to all Mobius features and can start managing your logistics operations.
    </p>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      If the button doesn't work, copy and paste this link into your browser:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #777777; margin-top: 20px;">
      This verification link will expire in 48 hours. If you didn't create this account, you can safely ignore this email.
    </p>
  `;

  return emailWrapper(content);
};
