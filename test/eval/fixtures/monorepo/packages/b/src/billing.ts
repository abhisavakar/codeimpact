import { processPayment } from './index.js';
export function chargeCustomer(customerId: string, amount: number) {
  return { customerId, ...processPayment(amount) };
}
