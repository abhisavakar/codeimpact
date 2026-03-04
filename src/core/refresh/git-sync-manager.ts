import { execSync } from 'child_process';
import { existsSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';

/**
 * Types of git state changes we can detect
 */
export type GitChangeType =
  | 'new_commits'      // Normal forward progress (new commits added)
  | 'branch_switch'    // Switched to a different branch
  | 'history_rewrite'  // Reset, revert, rebase, or force push (commits removed)
  | 'merge'            // Merge commit detected
  | 'initial'          // First time tracking this repo
  | 'none';            // No change

/**
 * Information about a detected git change
 */
export interface GitChangeInfo {
  type: GitChangeType;
  previousHead: string | null;
  currentHead: string;
  previousBranch: string | null;
  currentBranch: string | null;
  commitsAdded: number;
  commitsRemoved: number;
  changedFiles: string[];
  timestamp: number;
}

/**
 * Callback for git change events
 */
export type GitChangeCallback = (change: GitChangeInfo) => void | Promise<void>;

/**
 * GitSyncManager - Intelligent git state tracking and sync management
 *
 * Detects:
 * - New commits (forward progress)
 * - Branch switches
 * - History rewrites (reset, revert, rebase, force push)
 * - Merges
 *
 * Triggers appropriate reindex actions based on what changed.
 */
export class GitSyncManager {
  private projectPath: string;
  private cachedHead: string | null = null;
  private cachedBranch: string | null = null;
  private cachedCommitHistory: string[] = []; // Last N commit hashes
  private historyDepth: number = 50; // How many commits to track
  private callbacks: GitChangeCallback[] = [];
  private watchingGitHead: boolean = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastChangeInfo: GitChangeInfo | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Initialize the manager - captures current git state
   */
  initialize(): GitChangeInfo | null {
    const currentHead = this.getCurrentHead();
    if (!currentHead) {
      return null; // Not a git repo
    }

    const currentBranch = this.getCurrentBranch();
    const commitHistory = this.getCommitHistory(this.historyDepth);

    const isInitial = this.cachedHead === null;

    this.cachedHead = currentHead;
    this.cachedBranch = currentBranch;
    this.cachedCommitHistory = commitHistory;

    if (isInitial) {
      const changeInfo: GitChangeInfo = {
        type: 'initial',
        previousHead: null,
        currentHead,
        previousBranch: null,
        currentBranch,
        commitsAdded: 0,
        commitsRemoved: 0,
        changedFiles: [],
        timestamp: Date.now()
      };
      this.lastChangeInfo = changeInfo;
      return changeInfo;
    }

    return null;
  }

  /**
   * Check for git state changes and return change info if any
   */
  checkForChanges(): GitChangeInfo | null {
    const currentHead = this.getCurrentHead();
    if (!currentHead) {
      return null;
    }

    const currentBranch = this.getCurrentBranch();
    const commitHistory = this.getCommitHistory(this.historyDepth);

    // No change
    if (currentHead === this.cachedHead && currentBranch === this.cachedBranch) {
      return null;
    }

    // Detect what type of change occurred
    const changeType = this.detectChangeType(
      this.cachedHead,
      currentHead,
      this.cachedBranch,
      currentBranch,
      this.cachedCommitHistory,
      commitHistory
    );

    // Calculate commits added/removed
    const { added, removed } = this.calculateCommitDelta(
      this.cachedCommitHistory,
      commitHistory
    );

    // Get changed files
    const changedFiles = this.getChangedFiles(this.cachedHead, currentHead);

    const changeInfo: GitChangeInfo = {
      type: changeType,
      previousHead: this.cachedHead,
      currentHead,
      previousBranch: this.cachedBranch,
      currentBranch,
      commitsAdded: added,
      commitsRemoved: removed,
      changedFiles,
      timestamp: Date.now()
    };

    // Update cache
    this.cachedHead = currentHead;
    this.cachedBranch = currentBranch;
    this.cachedCommitHistory = commitHistory;
    this.lastChangeInfo = changeInfo;

    // Notify callbacks
    this.notifyCallbacks(changeInfo);

    return changeInfo;
  }

  /**
   * Register a callback for git changes
   */
  onGitChange(callback: GitChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a callback
   */
  removeCallback(callback: GitChangeCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }

  /**
   * Start watching for git changes
   * Uses a combination of file watching (.git/HEAD) and polling
   */
  startWatching(pollIntervalMs: number = 5000): void {
    // Watch .git/HEAD for branch switches
    const gitHeadPath = join(this.projectPath, '.git', 'HEAD');
    if (existsSync(gitHeadPath) && !this.watchingGitHead) {
      watchFile(gitHeadPath, { interval: 1000 }, () => {
        this.checkForChanges();
      });
      this.watchingGitHead = true;
    }

    // Also poll for changes (catches commits, resets, etc.)
    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => {
        this.checkForChanges();
      }, pollIntervalMs);
    }
  }

  /**
   * Stop watching for git changes
   */
  stopWatching(): void {
    if (this.watchingGitHead) {
      const gitHeadPath = join(this.projectPath, '.git', 'HEAD');
      unwatchFile(gitHeadPath);
      this.watchingGitHead = false;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Get the last detected change info
   */
  getLastChangeInfo(): GitChangeInfo | null {
    return this.lastChangeInfo;
  }

  /**
   * Get current cached state
   */
  getState(): { head: string | null; branch: string | null; historySize: number } {
    return {
      head: this.cachedHead,
      branch: this.cachedBranch,
      historySize: this.cachedCommitHistory.length
    };
  }

  /**
   * Force a full resync (useful after manual operations)
   */
  forceResync(): GitChangeInfo | null {
    const previousHead = this.cachedHead;
    const previousBranch = this.cachedBranch;

    // Clear cache to force detection
    this.cachedHead = null;
    this.cachedBranch = null;
    this.cachedCommitHistory = [];

    // Re-initialize
    const changeInfo = this.initialize();

    if (changeInfo && previousHead) {
      // Override with actual previous values for accurate reporting
      changeInfo.previousHead = previousHead;
      changeInfo.previousBranch = previousBranch;
      changeInfo.type = 'history_rewrite'; // Assume rewrite for force resync
      changeInfo.changedFiles = this.getChangedFiles(previousHead, changeInfo.currentHead);
    }

    return changeInfo;
  }

  // ==================== Private Methods ====================

  private getCurrentHead(): string | null {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch {
      return null;
    }
  }

  private getCurrentBranch(): string | null {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return branch === 'HEAD' ? null : branch; // Detached HEAD returns 'HEAD'
    } catch {
      return null;
    }
  }

  private getCommitHistory(count: number): string[] {
    try {
      const log = execSync(`git log --format=%H -n ${count}`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return log ? log.split('\n') : [];
    } catch {
      return [];
    }
  }

  private getChangedFiles(fromCommit: string | null, toCommit: string): string[] {
    if (!fromCommit) {
      return [];
    }

    try {
      // Check if fromCommit still exists in history
      const commitExists = this.commitExists(fromCommit);
      if (!commitExists) {
        // Commit was removed (force push, reset, etc.)
        // Return all files as potentially changed
        return this.getAllTrackedFiles();
      }

      const output = execSync(`git diff --name-only ${fromCommit} ${toCommit}`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return output ? output.split('\n') : [];
    } catch {
      return [];
    }
  }

  private commitExists(commitHash: string): boolean {
    try {
      execSync(`git cat-file -t ${commitHash}`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return true;
    } catch {
      return false;
    }
  }

  private getAllTrackedFiles(): string[] {
    try {
      const output = execSync('git ls-files', {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return output ? output.split('\n') : [];
    } catch {
      return [];
    }
  }

  private detectChangeType(
    previousHead: string | null,
    currentHead: string,
    previousBranch: string | null,
    currentBranch: string | null,
    previousHistory: string[],
    currentHistory: string[]
  ): GitChangeType {
    // Initial state
    if (!previousHead) {
      return 'initial';
    }

    // Branch switch
    if (previousBranch !== currentBranch) {
      return 'branch_switch';
    }

    // Check if previous HEAD is in current history
    const previousHeadInHistory = currentHistory.includes(previousHead);

    // Check if current HEAD is in previous history
    const currentHeadInPreviousHistory = previousHistory.includes(currentHead);

    // History rewrite: previous HEAD no longer in history
    if (!previousHeadInHistory) {
      return 'history_rewrite';
    }

    // Check for merge (current HEAD has multiple parents)
    if (this.isMergeCommit(currentHead)) {
      return 'merge';
    }

    // Normal forward progress
    if (previousHeadInHistory && !currentHeadInPreviousHistory) {
      return 'new_commits';
    }

    // Moved backwards in history (checkout of older commit, reset)
    if (currentHeadInPreviousHistory) {
      return 'history_rewrite';
    }

    return 'new_commits';
  }

  private isMergeCommit(commitHash: string): boolean {
    try {
      const parents = execSync(`git rev-parse ${commitHash}^@`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return parents.split('\n').length > 1;
    } catch {
      return false;
    }
  }

  private calculateCommitDelta(
    previousHistory: string[],
    currentHistory: string[]
  ): { added: number; removed: number } {
    const previousSet = new Set(previousHistory);
    const currentSet = new Set(currentHistory);

    let added = 0;
    let removed = 0;

    for (const commit of currentHistory) {
      if (!previousSet.has(commit)) {
        added++;
      }
    }

    for (const commit of previousHistory) {
      if (!currentSet.has(commit)) {
        removed++;
      }
    }

    return { added, removed };
  }

  private notifyCallbacks(change: GitChangeInfo): void {
    for (const callback of this.callbacks) {
      try {
        Promise.resolve(callback(change)).catch(err => {
          console.error('Git change callback error:', err);
        });
      } catch (err) {
        console.error('Git change callback error:', err);
      }
    }
  }
}

/**
 * Helper to format change info for logging
 */
export function formatGitChangeInfo(change: GitChangeInfo): string {
  const lines: string[] = [];

  lines.push(`Git Change Detected: ${change.type.toUpperCase()}`);
  lines.push(`  Branch: ${change.previousBranch || '(detached)'} → ${change.currentBranch || '(detached)'}`);
  lines.push(`  HEAD: ${change.previousHead?.substring(0, 7) || '(none)'} → ${change.currentHead.substring(0, 7)}`);

  if (change.commitsAdded > 0 || change.commitsRemoved > 0) {
    lines.push(`  Commits: +${change.commitsAdded} / -${change.commitsRemoved}`);
  }

  if (change.changedFiles.length > 0) {
    lines.push(`  Changed files: ${change.changedFiles.length}`);
    if (change.changedFiles.length <= 10) {
      for (const file of change.changedFiles) {
        lines.push(`    - ${file}`);
      }
    } else {
      for (const file of change.changedFiles.slice(0, 5)) {
        lines.push(`    - ${file}`);
      }
      lines.push(`    ... and ${change.changedFiles.length - 5} more`);
    }
  }

  return lines.join('\n');
}
