import jwt from 'jsonwebtoken';
import { hashPassword, comparePassword } from './middleware.js';
import type { AuthUser } from './types.js';

export async function login(email: string, password: string): Promise<string> {
  const user = await findUserByEmail(email);
  if (!user) throw new Error('User not found');
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw new Error('Invalid password');
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: '24h' });
}

async function findUserByEmail(email: string): Promise<AuthUser | null> {
  // Database lookup stub
  return null;
}
