/**
 * Déjà Vu Detection - Similar Problem Recognition
 *
 * Detects when a query or code pattern is similar to something solved before.
 * Surfaces past solutions to prevent reinventing the wheel.
 * "You solved a similar problem 2 weeks ago in auth.ts"
 */

import type Database from 'better-sqlite3';
import type { EmbeddingGenerator } from '../indexing/embeddings.js';
import type { Tier2Storage } from '../storage/tier2.js';
import { createHash } from 'crypto';
import { formatTimeAgoWithContext } from '../utils/time.js';

export interface DejaVuMatch {
  type: 'query' | 'solution' | 'fix' | 'pattern';
  similarity: number;
  when: Date;
  file: string;
  snippet: string;
  message: string;
  context?: string;
}

export interface PastQuery {
  queryHash: string;
  queryText: string;
  resultFiles: string[];
  timestamp: Date;
  wasUseful: boolean;
  usefulness: number;
}

export interface PastSolution {
  file: string;
  snippet: string;
  query: string;
  timestamp: Date;
  similarity: number;
}

interface QueryPatternRow {
  id: number;
  query_hash: string;
  query_text: string;
  result_files: string;
  hit_count: number;
  avg_usefulness: number;
  last_used: number;
}

interface UsageEventRow {
  id: number;
  event_type: string;
  file_path: string | null;
  query: string | null;
  context_used: number;
  timestamp: number;
}

export class DejaVuDetector {
  private db: Database.Database;
  private tier2: Tier2Storage;
  private embeddingGenerator: EmbeddingGenerator;

  // Thresholds
  private readonly SIMILARITY_THRESHOLD = 0.7;
  private readonly MIN_USEFULNESS = 0.3;
  private readonly MAX_AGE_DAYS = 90;
  private readonly MIN_AGE_SECONDS = 60; // Exclude queries from last minute (prevents self-matching)

  // Files to filter from context (stubs, configs, generated files)
  private readonly STUB_FILE_PATTERNS = [
    /__init__\.py$/,           // Python package stubs
    /\.d\.ts$/,                // TypeScript declaration files
    /\.config\.(js|ts|mjs)$/,  // Config files
    /next-env\.d\.ts$/,        // Next.js generated
    /package-lock\.json$/,
    /yarn\.lock$/,
  ];

  constructor(
    db: Database.Database,
    tier2: Tier2Storage,
    embeddingGenerator: EmbeddingGenerator
  ) {
    this.db = db;
    this.tier2 = tier2;
    this.embeddingGenerator = embeddingGenerator;
  }

