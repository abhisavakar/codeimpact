import { describe, it, expect } from 'vitest';
import { getPlan, PLANS } from '../src/billing/plans.js';

describe('Billing Plans', () => {
  it('returns free plan', () => {
    const plan = getPlan('free');
    expect(plan).toBeDefined();
    expect(plan!.priceMonthly).toBe(0);
  });

  it('returns undefined for unknown plan', () => {
    expect(getPlan('nonexistent')).toBeUndefined();
  });

  it('has 3 plans', () => {
    expect(PLANS).toHaveLength(3);
  });
});
