import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { randomUUID } from 'crypto';
import type { ActiveFeatureContext, FeatureFile, FeatureChange, FeatureQuery, HotContext } from '../types/index.js';

/**
 * Context Resurrection - Restore mental state from last session
 * "Last time you worked on auth, you were stuck on X"
 */
export interface ResurrectedContext {
  /** What files were you working on? */
  activeFiles: string[];
  /** What were you trying to do? */
  lastQueries: string[];
  /** What decisions were made during this context? */
  sessionDecisions: string[];
  /** Where did you leave off? */
  lastEditedFile: string | null;
  lastEditTime: Date | null;
  /** What was the blocker (if any)? */
  possibleBlocker: string | null;
  /** Suggested next steps */
  suggestedActions: string[];
  /** Context summary for AI */
  summary: string;
  /** Time since last activity */
  timeSinceLastActive: string;
}

export interface ContextResurrectionOptions {
  /** Specific feature name to resurrect */
  featureName?: string;
  /** Include file contents in resurrection */
  includeFileContents?: boolean;
  /** Maximum files to include */
  maxFiles?: number;
}

const MAX_FILES = 20;
const MAX_CHANGES = 50;
const MAX_QUERIES = 20;
const MAX_RECENT_CONTEXTS = 5;
const TTL_MINUTES = 30;
const HOT_CACHE_MAX_FILES = 15;

// Files to ignore in suggestions and tracking (stubs, configs, generated files)
const IGNORE_FILE_PATTERNS = [
  /__init__\.py$/,           // Python package stubs
  /\.d\.ts$/,                // TypeScript declaration files
  /\.config\.(js|ts|mjs)$/,  // Config files
  /\.env/,                   // Environment files
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /next-env\.d\.ts$/,        // Next.js generated
];

// Check if a file is a meaningful code file (not a stub/config)
function isMeaningfulFile(filePath: string, lineCount?: number): boolean {
  const fileName = basename(filePath).toLowerCase();

  // Check ignore patterns
  for (const pattern of IGNORE_FILE_PATTERNS) {
    if (pattern.test(fileName) || pattern.test(filePath)) {
      return false;
    }
  }

  // Check if __init__.py with few lines (stub)
  if (fileName === '__init__.py' && (lineCount === undefined || lineCount < 10)) {
    return false;
  }

  // Check file extension - only code files
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.vue', '.svelte'];
  const hasCodeExtension = codeExtensions.some(ext => filePath.endsWith(ext));

  return hasCodeExtension;
}

export class FeatureContextManager extends EventEmitter {
  private current: ActiveFeatureContext | null = null;
  private recent: ActiveFeatureContext[] = [];
  private fileContents: Map<string, string> = new Map();
  private projectPath: string;
  private dataDir: string;
  private persistPath: string;
  private inactivityTimer: NodeJS.Timeout | null = null;

  constructor(projectPath: string, dataDir: string) {
    super();
    this.projectPath = projectPath;
    this.dataDir = dataDir;
    this.persistPath = join(dataDir, 'feature-context.json');
    this.load();
    this.startInactivityTimer();
  }

  // ========== FILE TRACKING ==========

  onFileOpened(filePath: string): void {
    this.ensureContext();
    this.touchFile(filePath);
    this.preloadFile(filePath);
  }

  onFileEdited(filePath: string, diff: string, linesChanged: number[] = []): void {
    this.ensureContext();
    this.touchFile(filePath);
    this.recordChange(filePath, diff, linesChanged);
  }

  private touchFile(filePath: string): void {
    if (!this.current) return;

    // Normalize path to relative
    const relativePath = this.toRelativePath(filePath);
    const existing = this.current.files.find(f => f.path === relativePath);

    if (existing) {
      existing.lastTouched = new Date();
      existing.touchCount++;
    } else {
      this.current.files.push({
        path: relativePath,
        lastTouched: new Date(),
        touchCount: 1,
        recentLines: []
      });

      // Trim if over limit - keep most touched files
      if (this.current.files.length > MAX_FILES) {
        this.current.files = this.current.files
          .sort((a, b) => b.touchCount - a.touchCount)
          .slice(0, MAX_FILES);
      }
    }

    this.current.lastActiveAt = new Date();
    this.save();
  }

