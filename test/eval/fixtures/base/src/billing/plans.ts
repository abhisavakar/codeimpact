export interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  features: string[];
}

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', priceMonthly: 0, features: ['Basic access'] },
  { id: 'pro', name: 'Pro', priceMonthly: 29, features: ['Basic access', 'Priority support', 'API access'] },
  { id: 'enterprise', name: 'Enterprise', priceMonthly: 99, features: ['All features', 'SSO', 'Dedicated support'] },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find(p => p.id === id);
}
