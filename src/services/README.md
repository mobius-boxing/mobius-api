# Email Service Usage Guide

## Overview

The Mobius API v2 email service provides a robust email sending system with HTML templates and token management for user authentication flows.

## Services

### 1. EmailService (`email.service.ts`)

Handles sending emails via SendGrid with graceful degradation when SendGrid is not configured.

#### Features:
- SendGrid integration
- Graceful degradation (logs emails if API key not set)
- HTML email templates with Mobius branding
- Configurable from environment variables

#### Methods:

**sendInvitationEmail(email, companyName, role, token, firstName?)**
```typescript
const emailService = new EmailService();
await emailService.sendInvitationEmail(
  'user@example.com',
  'Acme Corp',
  'admin',
  'abc123def456',
  'John'
);
```

**sendWelcomeEmail(email, firstName)**
```typescript
await emailService.sendWelcomeEmail(
  'user@example.com',
  'John'
);
```

**sendPasswordResetEmail(email, token, firstName?)**
```typescript
await emailService.sendPasswordResetEmail(
  'user@example.com',
  'reset_token_123',
  'John'
);
```

**sendEmailVerificationEmail(email, token, firstName?)**
```typescript
await emailService.sendEmailVerificationEmail(
  'user@example.com',
  'verify_token_123',
  'John'
);
```

**isReady()** - Check if SendGrid is configured
```typescript
if (emailService.isReady()) {
  console.log('Email service ready to send');
}
```

**getStatus()** - Get configuration status
```typescript
const status = emailService.getStatus();
// Returns: { configured, fromEmail, fromName, frontendUrl }
```

### 2. EmailTokenService (`email-token.service.ts`)

Manages email tokens for password resets and email verification.

#### Features:
- Cryptographically secure token generation (32 bytes hex)
- Token expiry management (24h for reset, 48h for verification)
- Token validation and verification
- Token invalidation

#### Methods:

**generateEmailToken(userId, type)**
```typescript
const tokenService = new EmailTokenService();
const token = await tokenService.generateEmailToken(
  userId: 123,
  type: 'password_reset'
);
// Returns: IEmailToken with token string
```

**verifyEmailToken(tokenString, type)**
```typescript
const token = await tokenService.verifyEmailToken(
  'abc123def456',
  'password_reset'
);
// Returns: IEmailToken if valid, null if invalid/expired
```

**invalidateToken(tokenString)**
```typescript
const success = await tokenService.invalidateToken('abc123def456');
// Returns: boolean
```

**getValidTokenForUser(userId, type)**
```typescript
const token = await tokenService.getValidTokenForUser(
  userId: 123,
  type: 'email_verification'
);
// Returns: IEmailToken if valid token exists, null otherwise
```

**invalidateAllUserTokens(userId, type)**
```typescript
await tokenService.invalidateAllUserTokens(
  userId: 123,
  type: 'password_reset'
);
// Invalidates all tokens of this type for the user
```

## Complete Workflow Examples

### Password Reset Flow

```typescript
import { EmailService } from './services/email.service';
import { EmailTokenService } from './services/email-token.service';
import { UserDAO } from './dao/user/user.dao';

// 1. User requests password reset
const userDAO = new UserDAO();
const user = await userDAO.getByEmail('user@example.com');

if (!user || !user.id) {
  throw new Error('User not found');
}

// 2. Generate reset token
const tokenService = new EmailTokenService();
const tokenRecord = await tokenService.generateEmailToken(
  user.id,
  'password_reset'
);

// 3. Send reset email
const emailService = new EmailService();
await emailService.sendPasswordResetEmail(
  user.email,
  tokenRecord.token,
  user.firstName
);

// 4. User clicks link and submits new password
const verifiedToken = await tokenService.verifyEmailToken(
  tokenFromUrl,
  'password_reset'
);

if (!verifiedToken) {
  throw new Error('Invalid or expired token');
}

// 5. Update password and invalidate token
await userDAO.update(verifiedToken.userId, { password: hashedPassword });
await tokenService.invalidateToken(tokenFromUrl);
```

### Email Verification Flow

