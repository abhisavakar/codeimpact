import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Tier2Storage } from '../../storage/tier2.js';
import type { EmbeddingGenerator } from '../../indexing/embeddings.js';
import type { Change, Bug, PastBug, Diagnosis } from '../../types/documentation.js';
import type { ChangeTracker } from './change-tracker.js';

// Common error patterns and their likely causes
const ERROR_PATTERNS = [
  {
    pattern: /cannot read (?:property |properties of )['"]?(\w+)['"]? of (?:undefined|null)/i,
    keywords: ['null check', 'undefined', 'optional chaining', '?.'],
    likelyCause: 'Missing null/undefined check'
  },
  {
    pattern: /(\w+) is not defined/i,
    keywords: ['import', 'require', 'declaration'],
    likelyCause: 'Missing import or variable declaration'
  },
  {
    pattern: /(\w+) is not a function/i,
    keywords: ['function', 'method', 'call', '()'],
    likelyCause: 'Function doesn\'t exist or wrong type'
  },
  {
    pattern: /unexpected token/i,
    keywords: ['syntax', 'parse', 'JSON'],
    likelyCause: 'Syntax error or malformed data'
  },
  {
    pattern: /timeout|timed out/i,
    keywords: ['timeout', 'async', 'await', 'connection'],
    likelyCause: 'Slow operation or connection issue'
  },
  {
    pattern: /ECONNREFUSED|connection refused/i,
    keywords: ['connection', 'port', 'server', 'database'],
    likelyCause: 'Service not running or wrong port'
  },
  {
    pattern: /out of memory|heap/i,
    keywords: ['memory', 'leak', 'buffer', 'array'],
    likelyCause: 'Memory leak or large data processing'
  },
  {
    pattern: /permission denied|EACCES/i,
    keywords: ['permission', 'access', 'chmod', 'sudo'],
    likelyCause: 'Missing permissions'
  },
  {
    pattern: /module not found|cannot find module/i,
    keywords: ['import', 'require', 'package', 'node_modules'],
    likelyCause: 'Missing dependency or wrong import path'
  },
  {
    pattern: /type.*is not assignable/i,
    keywords: ['type', 'interface', 'TypeScript'],
    likelyCause: 'Type mismatch'
  }
];

export class BugCorrelator {
  private db: Database.Database;
  private changeTracker: ChangeTracker;
  private tier2: Tier2Storage;
  private embeddingGenerator: EmbeddingGenerator;

  constructor(
    db: Database.Database,
    changeTracker: ChangeTracker,
    tier2: Tier2Storage,
    embeddingGenerator: EmbeddingGenerator
  ) {
    this.db = db;
    this.changeTracker = changeTracker;
    this.tier2 = tier2;
    this.embeddingGenerator = embeddingGenerator;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bug_history (
        id TEXT PRIMARY KEY,
        error TEXT NOT NULL,
        stack_trace TEXT,
        file TEXT,
        line INTEGER,
        timestamp INTEGER NOT NULL,
        status TEXT DEFAULT 'open',
        related_changes TEXT,
        fixed_by TEXT,
        fixed_at INTEGER,
        fix_diff TEXT,
        cause TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bug_timestamp ON bug_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_bug_status ON bug_history(status);

      CREATE VIRTUAL TABLE IF NOT EXISTS bug_fts USING fts5(
        error,
        stack_trace,
        cause,
        content='bug_history',
        content_rowid='rowid'
      );
    `);
  }

  // Record a bug
  recordBug(error: string, options?: {
    stackTrace?: string;
    file?: string;
    line?: number;
    relatedChanges?: string[];
  }): Bug {
    const timestamp = Math.floor(Date.now() / 1000);

    // Deduplicate: if the same error was recorded within the last hour, return existing
    const existing = this.db.prepare(
      'SELECT id, error, stack_trace, file, line, timestamp, status, related_changes FROM bug_history WHERE error = ? AND timestamp > ? LIMIT 1'
    ).get(error, timestamp - 3600) as { id: string; error: string; stack_trace: string | null; file: string | null; line: number | null; timestamp: number; status: string; related_changes: string } | undefined;

    if (existing) {
      return {
        id: existing.id,
        error: existing.error,
        stackTrace: existing.stack_trace || undefined,
        file: existing.file || undefined,
        line: existing.line || undefined,
        timestamp: new Date(existing.timestamp * 1000),
        status: existing.status as Bug['status'],
        relatedChanges: JSON.parse(existing.related_changes || '[]')
      };
    }

    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO bug_history (id, error, stack_trace, file, line, timestamp, status, related_changes)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(
      id,
      error,
      options?.stackTrace || null,
      options?.file || null,
      options?.line || null,
      timestamp,
      JSON.stringify(options?.relatedChanges || [])
    );

    return {
      id,
      error,
      stackTrace: options?.stackTrace,
      file: options?.file,
      line: options?.line,
      timestamp: new Date(timestamp * 1000),
      status: 'open',
      relatedChanges: options?.relatedChanges || []
    };
  }

  // Record a fix for a bug
  recordFix(bugId: string, fixDiff: string, cause?: string): boolean {
    const result = this.db.prepare(`
      UPDATE bug_history
      SET status = 'fixed', fixed_at = ?, fix_diff = ?, cause = ?
      WHERE id = ?
    `).run(
      Math.floor(Date.now() / 1000),
      fixDiff,
      cause || null,
      bugId
    );

    return result.changes > 0;
  }

  // Diagnose a bug
  diagnoseBug(error: string, options?: { file?: string; line?: number }): Diagnosis {
    // 1. Extract keywords from error
    const keywords = this.extractKeywords(error);

    // 2. Find recent changes that might be related
    const recentChanges = this.changeTracker.getRecentChanges(48); // Last 48 hours
    const relevantChanges = this.findRelevantChanges(recentChanges, keywords, options?.file);

    // 3. Score and rank changes
    const scoredChanges = this.scoreChanges(relevantChanges, error, keywords, options);

    // 4. Find similar past bugs
    const pastBugs = this.findSimilarBugs(error);

    // 5. Generate diagnosis
    const likelyCause = scoredChanges.length > 0 ? scoredChanges[0].change : null;
    const confidence = scoredChanges.length > 0 ? scoredChanges[0].score : 0;

    // 6. Generate reasoning
    const reasoning = this.generateReasoning(error, likelyCause, pastBugs, keywords);

    // 7. Suggest fix if we have past fixes
    const suggestedFix = this.getSuggestedFix(pastBugs, error);

    return {
      likelyCause,
      confidence: Math.round(confidence),
      relatedChanges: scoredChanges.slice(1, 5).map(s => s.change),
      pastSimilarBugs: pastBugs.slice(0, 5),
      suggestedFix,
      reasoning
    };
  }

  private extractKeywords(error: string): string[] {
    const keywords: string[] = [];

    // Extract from error patterns
    for (const { pattern, keywords: patternKeywords } of ERROR_PATTERNS) {
      if (pattern.test(error)) {
        keywords.push(...patternKeywords);
      }
    }

    // Extract identifiers (variable/function names)
    const identifiers = error.match(/['"`](\w+)['"`]/g);
    if (identifiers) {
      keywords.push(...identifiers.map(i => i.replace(/['"`]/g, '')));
    }

    // Extract file paths
    const paths = error.match(/[\w\-./]+\.(ts|js|tsx|jsx)/g);
    if (paths) {
      keywords.push(...paths);
    }

    // Extract line numbers
    const lineNums = error.match(/line\s*(\d+)/gi);
    if (lineNums) {
      keywords.push(...lineNums);
    }

    // Add common error-related words
    const words = error.toLowerCase().split(/\s+/);
    const significantWords = words.filter(w =>
      w.length > 3 &&
      !['error', 'the', 'and', 'for', 'with', 'from'].includes(w)
    );
    keywords.push(...significantWords.slice(0, 10));

    return [...new Set(keywords)];
  }

  private findRelevantChanges(changes: Change[], keywords: string[], file?: string): Change[] {
    return changes.filter(change => {
      // Priority 1: File match
      if (file && change.file.includes(file)) {
        return true;
      }

      // Priority 2: Keyword in diff or file
      const changeText = `${change.file} ${change.diff} ${change.commitMessage}`.toLowerCase();
      return keywords.some(k => changeText.includes(k.toLowerCase()));
    });
  }

  private scoreChanges(
    changes: Change[],
    error: string,
    keywords: string[],
    options?: { file?: string; line?: number }
  ): Array<{ change: Change; score: number }> {
    return changes.map(change => {
      let score = 0;

      // File match (high weight)
      if (options?.file && change.file.includes(options.file)) {
        score += 40;
      }

      // Recency (more recent = higher score)
      const hoursAgo = (Date.now() - change.timestamp.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 2) score += 30;
      else if (hoursAgo < 6) score += 20;
      else if (hoursAgo < 24) score += 10;

      // Keyword matches in diff
      const diffLower = change.diff.toLowerCase();
      let keywordMatches = 0;
      for (const keyword of keywords) {
        if (diffLower.includes(keyword.toLowerCase())) {
          keywordMatches++;
        }
      }
      score += Math.min(keywordMatches * 5, 20);

      // Error pattern match
      for (const { pattern, likelyCause } of ERROR_PATTERNS) {
        if (pattern.test(error)) {
          // Check if diff contains related changes
          if (diffLower.includes('null') || diffLower.includes('undefined') ||
              diffLower.includes('?.') || diffLower.includes('if (')) {
            score += 15;
          }
        }
      }

      // Deletion score (deletions often cause bugs)
      if (change.linesRemoved > change.linesAdded) {
        score += 10;
      }

      return { change, score };
    }).sort((a, b) => b.score - a.score);
  }

  // Find similar bugs from history
  findSimilarBugs(error: string, limit: number = 5): PastBug[] {
    try {
      // Simple text search
      const keywords = error.split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 5)
        .join(' OR ');

      if (!keywords) return [];

      const rows = this.db.prepare(`
        SELECT id, error, cause, fix_diff, file, timestamp, status
        FROM bug_history
        WHERE status = 'fixed' AND (
          error LIKE ? OR
          error LIKE ? OR
          error LIKE ?
        )
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(
        `%${error.slice(0, 30)}%`,
        `%${error.split(' ')[0]}%`,
        `%${error.split(':')[0]}%`,
        limit
      ) as Array<{
        id: string;
        error: string;
        cause: string | null;
        fix_diff: string | null;
        file: string | null;
        timestamp: number;
        status: string;
      }>;

      return rows.map(row => ({
        id: row.id,
        error: row.error,
        cause: row.cause || undefined,
        fix: row.cause || undefined,
        fixDiff: row.fix_diff || undefined,
        file: row.file || undefined,
        date: new Date(row.timestamp * 1000),
        similarity: this.calculateSimilarity(error, row.error)
      })).filter(bug => bug.similarity > 30);
    } catch {
      return [];
    }
  }

  private calculateSimilarity(error1: string, error2: string): number {
    const words1 = new Set(error1.toLowerCase().split(/\s+/));
    const words2 = new Set(error2.toLowerCase().split(/\s+/));

    let matches = 0;
    for (const word of words1) {
      if (words2.has(word)) matches++;
    }

    const total = Math.max(words1.size, words2.size);
    return total > 0 ? Math.round((matches / total) * 100) : 0;
  }

  private generateReasoning(
    error: string,
    likelyCause: Change | null,
    pastBugs: PastBug[],
    keywords: string[]
  ): string {
    const parts: string[] = [];

    if (likelyCause) {
      const hoursAgo = Math.round((Date.now() - likelyCause.timestamp.getTime()) / (1000 * 60 * 60));
      parts.push(`Found likely cause in ${likelyCause.file} (changed ${hoursAgo}h ago)`);

      // Check for specific patterns
      const diff = likelyCause.diff.toLowerCase();
      if (diff.includes('-') && (diff.includes('if') || diff.includes('null') || diff.includes('?.'))) {
        parts.push('A null/undefined check may have been removed');
      }
      if (likelyCause.linesRemoved > likelyCause.linesAdded) {
        parts.push('Code was removed which might have broken functionality');
      }
    } else {
      parts.push('Could not identify a specific recent change as the cause');
    }

    if (pastBugs.length > 0) {
      parts.push(`Found ${pastBugs.length} similar bug(s) in history`);
      if (pastBugs[0].fix) {
        parts.push(`Previous fix: ${pastBugs[0].fix}`);
      }
    }

    // Add error pattern insight
    for (const { pattern, likelyCause: cause } of ERROR_PATTERNS) {
      if (pattern.test(error)) {
        parts.push(`Error type suggests: ${cause}`);
        break;
      }
    }

    return parts.join('. ');
  }

  private getSuggestedFix(pastBugs: PastBug[], _error: string): string | null {
    if (pastBugs.length === 0) return null;

    const bestMatch = pastBugs.find(bug => bug.fix || bug.fixDiff);
    if (bestMatch) {
      if (bestMatch.fix) return bestMatch.fix;
      if (bestMatch.fixDiff) return `Apply similar fix:\n${bestMatch.fixDiff.slice(0, 200)}`;
    }

    return null;
  }

  /**
   * Scan git history for fix commits and auto-record as bugs
   * Looks for commits with "fix:", "bugfix:", "hotfix:" prefixes or "fixes #" references
   */
  scanForBugFixes(): number {
    try {
      // Get commits from change_history that look like bug fixes
      const fixCommits = this.db.prepare(`
        SELECT DISTINCT commit_hash, commit_message, file, diff, timestamp
        FROM change_history
        WHERE (
          LOWER(commit_message) LIKE 'fix:%' OR
          LOWER(commit_message) LIKE 'fix(%' OR
          LOWER(commit_message) LIKE 'bugfix:%' OR
          LOWER(commit_message) LIKE 'hotfix:%' OR
          LOWER(commit_message) LIKE '%fixes #%' OR
          LOWER(commit_message) LIKE '%fixed #%' OR
          LOWER(commit_message) LIKE '%closes #%'
        )
        ORDER BY timestamp DESC
        LIMIT 50
      `).all() as Array<{
        commit_hash: string;
        commit_message: string;
        file: string;
        diff: string | null;
        timestamp: number;
      }>;

      let recorded = 0;

      for (const commit of fixCommits) {
        // Check if we already have this bug recorded (by commit hash in related_changes)
        const existing = this.db.prepare(`
          SELECT id FROM bug_history
          WHERE fixed_by = ? OR related_changes LIKE ?
        `).get(commit.commit_hash, `%${commit.commit_hash}%`);

        if (existing) continue;

        // Extract the bug description from commit message
        const errorDescription = this.extractErrorFromCommitMessage(commit.commit_message);

        // Record the bug as already fixed
        const id = randomUUID();

        this.db.prepare(`
          INSERT INTO bug_history (id, error, file, timestamp, status, fixed_by, fixed_at, fix_diff, cause)
          VALUES (?, ?, ?, ?, 'fixed', ?, ?, ?, ?)
        `).run(
          id,
          errorDescription,
          commit.file,
          commit.timestamp,
          commit.commit_hash,
          commit.timestamp,
          commit.diff?.slice(0, 2000) || null,
          commit.commit_message
        );

        recorded++;
      }

      return recorded;
    } catch {
      return 0;
    }
  }

  /**
   * Extract a bug/error description from a fix commit message
   */
  private extractErrorFromCommitMessage(message: string): string {
    // Remove common prefixes
    let cleaned = message
      .replace(/^fix\s*[:\(]/i, '')
      .replace(/^bugfix\s*[:\(]/i, '')
      .replace(/^hotfix\s*[:\(]/i, '')
      .replace(/\):\s*/, ': ')
      .trim();

    // Extract issue references
    const issueMatch = cleaned.match(/(?:fixes|fixed|closes)\s*#(\d+)/i);
    if (issueMatch) {
      cleaned = cleaned.replace(/(?:fixes|fixed|closes)\s*#\d+/gi, '').trim();
      if (cleaned) {
        cleaned = `Issue #${issueMatch[1]}: ${cleaned}`;
      } else {
        cleaned = `Issue #${issueMatch[1]}`;
      }
    }

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned || message;
  }

  // Get bug statistics
  getBugStats(): {
    total: number;
    open: number;
    fixed: number;
    avgTimeToFix: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as fixed,
        AVG(CASE WHEN status = 'fixed' THEN fixed_at - timestamp ELSE NULL END) as avg_fix_time
      FROM bug_history
    `).get() as {
      total: number;
      open: number;
      fixed: number;
      avg_fix_time: number | null;
    };

    return {
      total: stats.total,
      open: stats.open,
      fixed: stats.fixed,
      avgTimeToFix: stats.avg_fix_time ? Math.round(stats.avg_fix_time / 3600) : 0 // hours
    };
  }
}