  // ========== CHANGE TRACKING ==========

  private recordChange(filePath: string, diff: string, linesChanged: number[]): void {
    if (!this.current) return;

    const relativePath = this.toRelativePath(filePath);

    this.current.changes.unshift({
      file: relativePath,
      timestamp: new Date(),
      diff: diff.slice(0, 200), // Limit diff size
      linesChanged
    });

    // Trim old changes
    if (this.current.changes.length > MAX_CHANGES) {
      this.current.changes = this.current.changes.slice(0, MAX_CHANGES);
    }

    // Update file's recent lines
    const fileEntry = this.current.files.find(f => f.path === relativePath);
    if (fileEntry && linesChanged.length > 0) {
      fileEntry.recentLines = linesChanged.slice(0, 10);
    }

    this.save();
  }

  // ========== QUERY TRACKING ==========

  onQuery(query: string, filesUsed: string[]): void {
    this.ensureContext();
    if (!this.current) return;

    const relativeFiles = filesUsed.map(f => this.toRelativePath(f));

    this.current.queries.unshift({
      query,
      timestamp: new Date(),
      filesUsed: relativeFiles
    });

    // Trim old queries
    if (this.current.queries.length > MAX_QUERIES) {
      this.current.queries = this.current.queries.slice(0, MAX_QUERIES);
    }

    // Touch files that were used
    relativeFiles.forEach(f => this.touchFile(f));

    this.current.lastActiveAt = new Date();
    this.save();
  }

  // ========== HOT CACHE ==========

  private async preloadFile(filePath: string): Promise<void> {
    const relativePath = this.toRelativePath(filePath);

    if (this.fileContents.has(relativePath)) return;

    try {
      const absolutePath = this.toAbsolutePath(relativePath);
      const content = readFileSync(absolutePath, 'utf-8');
      this.fileContents.set(relativePath, content);

      // Trim cache if too large
      if (this.fileContents.size > HOT_CACHE_MAX_FILES && this.current) {
        // Find least recently touched file and remove it
        const filesInContext = new Set(this.current.files.map(f => f.path));
        for (const [path] of this.fileContents) {
          if (!filesInContext.has(path)) {
            this.fileContents.delete(path);
            break;
          }
        }
      }
    } catch {
      // File might not exist or be unreadable
    }
  }

  getFileContent(filePath: string): string | null {
    const relativePath = this.toRelativePath(filePath);
    return this.fileContents.get(relativePath) || null;
  }

  // ========== CONTEXT RETRIEVAL ==========

