import type { Request, Response } from 'express';

export function handleWebhook(req: Request, res: Response): void {
  const event = req.body;
  switch (event.type) {
    case 'checkout.session.completed':
      handleCheckoutComplete(event.data.object);
      break;
    case 'customer.subscription.deleted':
      handleSubscriptionCanceled(event.data.object);
      break;
    default:
      break;
  }
  res.status(200).json({ received: true });
}

function handleCheckoutComplete(session: any): void {
  // Activate subscription
}

function handleSubscriptionCanceled(subscription: any): void {
  // Deactivate subscription
}
