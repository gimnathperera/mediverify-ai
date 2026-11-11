/**
 * Client-side form validation (zod-free: the web bundle avoids zod). Limits come from
 * `@mediverify/shared/client`, the same constants the API schema uses; the server stays the final
 * authority. Each validator returns the message to show under the field, or null when valid.
 */
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@mediverify/shared/client';

// Pragmatic shape check (something@domain.tld, no spaces); the server applies the full rule.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (email.length > EMAIL_MAX_LENGTH)
    return `Email must be at most ${EMAIL_MAX_LENGTH} characters.`;
  if (!EMAIL_SHAPE.test(email)) return 'Enter a valid email address, like name@example.com.';
  return null;
}

/** Sign-in only checks presence (an existing password is never re-judged); sign-up checks length. */
export function validatePassword(value: string, mode: 'login' | 'signup'): string | null {
  if (!value) return 'Enter your password.';
  if (mode === 'login') return null;
  if (value.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (value.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

export function validatePasswordConfirmation(password: string, confirm: string): string | null {
  if (!confirm) return 'Re-enter your password to confirm it.';
  if (confirm !== password) return 'Passwords do not match.';
  return null;
}
