/**
 * Git Operations — branch creation, commits, and PR workflow for .code-impact/ changes.
 * Uses child_process.execFileSync for safety (no shell interpolation).
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { readAgentConfig } from './workspace.js';

// ============================================================================
// Public API
// ============================================================================

export interface GitResult {
  success: boolean;
  message: string;
  branch?: string;
  commitHash?: string;
  prUrl?: string;
}

export interface CommitOptions {
  message: string;
  body?: string;
  files?: string[];
}

/**
 * Check if the project path is a git repository.
 */
export function isGitRepo(projectPath: string): boolean {
  try {
    git(projectPath, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name.
 */
export function getCurrentBranch(projectPath: string): string {
  return git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

/**
 * Create or switch to the code-impact branch.
 */
export function ensureBranch(projectPath: string): GitResult {
  const config = readAgentConfig(projectPath);
  const branch = config.branch;
  const currentBranch = getCurrentBranch(projectPath);

  if (currentBranch === branch) {
    return { success: true, message: `Already on branch ${branch}`, branch };
  }

  try {
    // Check if branch exists
    const branchExists = branchExistsLocal(projectPath, branch);

    if (branchExists) {
      git(projectPath, ['checkout', branch]);
    } else {
      git(projectPath, ['checkout', '-b', branch]);
    }

    return { success: true, message: `Switched to branch ${branch}`, branch };
  } catch (err) {
    return {
      success: false,
      message: `Failed to switch to branch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Stage and commit .code-impact/ changes.
 */
export function commitChanges(projectPath: string, options: CommitOptions): GitResult {
  try {
    // Stage files
    if (options.files && options.files.length > 0) {
      for (const file of options.files) {
        git(projectPath, ['add', file]);
      }
    } else {
      // Stage all .code-impact/ changes and AGENTS.md
      git(projectPath, ['add', '.code-impact/']);
      if (existsSync(join(projectPath, 'AGENTS.md'))) {
        git(projectPath, ['add', 'AGENTS.md']);
      }
    }

    // Check if there are staged changes
    const status = git(projectPath, ['diff', '--cached', '--stat']);
    if (!status.trim()) {
      return { success: true, message: 'No changes to commit' };
    }

    // Build commit message
    let commitMsg = `[code-impact] ${options.message}`;
    if (options.body) {
      commitMsg += `\n\n${options.body}`;
    }

    git(projectPath, ['commit', '-m', commitMsg]);

    const hash = git(projectPath, ['rev-parse', '--short', 'HEAD']).trim();
    return { success: true, message: `Committed: ${hash}`, commitHash: hash };
  } catch (err) {
    return {
      success: false,
      message: `Commit failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Push branch to remote.
 */
export function pushBranch(projectPath: string): GitResult {
  const branch = getCurrentBranch(projectPath);

  try {
    // Check if remote exists
    const remotes = git(projectPath, ['remote']).trim();
    if (!remotes) {
      return { success: false, message: 'No remote configured' };
    }

    git(projectPath, ['push', '-u', 'origin', branch]);
    return { success: true, message: `Pushed to origin/${branch}`, branch };
  } catch (err) {
    return {
      success: false,
      message: `Push failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Full workflow: branch → commit → push.
 */
export function commitAndPush(
  projectPath: string,
  options: CommitOptions & { push?: boolean },
): GitResult {
  const originalBranch = getCurrentBranch(projectPath);

  // 1. Ensure on correct branch
  const branchResult = ensureBranch(projectPath);
  if (!branchResult.success) return branchResult;

  // 2. Commit changes
  const commitResult = commitChanges(projectPath, options);
  if (!commitResult.success) {
    // Switch back to original branch on failure
    try { git(projectPath, ['checkout', originalBranch]); } catch { /* ignore */ }
    return commitResult;
  }

  // 3. Push if requested
  if (options.push) {
    const pushResult = pushBranch(projectPath);
    if (!pushResult.success) return pushResult;
  }

  return {
    success: true,
    message: commitResult.message,
    branch: branchResult.branch,
    commitHash: commitResult.commitHash,
  };
}

/**
 * Check if there are uncommitted changes in .code-impact/.
 */
export function hasChanges(projectPath: string): boolean {
  try {
    const status = git(projectPath, ['status', '--porcelain', '.code-impact/', 'AGENTS.md']);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get diff summary for .code-impact/ changes.
 */
export function getDiffSummary(projectPath: string): string {
  try {
    const diff = git(projectPath, ['diff', '--stat', '.code-impact/', 'AGENTS.md']);
    return diff.trim();
  } catch {
    return '';
  }
}

/**
 * Get list of changed files in .code-impact/.
 */
export function getChangedFiles(projectPath: string): string[] {
  try {
    const status = git(projectPath, ['status', '--porcelain', '.code-impact/', 'AGENTS.md']);
    return status
      .split('\n')
      .filter(l => l.trim())
      .map(l => l.slice(3).trim());
  } catch {
    return [];
  }
}

// ============================================================================
// Content Hash Tracking (for diff-based regeneration)
// ============================================================================

/**
 * Compute a simple hash of file content for change detection.
 */
export function computeContentHash(content: string): string {
  // Simple FNV-1a hash (fast, no crypto dep needed)
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ============================================================================
// Internal Helpers
// ============================================================================

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function branchExistsLocal(projectPath: string, branch: string): boolean {
  try {
    git(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}