  getHotContext(): HotContext {
    if (!this.current) {
      return { files: [], changes: [], queries: [], summary: '' };
    }

    // Rank files by touchCount * recency
    const now = Date.now();
    const rankedFiles = this.current.files
      .map(f => ({
        ...f,
        score: f.touchCount * (1 / (now - f.lastTouched.getTime() + 1))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return {
      files: rankedFiles.map(f => ({
        path: f.path,
        content: this.fileContents.get(f.path) || null,
        touchCount: f.touchCount
      })),
      changes: this.current.changes.slice(0, 10),
      queries: this.current.queries.slice(0, 5),
      summary: this.generateSummary()
    };
  }

  private generateSummary(): string {
    if (!this.current) return '';

    const topFiles = this.current.files
      .sort((a, b) => b.touchCount - a.touchCount)
      .slice(0, 5)
      .map(f => basename(f.path))
      .join(', ');

    const recentChanges = this.current.changes.length;
    const durationMs = Date.now() - this.current.startedAt.getTime();
    const durationMin = Math.round(durationMs / 60000);

    if (topFiles) {
      return `Working on: ${topFiles} | ${recentChanges} changes | ${durationMin} min`;
    }

    return `Session active | ${durationMin} min`;
  }

  getCurrentContext(): ActiveFeatureContext | null {
    return this.current;
  }

  getRecentContexts(): ActiveFeatureContext[] {
    return this.recent;
  }

  getCurrentSummary(): { name: string; files: number; changes: number; duration: number } | null {
    if (!this.current) return null;

    return {
      name: this.current.name,
      files: this.current.files.length,
      changes: this.current.changes.length,
      duration: Math.round((Date.now() - this.current.startedAt.getTime()) / 60000)
    };
  }

  // ========== CONTEXT MANAGEMENT ==========

  private ensureContext(): void {
    if (!this.current || this.current.status !== 'active') {
      this.startNewContext();
    }
  }

  startNewContext(name?: string): ActiveFeatureContext {
    // Save current context to recent
    if (this.current) {
      this.current.status = 'paused';
      this.recent.unshift(this.current);
      this.recent = this.recent.slice(0, MAX_RECENT_CONTEXTS);
    }

    this.current = {
      id: randomUUID(),
      name: name || 'Untitled Feature',
      files: [],
      changes: [],
      queries: [],
      startedAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active'
    };

    // Clear hot cache for new context
    this.fileContents.clear();
    this.save();

    this.emit('context-started', this.current);
    return this.current;
  }

  setContextName(name: string): boolean {
    if (!this.current) return false;
    this.current.name = name;
    this.save();
    return true;
  }

  switchToRecent(contextId: string): boolean {
    const found = this.recent.find(c => c.id === contextId);
    if (!found) return false;

    // Save current to recent
    if (this.current) {
      this.current.status = 'paused';
      this.recent.unshift(this.current);
    }

    // Remove found from recent and make it current
    this.recent = this.recent.filter(c => c.id !== contextId);
    this.current = found;
    this.current.status = 'active';
    this.current.lastActiveAt = new Date();

    // Reload files into hot cache
    this.reloadFiles();
    this.save();

    this.emit('context-switched', this.current);
    return true;
  }

  private reloadFiles(): void {
    this.fileContents.clear();
    if (!this.current) return;

    // Preload top 10 files
    const topFiles = this.current.files
      .sort((a, b) => b.touchCount - a.touchCount)
      .slice(0, 10);

    for (const file of topFiles) {
      this.preloadFile(file.path);
    }
  }

  completeContext(): boolean {
    if (!this.current) return false;
    this.current.status = 'completed';
    this.recent.unshift(this.current);
    this.recent = this.recent.slice(0, MAX_RECENT_CONTEXTS);
    this.current = null;
    this.fileContents.clear();
    this.save();
    return true;
  }

  // ========== AUTO MANAGEMENT ==========

  private startInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
    }

    this.inactivityTimer = setInterval(() => {
      if (!this.current) return;

      const inactiveMs = Date.now() - this.current.lastActiveAt.getTime();
      if (inactiveMs > TTL_MINUTES * 60 * 1000) {
        this.current.status = 'paused';
        this.emit('context-paused', this.current);
        this.save();
      }
    }, 60000); // Check every minute
  }

  // ========== PERSISTENCE ==========

  private save(): void {
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data = {
        current: this.current,
        recent: this.recent
      };

      writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving feature context:', error);
    }
  }

  private load(): void {
    try {
      if (existsSync(this.persistPath)) {
        const data = JSON.parse(readFileSync(this.persistPath, 'utf-8'));

        // Parse dates in current context
        if (data.current) {
          this.current = this.parseContext(data.current);
        }

        // Parse dates in recent contexts
        if (data.recent) {
          this.recent = data.recent.map((c: ActiveFeatureContext) => this.parseContext(c));
        }

        // Reload files if we have a current context
        if (this.current && this.current.status === 'active') {
          this.reloadFiles();
        }
      }
    } catch (error) {
      console.error('Error loading feature context:', error);
      this.current = null;
      this.recent = [];
    }
  }

