export function processPayment(amount: number): { success: boolean } {
  return { success: amount > 0 };
}