  /**
   * Find similar past problems, solutions, and fixes
   */
  async findSimilar(query: string, limit: number = 3): Promise<DejaVuMatch[]> {
    const matches: DejaVuMatch[] = [];

    // Run searches in parallel
    const [pastQueries, pastSolutions, pastFixes] = await Promise.all([
      this.searchPastQueries(query),
      this.searchPastSolutions(query),
      this.searchPastFixes(query),
    ]);

    matches.push(...pastQueries, ...pastSolutions, ...pastFixes);

    // Sort by similarity and recency
    return matches
      .sort((a, b) => {
        // Weight similarity higher, but give bonus to more recent
        const recencyA = this.getRecencyScore(a.when);
        const recencyB = this.getRecencyScore(b.when);
        const scoreA = a.similarity * 0.7 + recencyA * 0.3;
        const scoreB = b.similarity * 0.7 + recencyB * 0.3;
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * Search for similar past queries with high usefulness
   */
  async searchPastQueries(query: string): Promise<DejaVuMatch[]> {
    const matches: DejaVuMatch[] = [];
    const currentQueryHash = this.hashQuery(query);

    try {
      // Get query embedding
      const embedding = await this.embeddingGenerator.embed(query);

      // Get recent useful queries - exclude very recent ones to prevent self-matching
      const stmt = this.db.prepare(`
        SELECT query_hash, query_text, result_files, avg_usefulness, last_used
        FROM query_patterns
        WHERE avg_usefulness >= ?
          AND last_used > unixepoch() - ? * 86400
          AND last_used < unixepoch() - ?
        ORDER BY avg_usefulness DESC, last_used DESC
        LIMIT 50
      `);

      const rows = stmt.all(this.MIN_USEFULNESS, this.MAX_AGE_DAYS, this.MIN_AGE_SECONDS) as QueryPatternRow[];

      for (const row of rows) {
        // Skip if this is the exact same query (by hash)
        if (row.query_hash === currentQueryHash) {
          continue;
        }

        // Calculate text similarity
        const similarity = this.calculateTextSimilarity(query, row.query_text);

        // Skip near-identical queries (similarity > 0.95 means it's basically the same question)
        if (similarity > 0.95) {
          continue;
        }

        if (similarity >= this.SIMILARITY_THRESHOLD) {
          const resultFiles = this.parseJsonArray(row.result_files);
          // Filter out stub files from results
          const meaningfulFiles = this.filterMeaningfulFiles(resultFiles);
          const primaryFile = meaningfulFiles[0] || resultFiles[0] || 'unknown';
          const contextFiles = meaningfulFiles.slice(1, 4);

          matches.push({
            type: 'query',
            similarity,
            when: new Date(row.last_used * 1000),
            file: primaryFile,
            snippet: row.query_text.slice(0, 100),
            message: formatTimeAgoWithContext(new Date(row.last_used * 1000), 'asked a similar question', primaryFile),
            context: contextFiles.length > 0 ? `Also involved: ${contextFiles.join(', ')}` : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error searching past queries:', error);
    }

    return matches;
  }

  /**
   * Search for past solutions to similar problems
   */
  async searchPastSolutions(query: string): Promise<DejaVuMatch[]> {
    const matches: DejaVuMatch[] = [];

    try {
      // Search codebase for semantically similar content
      const embedding = await this.embeddingGenerator.embed(query);
      const searchResults = this.tier2.search(embedding, 10);

      // Find results that were previously part of useful context
      for (const result of searchResults) {
        if (result.similarity < this.SIMILARITY_THRESHOLD) continue;

        // Check if this file was used in a useful query before
        const usageStmt = this.db.prepare(`
          SELECT ue.query, ue.timestamp, qp.avg_usefulness
          FROM usage_events ue
          LEFT JOIN query_patterns qp ON ue.query = qp.query_text
          WHERE ue.file_path = ?
            AND ue.event_type = 'context_used'
            AND ue.timestamp > unixepoch() - ? * 86400
            AND (qp.avg_usefulness IS NULL OR qp.avg_usefulness >= ?)
          ORDER BY ue.timestamp DESC
          LIMIT 1
        `);

        const usage = usageStmt.get(result.file, this.MAX_AGE_DAYS, this.MIN_USEFULNESS) as {
          query: string;
          timestamp: number;
          avg_usefulness: number | null;
        } | undefined;

        if (usage) {
          matches.push({
            type: 'solution',
            similarity: result.similarity,
            when: new Date(usage.timestamp * 1000),
            file: result.file,
            snippet: result.preview.slice(0, 150),
            message: formatTimeAgoWithContext(new Date(usage.timestamp * 1000), 'worked on this', result.file),
            context: usage.query ? `For: "${usage.query.slice(0, 50)}..."` : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error searching past solutions:', error);
    }

    return matches;
  }

  /**
   * Search for past bug fixes with similar error patterns
   */
  async searchPastFixes(query: string): Promise<DejaVuMatch[]> {
    const matches: DejaVuMatch[] = [];

    // Check if query looks like an error
    if (!this.looksLikeError(query)) {
      return matches;
    }

    try {
      // Search for similar error queries
      const stmt = this.db.prepare(`
        SELECT ue.query, ue.file_path, ue.timestamp, qp.result_files
        FROM usage_events ue
        LEFT JOIN query_patterns qp ON ue.query = qp.query_text
        WHERE ue.event_type = 'query'
          AND (ue.query LIKE '%error%' OR ue.query LIKE '%fix%' OR ue.query LIKE '%bug%')
          AND ue.timestamp > unixepoch() - ? * 86400
        ORDER BY ue.timestamp DESC
        LIMIT 100
      `);

      const rows = stmt.all(this.MAX_AGE_DAYS) as Array<{
        query: string;
        file_path: string | null;
        timestamp: number;
        result_files: string | null;
      }>;

      for (const row of rows) {
        if (!row.query) continue;

        const similarity = this.calculateTextSimilarity(query, row.query);

        if (similarity >= this.SIMILARITY_THRESHOLD * 0.8) { // Slightly lower threshold for errors
          const resultFiles = row.result_files ? this.parseJsonArray(row.result_files) : [];
          const file = row.file_path || resultFiles[0] || 'unknown';

          matches.push({
            type: 'fix',
            similarity,
            when: new Date(row.timestamp * 1000),
            file,
            snippet: row.query.slice(0, 100),
            message: formatTimeAgoWithContext(new Date(row.timestamp * 1000), 'encountered a similar issue', file),
          });
        }
      }
    } catch (error) {
      console.error('Error searching past fixes:', error);
    }

    return matches;
  }

  /**
   * Record that a query was made (for future déjà vu detection)
   */
  recordQuery(query: string, files: string[], wasUseful?: boolean): void {
    try {
      const queryHash = this.hashQuery(query);

      const stmt = this.db.prepare(`
        INSERT INTO query_patterns (query_hash, query_text, result_files, hit_count, last_used)
        VALUES (?, ?, ?, 1, unixepoch())
        ON CONFLICT(query_hash) DO UPDATE SET
          hit_count = hit_count + 1,
          last_used = unixepoch()
      `);

      stmt.run(queryHash, query, JSON.stringify(files));

      // Update usefulness if provided
      if (wasUseful !== undefined) {
        this.updateUsefulness(queryHash, wasUseful);
      }
    } catch (error) {
      console.error('Error recording query:', error);
    }
  }

  /**
   * Update usefulness score for a query
   */
  updateUsefulness(queryHashOrText: string, wasUseful: boolean): void {
    try {
      const queryHash = queryHashOrText.length === 16
        ? queryHashOrText
        : this.hashQuery(queryHashOrText);

      // Exponential moving average
      const alpha = 0.3;
      const newScore = wasUseful ? 1.0 : 0.0;

      const stmt = this.db.prepare(`
        UPDATE query_patterns
        SET avg_usefulness = avg_usefulness * (1 - ?) + ? * ?
        WHERE query_hash = ?
      `);

      stmt.run(alpha, alpha, newScore, queryHash);
    } catch (error) {
      console.error('Error updating usefulness:', error);
    }
  }

  /**
   * Get déjà vu statistics
   */
  getStats(): { totalQueries: number; usefulQueries: number; avgUsefulness: number } {
    try {
      const stmt = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN avg_usefulness >= ? THEN 1 ELSE 0 END) as useful,
          AVG(avg_usefulness) as avg_useful
        FROM query_patterns
        WHERE last_used > unixepoch() - ? * 86400
      `);

      const result = stmt.get(this.MIN_USEFULNESS, this.MAX_AGE_DAYS) as {
        total: number;
        useful: number;
        avg_useful: number;
      };

      return {
        totalQueries: result.total || 0,
        usefulQueries: result.useful || 0,
        avgUsefulness: result.avg_useful || 0,
      };
    } catch {
      return { totalQueries: 0, usefulQueries: 0, avgUsefulness: 0 };
    }
  }

  // ========== Private Methods ==========

  private calculateTextSimilarity(a: string, b: string): number {
    // Normalize texts
    const normalizeText = (text: string) =>
      text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    const wordsA = new Set(normalizeText(a));
    const wordsB = new Set(normalizeText(b));

    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }

    // Jaccard similarity
    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        intersection++;
      }
    }

    const union = wordsA.size + wordsB.size - intersection;
    return intersection / union;
  }

  private looksLikeError(query: string): boolean {
    const errorPatterns = [
      /error/i,
      /exception/i,
      /failed/i,
      /failing/i,
      /broken/i,
      /fix/i,
      /bug/i,
      /issue/i,
      /not working/i,
      /doesn't work/i,
      /crash/i,
      /undefined/i,
      /null/i,
      /NaN/i,
      /TypeError/i,
      /ReferenceError/i,
      /SyntaxError/i,
    ];

    return errorPatterns.some(pattern => pattern.test(query));
  }

  private getRecencyScore(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Exponential decay: score of 1 for today, approaching 0 at MAX_AGE_DAYS
    return Math.exp(-diffDays / (this.MAX_AGE_DAYS / 3));
  }

  private parseJsonArray(json: string | null): string[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Filter out stub/config files from file list
   */
  private filterMeaningfulFiles(files: string[]): string[] {
    return files.filter(file => {
      // Check against stub patterns
      for (const pattern of this.STUB_FILE_PATTERNS) {
        if (pattern.test(file)) {
          return false;
        }
      }
      return true;
    });
  }

  private hashQuery(query: string): string {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    return createHash('md5').update(normalized).digest('hex').slice(0, 16);
  }
}