  private parseContext(data: ActiveFeatureContext): ActiveFeatureContext {
    return {
      ...data,
      startedAt: new Date(data.startedAt),
      lastActiveAt: new Date(data.lastActiveAt),
      files: data.files.map(f => ({
        ...f,
        lastTouched: new Date(f.lastTouched)
      })),
      changes: data.changes.map(c => ({
        ...c,
        timestamp: new Date(c.timestamp)
      })),
      queries: data.queries.map(q => ({
        ...q,
        timestamp: new Date(q.timestamp)
      }))
    };
  }

  // ========== PATH UTILITIES ==========

  private toRelativePath(filePath: string): string {
    if (filePath.startsWith(this.projectPath)) {
      return filePath.slice(this.projectPath.length).replace(/^[\/\\]/, '');
    }
    return filePath;
  }

  private toAbsolutePath(relativePath: string): string {
    if (relativePath.startsWith(this.projectPath)) {
      return relativePath;
    }
    return join(this.projectPath, relativePath);
  }

  // ========== CONTEXT RESURRECTION ==========

  /**
   * Resurrect context from last session - restore mental state
   * Returns what you were working on, where you left off, and possible blockers
   */
  resurrectContext(options: ContextResurrectionOptions = {}): ResurrectedContext {
    const { featureName, maxFiles = 5 } = options;

    // Find the context to resurrect
    let contextToResurrect: ActiveFeatureContext | null = null;

    if (featureName) {
      // Find by name
      contextToResurrect = this.recent.find(c =>
        c.name.toLowerCase().includes(featureName.toLowerCase())
      ) || null;

      if (!contextToResurrect && this.current?.name.toLowerCase().includes(featureName.toLowerCase())) {
        contextToResurrect = this.current;
      }
    } else {
      // Use most recent context (current or first in recent)
      contextToResurrect = this.current || this.recent[0] || null;
    }

    if (!contextToResurrect) {
      return {
        activeFiles: [],
        lastQueries: [],
        sessionDecisions: [],
        lastEditedFile: null,
        lastEditTime: null,
        possibleBlocker: null,
        suggestedActions: ['Start a new feature context with memory_record'],
        summary: 'No previous context found to resurrect.',
        timeSinceLastActive: 'N/A',
      };
    }

    // Extract information from context - filter out stub files
    const activeFiles = contextToResurrect.files
      .filter(f => isMeaningfulFile(f.path))
      .sort((a, b) => b.touchCount - a.touchCount)
      .slice(0, maxFiles)
      .map(f => f.path);

    const lastQueries = contextToResurrect.queries
      .slice(0, 3)
      .map(q => q.query);

    // Find last edited file (most recent change)
    const lastChange = contextToResurrect.changes[0];
    const lastEditedFile = lastChange?.file || null;
    const lastEditTime = lastChange?.timestamp || null;

    // Detect possible blocker
    const possibleBlocker = this.detectBlocker(contextToResurrect);

    // Generate suggested actions
    const suggestedActions = this.suggestNextSteps(contextToResurrect);

    // Calculate time since last active
    const timeSinceLastActive = this.formatTimeSince(contextToResurrect.lastActiveAt);

    // Generate summary
    const summary = this.generateResurrectionSummary(contextToResurrect, possibleBlocker);

    return {
      activeFiles,
      lastQueries,
      sessionDecisions: [], // Would need to cross-reference with decisions storage
      lastEditedFile,
      lastEditTime,
      possibleBlocker,
      suggestedActions,
      summary,
      timeSinceLastActive,
    };
  }

  /**
   * Detect what might have been blocking progress when session ended
   */
  private detectBlocker(context: ActiveFeatureContext): string | null {
    if (context.queries.length === 0) {
      return null;
    }

    // Check last few queries for error/problem patterns
    const errorPatterns = [
      /error/i,
      /fix/i,
      /bug/i,
      /issue/i,
      /problem/i,
      /not working/i,
      /doesn't work/i,
      /how to/i,
      /why/i,
      /failed/i,
      /broken/i,
    ];

    // Check last 3 queries
    for (let i = 0; i < Math.min(3, context.queries.length); i++) {
      const query = context.queries[i];
      if (!query) continue;

      for (const pattern of errorPatterns) {
        if (pattern.test(query.query)) {
          return query.query;
        }
      }
    }

    // Check if the same file was touched many times (sign of struggling)
    const fileTouchCounts = new Map<string, number>();
    for (const change of context.changes.slice(0, 10)) {
      const count = fileTouchCounts.get(change.file) || 0;
      fileTouchCounts.set(change.file, count + 1);
    }

    for (const [file, count] of fileTouchCounts.entries()) {
      if (count >= 5) {
        return `Multiple edits to ${basename(file)} - possible implementation challenge`;
      }
    }

    return null;
  }

