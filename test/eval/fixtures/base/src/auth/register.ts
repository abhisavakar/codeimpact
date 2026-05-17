import { hashPassword } from './middleware.js';
import type { AuthUser } from './types.js';

export async function register(email: string, password: string): Promise<AuthUser> {
  const existing = await checkExistingUser(email);
  if (existing) throw new Error('User already exists');
  const hash = await hashPassword(password);
  return createUser(email, hash);
}

async function checkExistingUser(email: string): Promise<boolean> {
  return false;
}

async function createUser(email: string, hash: string): Promise<AuthUser> {
  return { id: '1', email, passwordHash: hash };
}
