import type {
  ContextChunk,
  CompactionResult,
  CompactionOptions,
  CompactionSuggestion
} from '../../types/documentation.js';
import { ContextHealthMonitor } from './context-health.js';
import { CriticalContextManager } from './critical-context.js';
import { estimateTokens } from '../../utils/token-counter.js';

// Thresholds for different strategies
const RELEVANCE_THRESHOLD_SUMMARIZE = 0.5;
const RELEVANCE_THRESHOLD_SELECTIVE = 0.3;
const RELEVANCE_THRESHOLD_AGGRESSIVE = 0.2;

export class CompactionEngine {
  private healthMonitor: ContextHealthMonitor;
  private criticalManager: CriticalContextManager;

  constructor(healthMonitor: ContextHealthMonitor, criticalManager: CriticalContextManager) {
    this.healthMonitor = healthMonitor;
    this.criticalManager = criticalManager;
  }

  suggestCompaction(): CompactionSuggestion {
    const chunks = this.healthMonitor.getChunks();
    const tokenLimit = this.healthMonitor.getTokenLimit();
    const currentTokens = this.healthMonitor.getCurrentTokens();

    const critical: ContextChunk[] = [];
    const summarizable: ContextChunk[] = [];
    const removable: ContextChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.isCritical || chunk.relevanceScore >= RELEVANCE_THRESHOLD_SUMMARIZE) {
        critical.push(chunk);
      } else if (chunk.relevanceScore >= RELEVANCE_THRESHOLD_SELECTIVE) {
        summarizable.push(chunk);
      } else {
        removable.push(chunk);
      }
    }

    const removableTokens = removable.reduce((sum, c) => sum + c.tokens, 0);
    const summarizableTokens = summarizable.reduce((sum, c) => sum + c.tokens, 0);

    // Estimate tokens after summarization (assume 70% compression)
    const summarizedTokens = Math.ceil(summarizableTokens * 0.3);
    const tokensSaved = removableTokens + (summarizableTokens - summarizedTokens);

    const newTokens = currentTokens - tokensSaved;
    const newUtilization = (newTokens / tokenLimit) * 100;

    return {
      critical,
      summarizable,
      removable,
      tokensSaved,
      newUtilization: Math.round(newUtilization * 10) / 10
    };
  }

  compact(options: CompactionOptions): CompactionResult {
    const { strategy, preserveRecent = 5, targetUtilization, preserveCritical = true } = options;

    const chunks = this.healthMonitor.getChunks();
    const tokensBefore = this.healthMonitor.getCurrentTokens();

    // Separate chunks by type
    const recentChunks = chunks.slice(-preserveRecent);
    const olderChunks = chunks.slice(0, -preserveRecent);

    let relevanceThreshold: number;
    switch (strategy) {
      case 'aggressive':
        relevanceThreshold = RELEVANCE_THRESHOLD_AGGRESSIVE;
        break;
      case 'selective':
        relevanceThreshold = RELEVANCE_THRESHOLD_SELECTIVE;
        break;
      case 'summarize':
      default:
        relevanceThreshold = RELEVANCE_THRESHOLD_SUMMARIZE;
    }

    const toKeep: ContextChunk[] = [];
    const toSummarize: ContextChunk[] = [];
    const toRemove: ContextChunk[] = [];

    for (const chunk of olderChunks) {
      // Always preserve critical if flag is set
      if (preserveCritical && chunk.isCritical) {
        toKeep.push(chunk);
      } else if (chunk.relevanceScore >= relevanceThreshold) {
        if (strategy === 'aggressive') {
          toSummarize.push(chunk);
        } else {
          toKeep.push(chunk);
        }
      } else if (chunk.relevanceScore >= relevanceThreshold * 0.5 && strategy !== 'aggressive') {
        toSummarize.push(chunk);
      } else {
        toRemove.push(chunk);
      }
    }

    // Generate summaries for chunks to summarize
    const summaries = this.generateSummaries(toSummarize);

    // Calculate new token count
    const keptTokens = toKeep.reduce((sum, c) => sum + c.tokens, 0);
    const recentTokens = recentChunks.reduce((sum, c) => sum + c.tokens, 0);
    const summaryTokens = summaries.reduce((sum, s) => sum + estimateTokens(s), 0);

    const tokensAfter = keptTokens + recentTokens + summaryTokens;
    const tokensSaved = tokensBefore - tokensAfter;

    // Update the health monitor with new chunks
    this.healthMonitor.clearChunks();

    // Re-add kept chunks
    for (const chunk of toKeep) {
      this.healthMonitor.addChunk(chunk);
    }

    // Add summary chunks
    for (const summary of summaries) {
      this.healthMonitor.addChunk({
        content: summary,
        tokens: estimateTokens(summary),
        timestamp: new Date(),
        type: 'message'
      });
    }

    // Re-add recent chunks
    for (const chunk of recentChunks) {
      this.healthMonitor.addChunk(chunk);
    }

    const result: CompactionResult = {
      success: true,
      strategy,
      tokensBefore,
      tokensAfter,
      tokensSaved,
      preservedCritical: toKeep.filter(c => c.isCritical).length,
      summarizedChunks: toSummarize.length,
      removedChunks: toRemove.length,
      summaries
    };

    // Check if we hit target utilization — escalate without recursion
    if (targetUtilization) {
      const currentUtilization = (tokensAfter / this.healthMonitor.getTokenLimit()) * 100;
      if (currentUtilization > targetUtilization) {
        const nextStrategy = strategy === 'summarize' ? 'selective'
          : strategy === 'selective' ? 'aggressive'
          : null;

        if (nextStrategy) {
          return this.compact({ ...options, strategy: nextStrategy });
        }
        // aggressive already applied — return best-effort result
      }
    }

    return result;
  }

  private generateSummaries(chunks: ContextChunk[]): string[] {
    if (chunks.length === 0) return [];

    // Group chunks by type
    const grouped: Record<string, ContextChunk[]> = {};
    for (const chunk of chunks) {
      if (!grouped[chunk.type]) {
        grouped[chunk.type] = [];
      }
      grouped[chunk.type]!.push(chunk);
    }

    const summaries: string[] = [];

    for (const [type, typeChunks] of Object.entries(grouped)) {
      if (typeChunks.length === 0) continue;

      // Simple extractive summary: take key sentences
      const allContent = typeChunks.map(c => c.content).join(' ');
      const summary = this.extractiveSummarize(allContent, type);
      summaries.push(summary);
    }

    return summaries;
  }

  private extractiveSummarize(content: string, type: string): string {
    // Split into sentences
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

    if (sentences.length === 0) {
      return `[${type}]: ${content.slice(0, 100)}`;
    }

    // Score sentences by importance
    const scored = sentences.map(sentence => ({
      sentence,
      score: this.scoreSentence(sentence)
    }));

    // Sort by score and take top sentences
    scored.sort((a, b) => b.score - a.score);
    const topSentences = scored.slice(0, Math.min(3, sentences.length));

    // Sort back by original order for coherence
    const originalOrder = topSentences.sort((a, b) => {
      return sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence);
    });

    const summary = originalOrder.map(s => s.sentence).join('. ') + '.';

    return `[Summary - ${type}]: ${summary}`;
  }

  private scoreSentence(sentence: string): number {
    let score = 0;

    // Longer sentences might have more info (but not too long)
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 5 && wordCount <= 30) {
      score += 1;
    }

    // Contains important keywords
    const importantWords = [
      'decided', 'choose', 'use', 'implement', 'because', 'important',
      'must', 'should', 'require', 'need', 'critical', 'key'
    ];
    for (const word of importantWords) {
      if (sentence.toLowerCase().includes(word)) {
        score += 0.5;
      }
    }

    // Contains technical terms (likely important)
    const technicalPatterns = [
      /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/, // CamelCase
      /\b\w+\(\)/, // Function calls
      /`[^`]+`/ // Code markers
    ];
    for (const pattern of technicalPatterns) {
      if (pattern.test(sentence)) {
        score += 0.3;
      }
    }

    return score;
  }

  autoCompact(): CompactionResult {
    const health = this.healthMonitor.getHealth();

    // Determine strategy based on health
    let strategy: CompactionOptions['strategy'];
    let targetUtilization: number;

    if (health.health === 'critical') {
      strategy = 'aggressive';
      targetUtilization = 40;
    } else if (health.health === 'warning') {
      strategy = 'selective';
      targetUtilization = 50;
    } else {
      strategy = 'summarize';
      targetUtilization = 60;
    }

    return this.compact({
      strategy,
      preserveRecent: 10,
      targetUtilization,
      preserveCritical: true
    });
  }
}
