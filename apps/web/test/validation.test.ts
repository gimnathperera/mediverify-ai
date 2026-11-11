import { describe, expect, it } from 'vitest';

import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '../src/lib/validation';

describe('form validation', () => {
  it.each([
    ['', 'Enter your email address.'],
    ['   ', 'Enter your email address.'],
    ['reviewer', /valid email/],
    ['reviewer@host', /valid email/],
    ['a b@c.de', /valid email/],
    [`${'a'.repeat(250)}@x.io`, 'Email must be at most 254 characters.'],
  ])('rejects the email %j', (value, message) => {
    expect(validateEmail(value)).toMatch(message);
  });

  it('accepts a normal email, ignoring surrounding spaces', () => {
    expect(validateEmail(' reviewer@mediverify.test ')).toBeNull();
  });

  it('checks password length only on sign-up (same limits as the API)', () => {
    expect(validatePassword('', 'login')).toBe('Enter your password.');
    expect(validatePassword('short', 'login')).toBeNull();
    expect(validatePassword('short', 'signup')).toBe('Password must be at least 8 characters.');
    expect(validatePassword('x'.repeat(129), 'signup')).toBe(
      'Password must be at most 128 characters.',
    );
    expect(validatePassword('long-enough', 'signup')).toBeNull();
  });

  it('requires a matching confirmation', () => {
    expect(validatePasswordConfirmation('long-enough', '')).toMatch(/re-enter/i);
    expect(validatePasswordConfirmation('long-enough', 'long-enougH')).toBe(
      'Passwords do not match.',
    );
    expect(validatePasswordConfirmation('long-enough', 'long-enough')).toBeNull();
  });
});