  /**
   * Suggest next steps based on context state
   */
  private suggestNextSteps(context: ActiveFeatureContext): string[] {
    const suggestions: string[] = [];

    // If there was a potential blocker, suggest addressing it
    const blocker = this.detectBlocker(context);
    if (blocker) {
      suggestions.push(`Resume investigating: "${blocker.slice(0, 50)}..."`);
    }

    // Suggest continuing with most-touched meaningful files (not stubs)
    const topFiles = context.files
      .filter(f => isMeaningfulFile(f.path))
      .sort((a, b) => b.touchCount - a.touchCount)
      .slice(0, 2);

    if (topFiles.length > 0 && topFiles[0]) {
      suggestions.push(`Continue working on ${basename(topFiles[0].path)}`);
    }

    // If there were recent changes, suggest reviewing them
    if (context.changes.length > 0) {
      suggestions.push('Review recent changes before continuing');
    }

    // Generic suggestions if nothing specific
    if (suggestions.length === 0) {
      suggestions.push(`Continue "${context.name}" feature work`);
    }

    return suggestions;
  }

  /**
   * Format time since a date in human-readable form
   */
  private formatTimeSince(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hours ago`;
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    }
  }

  /**
   * Generate a summary of the resurrection context for AI
   */
  private generateResurrectionSummary(context: ActiveFeatureContext, blocker: string | null): string {
    const parts: string[] = [];

    // Feature name and duration
    const durationMs = context.lastActiveAt.getTime() - context.startedAt.getTime();
    const durationMins = Math.round(durationMs / 60000);
    parts.push(`Feature: "${context.name}" (${durationMins} min session)`);

    // Status
    parts.push(`Status: ${context.status}`);

    // Files worked on - only meaningful code files
    const meaningfulFiles = context.files.filter(f => isMeaningfulFile(f.path));
    if (meaningfulFiles.length > 0) {
      const topFiles = meaningfulFiles
        .sort((a, b) => b.touchCount - a.touchCount)
        .slice(0, 3)
        .map(f => basename(f.path));
      parts.push(`Main files: ${topFiles.join(', ')}`);
    }

    // Changes made
    if (context.changes.length > 0) {
      parts.push(`Changes: ${context.changes.length} edits`);
    }

    // Blocker
    if (blocker) {
      parts.push(`Possible blocker: "${blocker.slice(0, 50)}..."`);
    }

    // Last activity
    parts.push(`Last active: ${this.formatTimeSince(context.lastActiveAt)}`);

    return parts.join(' | ');
  }

  /**
   * Get all contexts that can be resurrected
   */
  getResurrectableContexts(): Array<{ id: string; name: string; lastActive: Date; summary: string }> {
    const contexts: Array<{ id: string; name: string; lastActive: Date; summary: string }> = [];

    // Include current if paused
    if (this.current && this.current.status === 'paused') {
      contexts.push({
        id: this.current.id,
        name: this.current.name,
        lastActive: this.current.lastActiveAt,
        summary: this.generateResurrectionSummary(this.current, null),
      });
    }

    // Include recent contexts
    for (const ctx of this.recent) {
      contexts.push({
        id: ctx.id,
        name: ctx.name,
        lastActive: ctx.lastActiveAt,
        summary: this.generateResurrectionSummary(ctx, null),
      });
    }

    return contexts.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
  }

  // ========== CLEANUP ==========

  shutdown(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    this.save();
  }
}
