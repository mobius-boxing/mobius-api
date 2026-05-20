/**
 * Email HTML Templates for Mobius
 * All templates use Mobius branding with gradient header (#0A2559 → #1E40AF)
 * All templates are in Spanish (including subjects in email.service.ts)
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
<html lang="es">
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
      <p><strong>Mobius</strong></p>
      <p style="margin-top: 15px;">
        Este es un correo electrónico automatizado. Por favor no responda a este mensaje.
      </p>
      <p style="margin-top: 10px;">
        <a href="mailto:support@mobius-tms.com">Contactar Soporte</a>
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
export const invitationEmailTemplate = (
  params: EmailTemplateParams,
): string => {
  const {
    firstName = "there",
    companyName = "a company",
    role = "member",
    actionUrl = "#",
  } = params;

  const roleDisplay = role === "admin" ? "Administrador" : "Miembro";

  const content = `
    <h2 class="greeting">Hola ${firstName}!</h2>

    <p class="message">
      Has sido invitado a unirte a <strong>${companyName}</strong> en Mobius como <strong>${roleDisplay}</strong>.
    </p>

    <p class="message">
      Mobius es un software integral que ayuda a las empresas de cartón corrugado a gestionar su producción, inventario y operaciones de manera eficiente.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Aceptar Invitación</a>
    </div>

    <div class="info-box">
      <p><strong>Empresa:</strong> ${companyName}</p>
      <p><strong>Rol:</strong> ${roleDisplay}</p>
      <p><strong>Acción Requerida:</strong> Haz clic en el botón de arriba para configurar tu cuenta</p>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #777777; margin-top: 20px;">
      Este enlace de invitación expirará en 48 horas. Si no esperabas esta invitación, puedes ignorar este correo de forma segura.
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Store Invitation Email Template
 * Sent when a store user is invited to access a company's store app.
 * Links to STORE_APP_URL (the customer-facing store app), not the backoffice.
 */
export const storeInvitationEmailTemplate = (
  params: EmailTemplateParams,
): string => {
  const {
    firstName = "there",
    companyName = "a company",
    actionUrl = "#",
  } = params;

  const content = `
    <h2 class="greeting">Hola ${firstName}!</h2>

    <p class="message">
      Has sido invitado a acceder a la tienda de <strong>${companyName}</strong>.
    </p>

    <p class="message">
      Desde la tienda podrás gestionar tus pedidos de cajas y rollos de forma rápida y sencilla.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Activar mi cuenta</a>
    </div>

    <div class="info-box">
      <p><strong>Empresa:</strong> ${companyName}</p>
      <p><strong>Acción Requerida:</strong> Haz clic en el botón de arriba para configurar tu contraseña</p>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #777777; margin-top: 20px;">
      Este enlace de invitación expirará en 72 horas. Si no esperabas esta invitación, puedes ignorar este correo de forma segura.
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Welcome Email Template
 * Sent after a user successfully creates their account
 */
export const welcomeEmailTemplate = (params: EmailTemplateParams): string => {
  const { firstName = "there" } = params;

  const content = `
    <h2 class="greeting">Bienvenido a Mobius, ${firstName}!</h2>

    <p class="message">
      Gracias por unirte a Mobius. ¡Estamos emocionados de tenerte con nosotros!
    </p>

    <p class="message">
      Mobius te proporciona herramientas poderosas para gestionar tu producción de cartón corrugado de manera eficiente:
    </p>

    <div class="info-box">
      <p><strong>✓</strong> Gestión de inventarios y materiales</p>
      <p><strong>✓</strong> Control de producción en tiempo real</p>
      <p><strong>✓</strong> Análisis avanzados e informes</p>
      <p><strong>✓</strong> Herramientas de colaboración en equipo</p>
    </div>

    <p class="message">
      Tu cuenta está ahora activa y lista para usar. Inicia sesión para comenzar a gestionar tus operaciones.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/login" class="cta-button">Ir al Panel</a>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      ¿Necesitas ayuda para comenzar? Consulta nuestra documentación o contacta a nuestro equipo de soporte en
      <a href="mailto:support@mobius-tms.com" style="color: #1E40AF;">support@mobius-tms.com</a>
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Password Reset Email Template
 * Sent when a user requests to reset their password
 */
export const passwordResetEmailTemplate = (
  params: EmailTemplateParams,
): string => {
  const { firstName = "there", actionUrl = "#", email = "" } = params;

  const content = `
    <h2 class="greeting">Solicitud de Restablecimiento de Contraseña</h2>

    <p class="message">
      Hola ${firstName},
    </p>

    <p class="message">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta de Mobius (${email}).
    </p>

    <p class="message">
      Haz clic en el botón de abajo para restablecer tu contraseña. Este enlace expirará en 24 horas por razones de seguridad.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Restablecer Contraseña</a>
    </div>

    <div class="info-box">
      <p><strong>Nota de Seguridad:</strong> Este enlace solo se puede usar una vez y expira en 24 horas.</p>
      <p><strong>Cuenta:</strong> ${email}</p>
    </div>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #ff6b6b; margin-top: 20px;">
      <strong>¿No solicitaste restablecer tu contraseña?</strong> Si no realizaste esta solicitud, por favor ignora este correo. Tu contraseña permanecerá sin cambios. Es posible que desees revisar la seguridad de tu cuenta.
    </p>
  `;

  return emailWrapper(content);
};

/**
 * Email Verification Template
 * Sent when a user needs to verify their email address
 */
export const emailVerificationTemplate = (
  params: EmailTemplateParams,
): string => {
  const { firstName = "there", actionUrl = "#", email = "" } = params;

  const content = `
    <h2 class="greeting">Verifica tu Correo Electrónico</h2>

    <p class="message">
      Hola ${firstName},
    </p>

    <p class="message">
      ¡Gracias por registrarte en Mobius! Para completar tu registro y asegurar tu cuenta,
      por favor verifica tu correo electrónico haciendo clic en el botón de abajo.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="cta-button">Verificar Correo</a>
    </div>

    <div class="info-box">
      <p><strong>Correo:</strong> ${email}</p>
      <p><strong>Acción Requerida:</strong> Verifica tu correo para activar tu cuenta</p>
      <p><strong>Expira:</strong> 48 horas</p>
    </div>

    <p class="message">
      Una vez verificado, tendrás acceso completo a todas las funciones de Mobius y podrás comenzar a gestionar tus operaciones.
    </p>

    <div class="divider"></div>

    <p style="font-size: 14px; color: #777777;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
      <br>
      <a href="${actionUrl}" style="color: #1E40AF; word-break: break-all;">${actionUrl}</a>
    </p>

    <p style="font-size: 14px; color: #777777; margin-top: 20px;">
      Este enlace de verificación expirará en 48 horas. Si no creaste esta cuenta, puedes ignorar este correo de forma segura.
    </p>
  `;

  return emailWrapper(content);
};
