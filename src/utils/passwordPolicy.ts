/**
 * SECURITY (M4): centralized password policy + bcrypt cost, shared across internal and store users.
 *
 * Policy: minimum 12 characters, at least one uppercase, one lowercase, and one digit.
 * Keep this DRY — every place that accepts a user-chosen password (register, reset, accept-invite,
 * admin-set, change-password, store users) must run validatePassword().
 */

// bcrypt work factor. Raised from 10 → 12 (M4).
export const BCRYPT_COST = 12;

export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export function validatePassword(password: unknown): PasswordValidationResult {
  if (typeof password !== "string" || password.length === 0) {
    return { valid: false, message: "Password is required." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one uppercase letter.",
    };
  }
  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one lowercase letter.",
    };
  }
  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one digit.",
    };
  }
  return { valid: true };
}
