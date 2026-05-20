import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import type {
  DailyChangelog,
  ChangeEntry,
  FileChangeInfo,
  ChangeMetrics,
  ChangelogOptions
} from '../../types/documentation.js';

interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: Date;
  files: string[];
  additions: number;
  deletions: number;
}

interface DayGroup {
  date: Date;
  commits: CommitInfo[];
  entries: ChangeEntry[];
}

export class ChangelogGenerator {
  private projectPath: string;
  private db: Database.Database;
  private isGitRepo: boolean;

  constructor(projectPath: string, db: Database.Database) {
    this.projectPath = projectPath;
    this.db = db;
    this.isGitRepo = this.detectGitRepo();
  }

  private detectGitRepo(): boolean {
    if (existsSync(join(this.projectPath, '.git'))) return true;
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: this.projectPath, stdio: 'pipe' });
      return true;
    } catch { return false; }
  }

  async generate(options: ChangelogOptions = {}): Promise<DailyChangelog[]> {
    if (!this.isGitRepo) {
      return [];
    }

    const since = this.parseSinceString(options.since || 'this week');
    const until = options.until || new Date();

    const commits = this.getCommitsInRange(since, until);
    const grouped = this.groupByDay(commits);

    return grouped.map(day => this.createDailyChangelog(day, options.includeDecisions ?? false));
  }

  private parseSinceString(since: Date | string): Date {
    if (since instanceof Date) {
      return since;
    }

    const now = new Date();
    const lower = since.toLowerCase();

    if (lower === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      return yesterday;
    }
    if (lower === 'today') {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return today;
    }
    if (lower === 'this week') {
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - dayOfWeek);
      startOfWeek.setHours(0, 0, 0, 0);
      return startOfWeek;
    }
    if (lower === 'this month') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (lower === 'last week') {
      const dayOfWeek = now.getDay();
      const startOfLastWeek = new Date(now);
      startOfLastWeek.setDate(now.getDate() - dayOfWeek - 7);
      startOfLastWeek.setHours(0, 0, 0, 0);
      return startOfLastWeek;
    }

    // Try to parse as date string
    const parsed = new Date(since);
    return isNaN(parsed.getTime()) ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) : parsed;
  }

  private getCommitsInRange(since: Date, until: Date): CommitInfo[] {
    const commits: CommitInfo[] = [];

    try {
      const sinceStr = since.toISOString().split('T')[0];
      // git log --until is exclusive, so add one day to include commits on the until date
      const untilDate = new Date(until);
      untilDate.setDate(untilDate.getDate() + 1);
      const untilStr = untilDate.toISOString().split('T')[0];

      // Get commit list with basic info
      const output = execSync(
        `git log --since="${sinceStr}" --until="${untilStr}" --format="%H|%s|%an|%ad" --date=iso-strict`,
        { cwd: this.projectPath, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      );

      const lines = output.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const [hash, subject, author, dateStr] = line.split('|');
        if (!hash || !subject) continue;

        // Get file stats for this commit
        const { files, additions, deletions } = this.getCommitStats(hash);

        commits.push({
          hash: hash.slice(0, 8),
          subject: subject || '',
          author: author || 'Unknown',
          date: new Date(dateStr || Date.now()),
          files,
          additions,
          deletions
        });
      }
    } catch (error) {
      // Git command failed
    }

    return commits;
  }

  private getCommitStats(hash: string): { files: string[]; additions: number; deletions: number } {
    try {
      const output = execSync(
        `git show --stat --format="" "${hash}"`,
        { cwd: this.projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      );

      const files: string[] = [];
      let additions = 0;
      let deletions = 0;

      const lines = output.trim().split('\n');
      for (const line of lines) {
        // Match file lines like: src/file.ts | 10 +++++-----
        const fileMatch = line.match(/^\s*([^\|]+)\s*\|/);
        if (fileMatch && fileMatch[1]) {
          files.push(fileMatch[1].trim());
        }

        // Match insertions/deletions from summary line
        const insertMatch = line.match(/(\d+)\s+insertion/);
        const deleteMatch = line.match(/(\d+)\s+deletion/);
        if (insertMatch) additions = parseInt(insertMatch[1]!, 10);
        if (deleteMatch) deletions = parseInt(deleteMatch[1]!, 10);
      }

      return { files, additions, deletions };
    } catch {
      return { files: [], additions: 0, deletions: 0 };
    }
  }

  private groupByDay(commits: CommitInfo[]): DayGroup[] {
    const groups = new Map<string, DayGroup>();

    for (const commit of commits) {
      const dateKey = commit.date.toISOString().split('T')[0]!;

      if (!groups.has(dateKey)) {
        const dayDate = new Date(dateKey);
        groups.set(dateKey, {
          date: dayDate,
          commits: [],
          entries: []
        });
      }

      const group = groups.get(dateKey)!;
      group.commits.push(commit);
      group.entries.push(this.commitToEntry(commit));
    }

    // Sort by date descending (most recent first)
    return Array.from(groups.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  private commitToEntry(commit: CommitInfo): ChangeEntry {
    return {
      type: this.categorizeCommit(commit.subject),
      description: this.cleanCommitMessage(commit.subject),
      files: commit.files,
      commit: commit.hash
    };
  }

  private categorizeCommit(subject: string): ChangeEntry['type'] {
    const lower = subject.toLowerCase();

    // Check conventional commit prefixes
    if (lower.startsWith('feat') || lower.includes('add ') || lower.includes('implement')) {
      return 'feature';
    }
    if (lower.startsWith('fix') || lower.includes('bug') || lower.includes('resolve')) {
      return 'fix';
    }
    if (lower.startsWith('refactor') || lower.includes('cleanup') || lower.includes('reorganize')) {
      return 'refactor';
    }
    if (lower.startsWith('docs') || lower.includes('documentation') || lower.includes('readme')) {
      return 'docs';
    }
    if (lower.startsWith('test') || lower.includes('spec') || lower.includes('coverage')) {
      return 'test';
    }

    return 'chore';
  }

  private cleanCommitMessage(subject: string): string {
    // Remove conventional commit prefix
    return subject
      .replace(/^(?:feat|fix|refactor|docs|test|chore|perf|build|ci|style)\([^)]*\):\s*/i, '')
      .replace(/^(?:feat|fix|refactor|docs|test|chore|perf|build|ci|style):\s*/i, '')
      .trim();
  }

  private createDailyChangelog(day: DayGroup, includeDecisions: boolean): DailyChangelog {
    const features = day.entries.filter(e => e.type === 'feature');
    const fixes = day.entries.filter(e => e.type === 'fix');
    const refactors = day.entries.filter(e => e.type === 'refactor');

    const filesModified = this.aggregateFileChanges(day.commits);
    const metrics = this.calculateMetrics(day.commits);
    const decisions = includeDecisions ? this.getDecisionsForDate(day.date) : [];

    return {
      date: day.date,
      summary: this.generateSummary(day.entries, metrics),
      features,
      fixes,
      refactors,
      filesModified,
      decisions,
      metrics
    };
  }

  private aggregateFileChanges(commits: CommitInfo[]): FileChangeInfo[] {
    const fileMap = new Map<string, FileChangeInfo>();

    for (const commit of commits) {
      for (const file of commit.files) {
        if (!fileMap.has(file)) {
          fileMap.set(file, {
            file,
            added: 0,
            removed: 0,
            type: 'modified'
          });
        }
      }
    }

    // Distribute additions/deletions proportionally (rough estimate)
    for (const commit of commits) {
      const fileCount = commit.files.length || 1;
      const addPerFile = Math.round(commit.additions / fileCount);
      const delPerFile = Math.round(commit.deletions / fileCount);

      for (const file of commit.files) {
        const info = fileMap.get(file);
        if (info) {
          info.added += addPerFile;
          info.removed += delPerFile;
        }
      }
    }

    return Array.from(fileMap.values());
  }

  private calculateMetrics(commits: CommitInfo[]): ChangeMetrics {
    const filesSet = new Set<string>();
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const commit of commits) {
      for (const file of commit.files) {
        filesSet.add(file);
      }
      linesAdded += commit.additions;
      linesRemoved += commit.deletions;
    }

    return {
      commits: commits.length,
      filesChanged: filesSet.size,
      linesAdded,
      linesRemoved
    };
  }

  private generateSummary(entries: ChangeEntry[], metrics: ChangeMetrics): string {
    const parts: string[] = [];

    const features = entries.filter(e => e.type === 'feature').length;
    const fixes = entries.filter(e => e.type === 'fix').length;
    const refactors = entries.filter(e => e.type === 'refactor').length;

    if (features > 0) {
      parts.push(`${features} feature${features > 1 ? 's' : ''}`);
    }
    if (fixes > 0) {
      parts.push(`${fixes} fix${fixes > 1 ? 'es' : ''}`);
    }
    if (refactors > 0) {
      parts.push(`${refactors} refactor${refactors > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
      return `${metrics.commits} commit${metrics.commits !== 1 ? 's' : ''} affecting ${metrics.filesChanged} file${metrics.filesChanged !== 1 ? 's' : ''}`;
    }

    return `${parts.join(', ')} across ${metrics.filesChanged} file${metrics.filesChanged !== 1 ? 's' : ''}`;
  }

  private getDecisionsForDate(date: Date): string[] {
    try {
      const startOfDay = Math.floor(new Date(date).setHours(0, 0, 0, 0) / 1000);
      const endOfDay = Math.floor(new Date(date).setHours(23, 59, 59, 999) / 1000);

      const stmt = this.db.prepare(`
        SELECT title FROM decisions
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at
      `);

      const rows = stmt.all(startOfDay, endOfDay) as Array<{ title: string }>;
      return rows.map(r => r.title);
    } catch {
      return [];
    }
  }
}
