/**
 * Lifecycle Management — proposes merge/split/prune operations for agents
 * based on git history analysis and configurable thresholds.
 *
 * Proposals are surfaced but never auto-applied.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { DetectedFeature, AgentIndex } from './types.js';
import { getAgentWorkspacePaths, readAgentIndex, writeAgentIndex } from './workspace.js';
import { analyzeCoChanges, findMergeCandidates, type CoChangeConfig, DEFAULT_CO_CHANGE_CONFIG } from './co-change-analyzer.js';
import type { GitExecutor } from './remote-provider.js';
import { RealGitExecutor } from './remote-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface LifecycleConfig {
  mergeCoChangeRate: number;   // Default: 0.8
  splitFileCount: number;       // Default: 30
  pruneInactiveDays: number;    // Default: 90
  minCommitsForEvidence: number; // Default: 10
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  mergeCoChangeRate: 0.8,
  splitFileCount: 30,
  pruneInactiveDays: 90,
  minCommitsForEvidence: 10,
};

export type ProposalType = 'merge' | 'split' | 'prune';

export interface LifecycleProposal {
  type: ProposalType;
  agents: string[];
  evidence: Record<string, unknown>;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface LifecycleResult {
  proposals: LifecycleProposal[];
  analysisTime: number;
  commitsAnalyzed: number;
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Analyze the project and produce lifecycle proposals.
 */
export function analyzeLifecycle(
  projectPath: string,
  features: DetectedFeature[],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
  executor: GitExecutor = new RealGitExecutor(),
): LifecycleResult {
  const startTime = Date.now();
  const proposals: LifecycleProposal[] = [];
  let commitsAnalyzed = 0;

  // 1. Merge proposals from co-change analysis
  try {
    const coChangeConfig: CoChangeConfig = {
      ...DEFAULT_CO_CHANGE_CONFIG,
      minCommits: config.minCommitsForEvidence,
    };
    const matrix = analyzeCoChanges(projectPath, coChangeConfig, executor);
    commitsAnalyzed = matrix.totalCommits;

    const featurePaths = new Map<string, string[]>();
    for (const feature of features) {
      featurePaths.set(feature.name, feature.paths);
    }

    const mergeCandidates = findMergeCandidates(matrix, featurePaths, config.mergeCoChangeRate);
    for (const candidate of mergeCandidates) {
      proposals.push({
        type: 'merge',
        agents: [`${candidate.featureA}-agent`, `${candidate.featureB}-agent`],
        evidence: {
          coChangeRate: candidate.coChangeRate,
          commits: candidate.commits,
        },
        description: `Features "${candidate.featureA}" and "${candidate.featureB}" change together ${Math.round(candidate.coChangeRate * 100)}% of the time`,
        priority: candidate.coChangeRate >= 0.9 ? 'high' : 'medium',
      });
    }
  } catch {
    // Co-change analysis failed — skip merge proposals
  }

  // 2. Split proposals for large features
  for (const feature of features) {
    if (feature.fileCount > config.splitFileCount) {
      proposals.push({
        type: 'split',
        agents: [`${feature.name}-agent`],
        evidence: {
          fileCount: feature.fileCount,
          threshold: config.splitFileCount,
        },
        description: `Feature "${feature.name}" has ${feature.fileCount} files (threshold: ${config.splitFileCount})`,
        priority: feature.fileCount > config.splitFileCount * 2 ? 'high' : 'medium',
      });
    }
  }

  // 3. Prune proposals for inactive features
  const paths = getAgentWorkspacePaths(projectPath);
  if (existsSync(paths.featuresDir)) {
    try {
      const featureDirs = readdirSync(paths.featuresDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      const activeFeatureNames = new Set(features.map(f => f.name));
      const cutoffDate = Date.now() - config.pruneInactiveDays * 24 * 60 * 60 * 1000;

      for (const dirName of featureDirs) {
        if (!activeFeatureNames.has(dirName)) {
          const dirPath = join(paths.featuresDir, dirName);
          const stat = statSync(dirPath);
          if (stat.mtimeMs < cutoffDate) {
            proposals.push({
              type: 'prune',
              agents: [`${dirName}-agent`],
              evidence: {
                lastModified: new Date(stat.mtimeMs).toISOString(),
                inactiveDays: Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000)),
                threshold: config.pruneInactiveDays,
              },
              description: `Feature "${dirName}" no longer detected and agent files haven't been modified in ${Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000))} days`,
              priority: 'low',
            });
          }
        }
      }
    } catch {
      // Ignore filesystem errors
    }
  }

  return {
    proposals,
    analysisTime: Date.now() - startTime,
    commitsAnalyzed,
  };
}

/**
 * Store lifecycle proposals in index.json.
 */
export function storeProposals(projectPath: string, proposals: LifecycleProposal[]): void {
  const index = readAgentIndex(projectPath) as AgentIndex & { lifecycleProposals?: LifecycleProposal[] };
  index.lifecycleProposals = proposals;
  writeAgentIndex(projectPath, index);
}
