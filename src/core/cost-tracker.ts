import type { Tier2Storage } from '../storage/tier2.js';

/**
 * Time period for stats aggregation.
 */
export type StatsPeriod = 'day' | 'week' | 'month' | 'all';

/**
 * Token usage stats for a given period.
 */
export interface UsageStats {
  period: StatsPeriod;
  periodStart: Date;
  periodEnd: Date;
  totalQueries: number;
  totalTokensUsed: number;
  totalCostDollars: number;
  byQueryType: Array<{
    queryType: string;
    queries: number;
    tokensUsed: number;
    costDollars: number;
  }>;
  dailyUsage: Array<{
    date: string;
    queries: number;
    tokensUsed: number;
    costDollars: number;
  }>;
}

/**
 * Pricing constants for cost estimation.
 * Based on Claude API pricing (approximate).
 */
const PRICING = {
  // Cost per 1K tokens (input + output average)
  CLAUDE_SONNET_PER_1K: 0.006,  // ~$3/1M input + $15/1M output averaged
  CLAUDE_OPUS_PER_1K: 0.030,   // ~$15/1M input + $75/1M output averaged

  // Default to Sonnet pricing
  DEFAULT_PER_1K: 0.006,
};

/**
 * CostTracker - Tracks token usage for CodeImpact queries.
 *
 * Features:
 * 1. Records token usage for each query
 * 2. Provides stats by period (day, week, month)
 * 3. Generates usage reports
 */
export class CostTracker {
  private tier2: Tier2Storage;

  constructor(tier2: Tier2Storage) {
    this.tier2 = tier2;
  }

  /**
   * Record a token usage event.
   *
   * @param queryType - Type of query (get_context, search, etc.)
   * @param tokensUsed - Tokens used for this query
   */
  recordUsage(queryType: string, tokensUsed: number): void {
    // Calculate cost
    const costDollars = (tokensUsed / 1000) * PRICING.DEFAULT_PER_1K;
    this.tier2.recordTokenUsage(queryType, tokensUsed, costDollars);
  }

  /**
   * Get usage stats for a specific period.
   */
  getStats(period: StatsPeriod = 'month'): UsageStats {
    const now = new Date();
    const periodStart = this.getPeriodStart(period, now);
    const sinceTimestamp = Math.floor(periodStart.getTime() / 1000);

    // Get stats from tier2
    const stats = this.tier2.getTokenUsageStats(sinceTimestamp);
    const dailyUsage = this.tier2.getDailyTokenUsage(this.getPeriodDays(period));

    return {
      period,
      periodStart,
      periodEnd: now,
      totalQueries: stats.totalQueries,
      totalTokensUsed: stats.totalTokensUsed,
      totalCostDollars: stats.totalCostDollars,
      byQueryType: stats.byQueryType,
      dailyUsage,
    };
  }

  /**
   * Format stats as a human-readable report.
   */
  formatReport(stats: UsageStats): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('CODEIMPACT USAGE REPORT');
    lines.push('='.repeat(60));
    lines.push('');

    // Period
    const periodLabel = this.getPeriodLabel(stats.period);
    lines.push(`Period: ${periodLabel}`);
    lines.push(`From: ${stats.periodStart.toLocaleDateString()} to ${stats.periodEnd.toLocaleDateString()}`);
    lines.push('');

    // Summary
    lines.push('SUMMARY');
    lines.push('-'.repeat(40));
    lines.push(`Total queries:        ${stats.totalQueries.toLocaleString()}`);
    lines.push(`Tokens used:          ${this.formatTokens(stats.totalTokensUsed)}`);
    lines.push(`Estimated cost:       $${stats.totalCostDollars.toFixed(2)}`);
    lines.push('');

    // By query type
    if (stats.byQueryType.length > 0) {
      lines.push('USAGE BY QUERY TYPE');
      lines.push('-'.repeat(40));
      for (const qt of stats.byQueryType.slice(0, 10)) {
        const pct = stats.totalTokensUsed > 0
          ? Math.round((qt.tokensUsed / stats.totalTokensUsed) * 100)
          : 0;
        lines.push(`  ${qt.queryType}:`);
        lines.push(`    Queries: ${qt.queries}, Tokens: ${this.formatTokens(qt.tokensUsed)} (${pct}%), Cost: $${qt.costDollars.toFixed(2)}`);
      }
      if (stats.byQueryType.length > 10) {
        lines.push(`  ... and ${stats.byQueryType.length - 10} more types`);
      }
      lines.push('');
    }

    // Daily trend (last 7 days)
    if (stats.dailyUsage.length > 0) {
      lines.push('DAILY USAGE (recent)');
      lines.push('-'.repeat(40));
      for (const day of stats.dailyUsage.slice(0, 7)) {
        lines.push(`  ${day.date}: ${day.queries} queries, ${this.formatTokens(day.tokensUsed)}, $${day.costDollars.toFixed(2)}`);
      }
      lines.push('');
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  /**
   * Format stats as JSON.
   */
  formatReportJSON(stats: UsageStats): string {
    return JSON.stringify({
      period: {
        type: stats.period,
        start: stats.periodStart.toISOString(),
        end: stats.periodEnd.toISOString(),
      },
      usage: {
        totalQueries: stats.totalQueries,
        totalTokensUsed: stats.totalTokensUsed,
        totalCostDollars: Math.round(stats.totalCostDollars * 100) / 100,
      },
      byQueryType: stats.byQueryType,
      dailyUsage: stats.dailyUsage,
    }, null, 2);
  }

  // ==================== Private Helpers ====================

  /**
   * Get the start date for a period.
   */
  private getPeriodStart(period: StatsPeriod, now: Date): Date {
    const start = new Date(now);

    switch (period) {
      case 'day':
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'all':
        start.setFullYear(2020, 0, 1); // Far in the past
        break;
    }

    return start;
  }

  /**
   * Get the number of days for a period.
   */
  private getPeriodDays(period: StatsPeriod): number {
    switch (period) {
      case 'day': return 1;
      case 'week': return 7;
      case 'month': return 30;
      case 'all': return 365;
    }
  }

  /**
   * Get a human-readable label for a period.
   */
  private getPeriodLabel(period: StatsPeriod): string {
    switch (period) {
      case 'day': return 'Today';
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'all': return 'All Time';
    }
  }

  /**
   * Format token count with K/M suffix.
   */
  private formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  }
}
