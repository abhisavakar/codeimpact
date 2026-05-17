import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'No token' }); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    (req as any).user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return `hashed:${password}`;
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return hash === `hashed:${password}`;
}
