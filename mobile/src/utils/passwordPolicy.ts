/** Matches Firebase-style password policy (your console: min 8, max 16, mixed case, digit, special). */
import i18n from "../i18n";

export const PASSWORD_MIN_LEN = 8;
export const PASSWORD_MAX_LEN = 16;

export type PasswordPolicyChecks = {
  lengthRange: boolean;
  uppercase: boolean;
  lowercase: boolean;
  numeric: boolean;
  special: boolean;
};

/** Non-letter, non-digit counts as special (aligned with typical Firebase “special character”). */
export function analyzePasswordPolicy(password: string): PasswordPolicyChecks {
  const len = password.length;
  const lengthRange = len >= PASSWORD_MIN_LEN && len <= PASSWORD_MAX_LEN;
  return {
    lengthRange,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    numeric: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function isPasswordPolicySatisfied(password: string): boolean {
  const c = analyzePasswordPolicy(password);
  return c.lengthRange && c.uppercase && c.lowercase && c.numeric && c.special;
}

export function getPasswordPolicySummaryError(password: string): string | null {
  if (isPasswordPolicySatisfied(password)) return null;
  return i18n.t("auth.errors.passwordPolicy", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN });
}
