/**
 * Token Counter Utility
 *
 * Provides accurate token counting using GPT tokenizer.
 * Used for tracking API usage and costs.
 */

import { encode } from 'gpt-tokenizer';

/**
 * Count tokens in a string using GPT tokenizer.
 * This is accurate for Claude/GPT models (within ~5% accuracy).
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fallback to estimation if tokenizer fails
    return estimateTokens(text);
  }
}

/**
 * Estimate tokens when exact counting isn't available.
 * Uses different ratios for code vs prose.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // Code has more tokens per character (symbols, brackets, etc.)
  const hasCode = /[{}\[\]();=<>]/.test(text);
  const ratio = hasCode ? 3.2 : 4.0;

  return Math.ceil(text.length / ratio);
}

/**
 * Count tokens for an object (JSON serialized).
 */
export function countObjectTokens(obj: unknown): number {
  const json = JSON.stringify(obj);
  return countTokens(json);
}

/**
 * Token usage record for a single query.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Calculate token usage for a query.
 */
export function calculateTokenUsage(input: unknown, output: unknown): TokenUsage {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
  const outputStr = typeof output === 'string' ? output : JSON.stringify(output);

  const inputTokens = countTokens(inputStr);
  const outputTokens = countTokens(outputStr);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Pricing constants for cost estimation.
 * Based on Claude API pricing (March 2024).
 */
export const PRICING = {
  // Claude 3.5 Sonnet pricing per 1M tokens
  CLAUDE_SONNET_INPUT_PER_1M: 3.00,
  CLAUDE_SONNET_OUTPUT_PER_1M: 15.00,

  // Claude 3 Opus pricing per 1M tokens
  CLAUDE_OPUS_INPUT_PER_1M: 15.00,
  CLAUDE_OPUS_OUTPUT_PER_1M: 75.00,

  // Default to Sonnet pricing (most common)
  DEFAULT_INPUT_PER_1M: 3.00,
  DEFAULT_OUTPUT_PER_1M: 15.00,
};

/**
 * Calculate cost for token usage.
 */
export function calculateCost(usage: TokenUsage): number {
  const inputCost = (usage.inputTokens / 1_000_000) * PRICING.DEFAULT_INPUT_PER_1M;
  const outputCost = (usage.outputTokens / 1_000_000) * PRICING.DEFAULT_OUTPUT_PER_1M;
  return inputCost + outputCost;
}
