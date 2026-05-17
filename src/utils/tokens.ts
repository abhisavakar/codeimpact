// Re-export the canonical estimateTokens from token-counter
export { estimateTokens } from './token-counter.js';
import { estimateTokens } from './token-counter.js';

export class TokenBudget {
  private total: number;
  private allocations: Map<string, number> = new Map();

  constructor(total: number) {
    this.total = total;
  }

  used(): number {
    let sum = 0;
    for (const tokens of this.allocations.values()) {
      sum += tokens;
    }
    return sum;
  }

  remaining(): number {
    return this.total - this.used();
  }

  canFit(text: string): boolean {
    return estimateTokens(text) <= this.remaining();
  }

  allocate(text: string, category: string): boolean {
    const tokens = estimateTokens(text);
    if (tokens > this.remaining()) {
      return false;
    }

    const current = this.allocations.get(category) || 0;
    this.allocations.set(category, current + tokens);
    return true;
  }

  getAllocations(): Record<string, number> {
    return Object.fromEntries(this.allocations);
  }
}