```typescript
// 1. User registers
const user = await userDAO.create({
  email: 'newuser@example.com',
  password: hashedPassword,
  firstName: 'John',
  lastName: 'Doe',
  role: 'member',
  emailVerified: false
});

// 2. Generate verification token
const tokenService = new EmailTokenService();
const tokenRecord = await tokenService.generateEmailToken(
  user.id!,
  'email_verification'
);

// 3. Send verification email
const emailService = new EmailService();
await emailService.sendEmailVerificationEmail(
  user.email,
  tokenRecord.token,
  user.firstName
);

// 4. User clicks verification link
const verifiedToken = await tokenService.verifyEmailToken(
  tokenFromUrl,
  'email_verification'
);

if (!verifiedToken) {
  throw new Error('Invalid or expired token');
}

// 5. Mark email as verified and invalidate token
await userDAO.update(verifiedToken.userId, { emailVerified: true });
await tokenService.invalidateToken(tokenFromUrl);
```

### User Invitation Flow

```typescript
// 1. Admin invites user
const inviteToken = await tokenService.generateEmailToken(
  newUserId,
  'email_verification' // or create a separate 'invitation' type
);

// 2. Send invitation email
await emailService.sendInvitationEmail(
  'invitee@example.com',
  'Acme Corp',
  'admin',
  inviteToken.token,
  'Jane'
);

// 3. User accepts invitation and sets up account
// Verify token as in verification flow
```

## Environment Variables

Required in `.env`:

```env
# Email Configuration
SENDGRID_API_KEY=          # Leave empty for development (graceful degradation)
EMAIL_FROM=noreply@mobius-tms.com
EMAIL_FROM_NAME=Mobius
FRONTEND_URL=http://localhost:3000
```

## Email Templates

All templates are located in `src/templates/email-templates.ts` and feature:

- Mobius branding with gradient header (#0A2559 → #1E40AF)
- Responsive design
- Call-to-action buttons
- Security warnings and expiry information
- Consistent styling across all email types

### Available Templates:

1. **invitationEmailTemplate** - Company invitation
2. **welcomeEmailTemplate** - New user welcome
3. **passwordResetEmailTemplate** - Password reset request
4. **emailVerificationTemplate** - Email address verification

## Security Notes

- Tokens are cryptographically secure (32 bytes random)
- Password reset tokens expire in 24 hours
- Email verification tokens expire in 48 hours
- Tokens can only be used once (marked as used after verification)
- Always invalidate tokens after use
- Never expose token strings in logs or error messages

## Graceful Degradation

When `SENDGRID_API_KEY` is not set:
- Email service initializes successfully
- Emails are logged to console instead of being sent
- Development can continue without SendGrid account
- No errors thrown due to missing configuration

## Testing

```typescript
// Check if email service is ready
const emailService = new EmailService();
const status = emailService.getStatus();
console.log('Email service status:', status);

if (!emailService.isReady()) {
  console.warn('SendGrid not configured - emails will be logged only');
}

// Test token generation
const tokenService = new EmailTokenService();
const testToken = await tokenService.generateEmailToken(1, 'password_reset');
console.log('Generated token:', testToken.token);

// Test token verification
const verified = await tokenService.verifyEmailToken(
  testToken.token,
  'password_reset'
);
console.log('Token valid:', verified !== null);
```

## Production Setup

1. Obtain SendGrid API key from SendGrid dashboard
2. Add API key to production `.env` file
3. Verify `EMAIL_FROM` is a verified sender in SendGrid
4. Update `FRONTEND_URL` to production URL
5. Test all email flows in staging environment
6. Monitor SendGrid dashboard for delivery rates

## Troubleshooting

### Emails not sending in production:
- Verify `SENDGRID_API_KEY` is set correctly
- Check SendGrid sender verification status
- Review SendGrid dashboard for delivery failures
- Check API rate limits

### Invalid token errors:
- Check token hasn't expired
- Verify token type matches
- Ensure token hasn't been used already
- Check userId matches the token

### Email formatting issues:
- Templates are HTML-based and responsive
- Test with different email clients
- Use SendGrid's template testing features
