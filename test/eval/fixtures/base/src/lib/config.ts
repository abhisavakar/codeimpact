export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  stripeKey: process.env.STRIPE_SECRET_KEY || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};
