/**
 * Co-Change Analyzer — analyzes git history to find files that change together.
 * Used by the lifecycle engine to propose agent merges/splits.
 */

import type { GitExecutor } from './remote-provider.js';
import { RealGitExecutor } from './remote-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface CoChangeEntry {
  fileA: string;
  fileB: string;
  coChangeCount: number;
  totalCommits: number;
  rate: number;  // coChangeCount / min(commitsA, commitsB)
}

export interface CoChangeMatrix {
  entries: CoChangeEntry[];
  totalCommits: number;
  analyzedFiles: number;
  duration: number;
}

export interface CoChangeConfig {
  maxCommits: number;      // Cap for performance (default: 500)
  minCommits: number;      // Min commits for evidence (default: 10)
  pathFilter?: string;     // Only analyze paths matching this prefix
}

export const DEFAULT_CO_CHANGE_CONFIG: CoChangeConfig = {
  maxCommits: 500,
  minCommits: 10,
};

// ============================================================================
// Analysis
// ============================================================================

/**
 * Analyze git log to build a co-change matrix for source files.
 */
export function analyzeCoChanges(
  projectPath: string,
  config: CoChangeConfig = DEFAULT_CO_CHANGE_CONFIG,
  executor: GitExecutor = new RealGitExecutor(),
): CoChangeMatrix {
  const startTime = Date.now();

  // Get commit file lists
  const commits = getCommitFileLists(projectPath, config, executor);

  // Count per-file commit frequency
  const fileCommitCount = new Map<string, number>();
  for (const files of commits) {
    for (const file of files) {
      fileCommitCount.set(file, (fileCommitCount.get(file) || 0) + 1);
    }
  }

  // Build co-change pairs
  const pairCount = new Map<string, number>();
  for (const files of commits) {
    const sorted = [...files].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|||${sorted[j]}`;
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  }

  // Convert to entries with rates
  const entries: CoChangeEntry[] = [];
  for (const [key, count] of pairCount) {
    const [fileA, fileB] = key.split('|||');
    if (!fileA || !fileB) continue;

    const commitsA = fileCommitCount.get(fileA) || 0;
    const commitsB = fileCommitCount.get(fileB) || 0;
    const minCommits = Math.min(commitsA, commitsB);

    if (minCommits < config.minCommits) continue;

    entries.push({
      fileA,
      fileB,
      coChangeCount: count,
      totalCommits: minCommits,
      rate: count / minCommits,
    });
  }

  // Sort by rate descending
  entries.sort((a, b) => b.rate - a.rate);

  return {
    entries,
    totalCommits: commits.length,
    analyzedFiles: fileCommitCount.size,
    duration: Date.now() - startTime,
  };
}

/**
 * Find features with high co-change rates (candidates for merging).
 */
export function findMergeCandidates(
  matrix: CoChangeMatrix,
  featurePaths: Map<string, string[]>,
  threshold: number = 0.8,
): Array<{ featureA: string; featureB: string; coChangeRate: number; commits: number }> {
  const candidates: Array<{ featureA: string; featureB: string; coChangeRate: number; commits: number }> = [];
  const featureNames = [...featurePaths.keys()];

  for (let i = 0; i < featureNames.length; i++) {
    for (let j = i + 1; j < featureNames.length; j++) {
      const nameA = featureNames[i]!;
      const nameB = featureNames[j]!;
      const pathsA = featurePaths.get(nameA) || [];
      const pathsB = featurePaths.get(nameB) || [];

      // Find co-change entries between these features
      let totalCoChanges = 0;
      let totalPairs = 0;

      for (const entry of matrix.entries) {
        const aInA = pathsA.some(p => entry.fileA.startsWith(p.replace('/**', '')));
        const bInB = pathsB.some(p => entry.fileB.startsWith(p.replace('/**', '')));
        const aInB = pathsB.some(p => entry.fileA.startsWith(p.replace('/**', '')));
        const bInA = pathsA.some(p => entry.fileB.startsWith(p.replace('/**', '')));

        if ((aInA && bInB) || (aInB && bInA)) {
          totalCoChanges += entry.coChangeCount;
          totalPairs++;
        }
      }

      if (totalPairs > 0) {
        const avgRate = totalCoChanges / Math.max(totalPairs, 1);
        if (avgRate >= threshold) {
          candidates.push({
            featureA: nameA,
            featureB: nameB,
            coChangeRate: Math.round(avgRate * 100) / 100,
            commits: totalCoChanges,
          });
        }
      }
    }
  }

  return candidates;
}

// ============================================================================
// Git Log Parsing
// ============================================================================

function getCommitFileLists(
  projectPath: string,
  config: CoChangeConfig,
  executor: GitExecutor,
): string[][] {
  try {
    // Get commit hashes
    const logOutput = executor.exec(
      projectPath,
      `log --format="%H" -n ${config.maxCommits} --no-merges`,
    );

    const hashes = logOutput.trim().split('\n').filter(h => h.length > 0);
    const commits: string[][] = [];

    for (const hash of hashes) {
      try {
        const filesOutput = executor.exec(
          projectPath,
          `diff-tree --no-commit-id --name-only -r ${hash}`,
        );

        const files = filesOutput
          .trim()
          .split('\n')
          .filter(f => f.length > 0)
          .filter(f => isSourceFile(f))
          .filter(f => !config.pathFilter || f.startsWith(config.pathFilter));

        if (files.length > 0 && files.length <= 20) {
          // Skip massive commits (refactors) as they add noise
          commits.push(files);
        }
      } catch {
        // Skip failed diffs
      }
    }

    return commits;
  } catch {
    return [];
  }
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs|java|rb|cs|swift|kt)$/.test(path) &&
    !path.includes('node_modules') &&
    !path.includes('dist/') &&
    !path.includes('.test.') &&
    !path.includes('.spec.');
}
