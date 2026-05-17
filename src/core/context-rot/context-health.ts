import type Database from 'better-sqlite3';
import type { ContextHealth, ContextChunk } from '../../types/documentation.js';
import { CriticalContextManager } from './critical-context.js';
import { estimateTokens as _estimateTokens } from '../../utils/token-counter.js';

// Default token limits (can be overridden)
const DEFAULT_TOKEN_LIMIT = 100000;

// Health thresholds
const UTILIZATION_WARNING = 0.7;   // 70%
const UTILIZATION_CRITICAL = 0.85; // 85%
const DRIFT_WARNING = 0.3;
const DRIFT_CRITICAL = 0.5;

export class ContextHealthMonitor {
  private db: Database.Database;
  private criticalManager: CriticalContextManager;
  private tokenLimit: number;

  // In-memory tracking for current session
  private contextChunks: ContextChunk[] = [];
  private currentTokens: number = 0;

  constructor(db: Database.Database, criticalManager: CriticalContextManager, tokenLimit?: number) {
    this.db = db;
    this.criticalManager = criticalManager;
    this.tokenLimit = tokenLimit || DEFAULT_TOKEN_LIMIT;
  }

  setTokenLimit(limit: number): void {
    this.tokenLimit = limit;
  }

  getTokenLimit(): number {
    return this.tokenLimit;
  }

  addChunk(chunk: Omit<ContextChunk, 'id' | 'relevanceScore' | 'isCritical'>): ContextChunk {
    const id = `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isCritical = this.criticalManager.isCritical(chunk.content);

    const fullChunk: ContextChunk = {
      ...chunk,
      id,
      relevanceScore: 1.0, // New chunks start with full relevance
      isCritical
    };

    this.contextChunks.push(fullChunk);
    this.currentTokens += chunk.tokens;

    // Decay relevance of older chunks
    this.decayRelevance();

    return fullChunk;
  }

  removeChunk(id: string): boolean {
    const index = this.contextChunks.findIndex(c => c.id === id);
    if (index === -1) return false;

    const chunk = this.contextChunks[index]!;
    this.currentTokens -= chunk.tokens;
    this.contextChunks.splice(index, 1);

    return true;
  }

  getChunks(): ContextChunk[] {
    return [...this.contextChunks];
  }

  clearChunks(): void {
    this.contextChunks = [];
    this.currentTokens = 0;
  }

  setCurrentTokens(tokens: number): void {
    this.currentTokens = tokens;
  }

  getCurrentTokens(): number {
    return this.currentTokens;
  }

  getHealth(driftScore: number = 0): ContextHealth {
    const tokensUsed = this.currentTokens;
    const utilizationPercent = (tokensUsed / this.tokenLimit) * 100;

    // Calculate relevance score (average of all chunks)
    const relevanceScore = this.contextChunks.length > 0
      ? this.contextChunks.reduce((sum, c) => sum + c.relevanceScore, 0) / this.contextChunks.length
      : 1.0;

    // Determine health status
    let health: ContextHealth['health'] = 'good';
    if (utilizationPercent >= UTILIZATION_CRITICAL * 100 || driftScore >= DRIFT_CRITICAL) {
      health = 'critical';
    } else if (utilizationPercent >= UTILIZATION_WARNING * 100 || driftScore >= DRIFT_WARNING) {
      health = 'warning';
    }

    // Check if compaction is needed
    const compactionNeeded = health !== 'good';
    const driftDetected = driftScore >= DRIFT_WARNING;

    // Generate suggestions
    const suggestions = this.generateSuggestions(health, utilizationPercent, driftScore);

    // Get critical context count
    const criticalContextCount = this.criticalManager.getCriticalCount();

    const healthResult: ContextHealth = {
      tokensUsed,
      tokensLimit: this.tokenLimit,
      utilizationPercent: Math.round(utilizationPercent * 10) / 10,
      health,
      relevanceScore: Math.round(relevanceScore * 100) / 100,
      driftScore: Math.round(driftScore * 100) / 100,
      criticalContextCount,
      driftDetected,
      compactionNeeded,
      suggestions
    };

    // Log to history
    this.logHealthCheck(healthResult);

    return healthResult;
  }

  private generateSuggestions(
    health: ContextHealth['health'],
    utilization: number,
    driftScore: number
  ): string[] {
    const suggestions: string[] = [];

    if (health === 'good') {
      suggestions.push('Context is healthy, no action needed');
      return suggestions;
    }

    if (utilization >= UTILIZATION_CRITICAL * 100) {
      suggestions.push('Context nearly full - compaction strongly recommended');
      suggestions.push('Consider using "aggressive" compaction strategy');
    } else if (utilization >= UTILIZATION_WARNING * 100) {
      suggestions.push('Context getting large - consider compaction');
      suggestions.push('Use "summarize" strategy to compress old context');
    }

    if (driftScore >= DRIFT_CRITICAL) {
      suggestions.push('Significant drift detected - AI may be ignoring earlier instructions');
      suggestions.push('Review critical context and add reminders if needed');
    } else if (driftScore >= DRIFT_WARNING) {
      suggestions.push('Some drift detected - consider marking critical items');
    }

    const criticalCount = this.criticalManager.getCriticalCount();
    if (criticalCount === 0) {
      suggestions.push('No critical context marked - consider marking important decisions/requirements');
    }

    return suggestions;
  }

  private decayRelevance(): void {
    // Decay relevance of chunks based on position (older = lower relevance)
    const totalChunks = this.contextChunks.length;

    for (let i = 0; i < totalChunks; i++) {
      const chunk = this.contextChunks[i]!;

      // Critical chunks decay slower
      const decayRate = chunk.isCritical ? 0.98 : 0.95;

      // Position-based decay (older chunks have lower position)
      const positionFactor = (i + 1) / totalChunks;

      // New relevance is combination of decay and position
      chunk.relevanceScore = Math.max(0.1, chunk.relevanceScore * decayRate * (0.5 + 0.5 * positionFactor));
    }
  }

  private logHealthCheck(health: ContextHealth): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO context_health_history
        (tokens_used, tokens_limit, utilization_percent, drift_score, relevance_score, health, compaction_triggered)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        health.tokensUsed,
        health.tokensLimit,
        health.utilizationPercent,
        health.driftScore,
        health.relevanceScore,
        health.health,
        0
      );
    } catch {
      // Ignore logging errors
    }
  }

  getHealthHistory(limit: number = 20): Array<{
    timestamp: Date;
    health: ContextHealth['health'];
    utilizationPercent: number;
    driftScore: number;
  }> {
    try {
      const stmt = this.db.prepare(`
        SELECT timestamp, health, utilization_percent, drift_score
        FROM context_health_history
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const rows = stmt.all(limit) as Array<{
        timestamp: number;
        health: string;
        utilization_percent: number;
        drift_score: number;
      }>;

      return rows.map(row => ({
        timestamp: new Date(row.timestamp * 1000),
        health: row.health as ContextHealth['health'],
        utilizationPercent: row.utilization_percent,
        driftScore: row.drift_score
      }));
    } catch {
      return [];
    }
  }

  estimateTokens(text: string): number {
    return _estimateTokens(text);
  }
}
