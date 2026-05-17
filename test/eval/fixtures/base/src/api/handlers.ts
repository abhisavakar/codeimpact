import type { Request, Response } from 'express';
import { login } from '../auth/login.js';
import { register } from '../auth/register.js';

export async function handleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    const token = await login(email, password);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
}

export async function handleRegister(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    const user = await register(email, password);
    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

export async function handleProfile(req: Request, res: Response): Promise<void> {
  res.json({ user: (req as any).user });
}
