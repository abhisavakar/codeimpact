import { Router } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { handleLogin, handleRegister, handleProfile } from './handlers.js';
import { handleWebhook } from '../billing/webhook.js';

const router = Router();

router.post('/auth/login', handleLogin);
router.post('/auth/register', handleRegister);
router.get('/profile', authMiddleware, handleProfile);
router.post('/webhook/stripe', handleWebhook);

export default router;
