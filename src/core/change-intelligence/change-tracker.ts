import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Change, ChangeQueryResult, ChangeQueryOptions } from '../../types/documentation.js';

export class ChangeTracker {
  private projectPath: string;
  private db: Database.Database;

  constructor(projectPath: string, db: Database.Database) {
    this.projectPath = projectPath;
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS change_history (
        id TEXT PRIMARY KEY,
        file TEXT NOT NULL,
        diff TEXT,
        timestamp INTEGER NOT NULL,
        author TEXT,
        commit_hash TEXT,
        commit_message TEXT,
        lines_added INTEGER DEFAULT 0,
        lines_removed INTEGER DEFAULT 0,
        change_type TEXT DEFAULT 'modify'
      );
      CREATE INDEX IF NOT EXISTS idx_change_timestamp ON change_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_change_file ON change_history(file);
      CREATE INDEX IF NOT EXISTS idx_change_commit ON change_history(commit_hash);
    `);
  }

  // Sync changes from git history
  syncFromGit(limit: number = 100): number {
    try {
      // Get recent commits
      const logOutput = execFileSync(
        'git', ['log', '--oneline', `-${limit}`, '--format=%H|%an|%ad|%s', '--date=unix'],
        { cwd: this.projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      ).trim();

      if (!logOutput) return 0;

      const commits = logOutput.split('\n').filter(Boolean);
      let synced = 0;

      for (const commitLine of commits) {
        const parts = commitLine.split('|');
        const hash = parts[0] ?? '';
        const author = parts[1] ?? '';
        const dateStr = parts[2] ?? '';
        const message = parts.slice(3).join('|');
        const timestamp = parseInt(dateStr, 10);

        if (!hash) continue;

        // Check if already synced
        const existing = this.db.prepare(
          'SELECT id FROM change_history WHERE commit_hash = ?'
        ).get(hash);

        if (existing) continue;

        // Get files changed in this commit
        try {
          const filesOutput = execFileSync(
            'git', ['show', '--numstat', '--format=', hash],
            { cwd: this.projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
          ).trim();

          if (!filesOutput) continue;

          const files = filesOutput.split('\n').filter(Boolean);

          for (const fileLine of files) {
            const tabParts = fileLine.split('\t');
            const added = tabParts[0] ?? '0';
            const removed = tabParts[1] ?? '0';
            const filePath = tabParts[2];
            if (!filePath) continue;

            // Get diff for this file (cross-platform, no pipe to head)
            let diff = '';
            try {
              const fullDiff = execFileSync(
                'git', ['show', hash, '--', filePath],
                { cwd: this.projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
              );
              // Limit to first 100 lines and 2000 chars
              const lines = fullDiff.split('\n');
              const truncatedByLines = lines.length > 100;
              diff = lines.slice(0, 100).join('\n').slice(0, 2000);
              if (truncatedByLines || fullDiff.length > 2000) {
                console.error(`[ChangeTracker] Diff truncated for ${filePath} in ${hash} (${lines.length} lines, ${fullDiff.length} chars)`);
              }
            } catch {
              // Ignore diff errors
            }

            const linesAdded = added === '-' ? 0 : parseInt(added, 10) || 0;
            const linesRemoved = removed === '-' ? 0 : parseInt(removed, 10) || 0;
            const changeType = this.inferChangeType(linesAdded, linesRemoved, filePath);

            this.db.prepare(`
              INSERT INTO change_history (id, file, diff, timestamp, author, commit_hash, commit_message, lines_added, lines_removed, change_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              randomUUID(),
              filePath,
              diff,
              timestamp,
              author,
              hash,
              message,
              linesAdded,
              linesRemoved,
              changeType
            );

            synced++;
          }
        } catch {
          // Skip commits that fail
        }
      }

      return synced;
    } catch (error) {
      console.error('Error syncing git history:', error);
      return 0;
    }
  }

  private inferChangeType(added: number, removed: number, _filePath: string): Change['type'] {
    if (removed === 0 && added > 0) return 'add';
    if (added === 0 && removed > 0) return 'delete';
    return 'modify';
  }

  // Query changes
  queryChanges(options: ChangeQueryOptions = {}): ChangeQueryResult {
    const since = this.parseSince(options.since || 'this week');
    const until = options.until || new Date();

    let query = `
      SELECT id, file, diff, timestamp, author, commit_hash, commit_message, lines_added, lines_removed, change_type
      FROM change_history
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    const params: (string | number)[] = [
      Math.floor(since.getTime() / 1000),
      Math.floor(until.getTime() / 1000)
    ];

    if (options.file) {
      query += ' AND file LIKE ?';
      params.push(`%${options.file}%`);
    }

    if (options.author) {
      query += ' AND author LIKE ?';
      params.push(`%${options.author}%`);
    }

    if (options.type) {
      query += ' AND change_type = ?';
      params.push(options.type);
    }

    query += ' ORDER BY timestamp DESC';

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      file: string;
      diff: string | null;
      timestamp: number;
      author: string;
      commit_hash: string;
      commit_message: string;
      lines_added: number;
      lines_removed: number;
      change_type: string;
    }>;

    const changes: Change[] = rows.map(row => ({
      id: row.id,
      file: row.file,
      diff: row.diff || '',
      timestamp: new Date(row.timestamp * 1000),
      author: row.author,
      commitHash: row.commit_hash,
      commitMessage: row.commit_message,
      linesAdded: row.lines_added,
      linesRemoved: row.lines_removed,
      type: row.change_type as Change['type']
    }));

    // Calculate aggregates
    const byAuthor: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    const uniqueFiles = new Set<string>();

    for (const change of changes) {
      byAuthor[change.author] = (byAuthor[change.author] || 0) + 1;
      byType[change.type] = (byType[change.type] || 0) + 1;
      totalLinesAdded += change.linesAdded;
      totalLinesRemoved += change.linesRemoved;
      uniqueFiles.add(change.file);
    }

    return {
      period: this.formatPeriod(since, until),
      since,
      until,
      changes,
      totalFiles: uniqueFiles.size,
      totalLinesAdded,
      totalLinesRemoved,
      byAuthor,
      byType
    };
  }

  // Get changes for a specific file
  getFileChanges(filePath: string, limit: number = 20): Change[] {
    const rows = this.db.prepare(`
      SELECT id, file, diff, timestamp, author, commit_hash, commit_message, lines_added, lines_removed, change_type
      FROM change_history
      WHERE file LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(`%${filePath}%`, limit) as Array<{
      id: string;
      file: string;
      diff: string | null;
      timestamp: number;
      author: string;
      commit_hash: string;
      commit_message: string;
      lines_added: number;
      lines_removed: number;
      change_type: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      file: row.file,
      diff: row.diff || '',
      timestamp: new Date(row.timestamp * 1000),
      author: row.author,
      commitHash: row.commit_hash,
      commitMessage: row.commit_message,
      linesAdded: row.lines_added,
      linesRemoved: row.lines_removed,
      type: row.change_type as Change['type']
    }));
  }

  // Get recent changes
  getRecentChanges(hours: number = 24): Change[] {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.queryChanges({ since }).changes;
  }

  private parseSince(since: string | Date): Date {
    if (since instanceof Date) return since;

    const now = new Date();
    const lower = since.toLowerCase();

    if (lower === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (lower === 'yesterday') {
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    if (lower === 'this week') {
      const dayOfWeek = now.getDay();
      return new Date(now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
    }
    if (lower === 'this month') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (lower === 'last week') {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Try to parse as date
    const parsed = new Date(since);
    return isNaN(parsed.getTime()) ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) : parsed;
  }

  private formatPeriod(since: Date, until: Date): string {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const sinceStr = since.toLocaleDateString('en-US', options);
    const untilStr = until.toLocaleDateString('en-US', options);

    if (sinceStr === untilStr) {
      return sinceStr;
    }
    return `${sinceStr} - ${untilStr}`;
  }

  // Search changes by keyword
  searchChanges(keyword: string, limit: number = 20): Change[] {
    const rows = this.db.prepare(`
      SELECT id, file, diff, timestamp, author, commit_hash, commit_message, lines_added, lines_removed, change_type
      FROM change_history
      WHERE file LIKE ? OR diff LIKE ? OR commit_message LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit) as Array<{
      id: string;
      file: string;
      diff: string | null;
      timestamp: number;
      author: string;
      commit_hash: string;
      commit_message: string;
      lines_added: number;
      lines_removed: number;
      change_type: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      file: row.file,
      diff: row.diff || '',
      timestamp: new Date(row.timestamp * 1000),
      author: row.author,
      commitHash: row.commit_hash,
      commitMessage: row.commit_message,
      linesAdded: row.lines_added,
      linesRemoved: row.lines_removed,
      type: row.change_type as Change['type']
    }));
  }
}
