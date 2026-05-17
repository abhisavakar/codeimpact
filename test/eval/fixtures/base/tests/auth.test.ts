import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword } from '../src/api/validators.js';

describe('Auth Validators', () => {
  it('validates correct emails', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(validateEmail('not-email')).toBe(false);
  });

  it('validates strong passwords', () => {
    expect(validatePassword('StrongPass1').valid).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(validatePassword('Ab1').valid).toBe(false);
  });
});
