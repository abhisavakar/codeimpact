/**
 * Agent System Orchestrator — ties all modules together.
 * Provides the main entry points: init, generate, research, status, migrate.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type Database from 'better-sqlite3';
import type { AgentConfig, AgentIndex, DetectedTechnology, DetectedFeature, DetectedFeatureEntry, ReResearchEntry } from './types.js';
import {
  initAgentWorkspace,
  readAgentConfig,
  readAgentIndex,
  writeAgentIndex,
  agentWorkspaceExists,
  getAgentWorkspacePaths,
} from './workspace.js';
import { detectTechnologies, detectMonorepo } from './tech-detector.js';
import { detectFeatures, type FeatureDetectorInput } from './feature-detector.js';
import { researchAllTechnologies, type ResearchOptions, type ResearchResult } from './research-engine.js';
import { generateProjectFiles, generateFeatureFiles, type GeneratorInput } from './generator.js';
import { generateAgentFiles, generateAgentsShim } from './agent-generator.js';
import { commitAndPush, hasChanges, isGitRepo, type GitResult } from './git-operations.js';
import { runImprovementEngine, type ImprovementResult } from './improvement-engine.js';
import { createOutcomeTable, getOutcomeStats } from './outcome-storage.js';
import { analyzeLifecycle, storeProposals, type LifecycleProposal } from './lifecycle.js';
import { createTelemetryTable, emitTelemetry } from './telemetry.js';
import type { ProjectIntelligence } from '../knowledge/intelligence-collector.js';

// ============================================================================
// Public API
// ============================================================================

export interface OrchestratorOptions {
  projectPath: string;
  db?: Database.Database;
  intelligence?: ProjectIntelligence;
  importGraph?: Map<string, string[]>;
  indexedFiles?: string[];
  force?: boolean;
  pr?: boolean;
  push?: boolean;
}

export interface InitResult {
  success: boolean;
  message: string;
  paths: {
    root: string;
    config: string;
    index: string;
  };
}

export interface GenerateResult {
  success: boolean;
  message: string;
  technologies: number;
  features: number;
  researchResults?: ResearchResult[];
  projectFilesWritten: string[];
  featureFilesWritten: string[];
  agentFilesWritten: string[];
  agentsShimWritten: boolean;
  git?: GitResult;
  improvement?: ImprovementResult;
}

export interface StatusResult {
  initialized: boolean;
  config?: AgentConfig;
  index?: AgentIndex;
  technologies: number;
  features: number;
  researchFiles: number;
  staleResearch: number;
  outcomes: { total: number; successes: number; failures: number };
  monorepo: string | null;
  hasChanges: boolean;
  lifecycleProposals?: LifecycleProposal[];
}

// ============================================================================
// Init
// ============================================================================

export function agentsInit(projectPath: string): InitResult {
  const paths = initAgentWorkspace(projectPath);
  return {
    success: true,
    message: `Agent workspace initialized at ${paths.root}`,
    paths: {
      root: paths.root,
      config: paths.configPath,
      index: paths.indexPath,
    },
  };
}

// ============================================================================
// Generate (Full Pipeline)
// ============================================================================

export async function agentsGenerate(options: OrchestratorOptions): Promise<GenerateResult> {
  const { projectPath, db, intelligence, force, pr, push } = options;
  const generateStart = Date.now();
  const result: GenerateResult = {
    success: true,
    message: '',
    technologies: 0,
    features: 0,
    projectFilesWritten: [],
    featureFilesWritten: [],
    agentFilesWritten: [],
    agentsShimWritten: false,
  };

  // Ensure workspace exists
  if (!agentWorkspaceExists(projectPath)) {
    agentsInit(projectPath);
  }

  const config = readAgentConfig(projectPath);

  // 1. Detect technologies
  const technologies = detectTechnologies(projectPath);
  result.technologies = technologies.length;

  // 2. Detect features
  const importGraph = options.importGraph || new Map<string, string[]>();
  const indexedFiles = options.indexedFiles || getIndexedFilesFromFS(projectPath);

  const featureInput: FeatureDetectorInput = {
    projectPath,
    config: config.feature_detection,
    importGraph,
    indexedFiles,
  };
  const features = detectFeatures(featureInput);
  result.features = features.length;

  // 3. Research technologies (if enabled)
  if (config.auto_research) {
    const researchOpts: ResearchOptions = {
      maxTokensPerTech: config.research_max_tokens_per_tech,
      cadenceHours: config.research_cadence_hours,
      force,
    };
    // Only research top deps (not devDeps from lockfile noise)
    const topTechs = filterTopTechnologies(technologies);
    result.researchResults = await researchAllTechnologies(projectPath, topTechs, researchOpts);
  }

  // 3.5. Process re-research queue from index
  const currentIndex = readAgentIndex(projectPath);
  if (currentIndex.reResearchQueue && currentIndex.reResearchQueue.length > 0) {
    const queuedTechs = currentIndex.reResearchQueue.slice(0, 5); // Rate limit: 5/run
    for (const entry of queuedTechs) {
      const tech = technologies.find(t => t.name === entry.technology);
      if (tech) {
        const reResearchOpts: ResearchOptions = {
          maxTokensPerTech: config.research_max_tokens_per_tech,
          cadenceHours: 0, // Force refresh
          force: true,
        };
        try {
          const res = await researchAllTechnologies(projectPath, [tech], reResearchOpts);
          if (!result.researchResults) result.researchResults = [];
          result.researchResults.push(...res);
        } catch { /* skip failed re-research */ }
      }
    }
    // Clear processed queue
    currentIndex.reResearchQueue = [];
    writeAgentIndex(projectPath, currentIndex);
  }

  // 4. Generate project files
  const intel = intelligence || createMinimalIntelligence(projectPath, technologies, features);
  const genInput: GeneratorInput = {
    projectPath,
    intelligence: intel,
    technologies,
    features,
    index: readAgentIndex(projectPath),
  };

  const projectResult = generateProjectFiles(genInput);
  result.projectFilesWritten = projectResult.filesWritten;

  // 5. Generate feature files
  const featureResult = generateFeatureFiles(genInput);
  result.featureFilesWritten = featureResult.filesWritten;

  // 6. Generate agent definitions
  const agentResult = generateAgentFiles(projectPath, features);
  result.agentFilesWritten = agentResult.filesWritten;

  // 7. Generate AGENTS.md shim
  const shimResult = generateAgentsShim(projectPath, agentResult.agents);
  result.agentsShimWritten = shimResult.written;

  // 8. Update index.json
  const index = readAgentIndex(projectPath);
  index.generatedAt = new Date().toISOString();
  index.technologies = technologies.map(t => ({
    ...t,
    researchFile: `research/${t.name}@${t.version}.md`,
  }));
  index.features = features.map(f => ({
    ...f,
    skillFile: `features/${f.name}/SKILL.md`,
    agentFile: `features/${f.name}/AGENT.md`,
  }));

  // Update research timestamps
  if (result.researchResults) {
    for (const r of result.researchResults) {
      if (r.status === 'created' || r.status === 'updated') {
        index.lastResearch[r.technology] = new Date().toISOString();
      }
    }
  }

  // Detect monorepo
  const monorepo = detectMonorepo(projectPath);
  index.config.monorepo = monorepo !== null;

  writeAgentIndex(projectPath, index);

  // 9. Run improvement engine (if DB available) + compute outcome stats
  if (db) {
    try {
      createOutcomeTable(db);
      result.improvement = runImprovementEngine(db, projectPath);

      // Compute outcome stats from DB (drift fix: index.outcomes was never populated)
      const stats = getOutcomeStats(db);
      index.outcomes = {
        total: stats.total,
        successes: stats.successes,
        failures: stats.failures,
        lastDiagnosed: new Date().toISOString(),
      };
      writeAgentIndex(projectPath, index);
    } catch { /* improvement is optional */ }
  }

  // 9.5. Lifecycle analysis — surface merge/split/prune proposals
  try {
    const lifecycle = analyzeLifecycle(projectPath, features);
    if (lifecycle.proposals.length > 0) {
      storeProposals(projectPath, lifecycle.proposals);
    }
  } catch { /* lifecycle is optional */ }

  // 9.6. Emit telemetry (if DB available)
  if (db) {
    try {
      createTelemetryTable(db);
      const totalFiles = result.projectFilesWritten.length +
        result.featureFilesWritten.length +
        result.agentFilesWritten.length;
      emitTelemetry(db, 'generation', 'generate-complete', {
        technologies: result.technologies,
        features: result.features,
        filesWritten: totalFiles,
        researchResults: result.researchResults?.length || 0,
        improvement: result.improvement ? {
          diagnosed: result.improvement.diagnosed,
          lessonsAdded: result.improvement.lessonsAdded,
        } : null,
      }, Date.now() - generateStart);
    } catch { /* telemetry is optional */ }
  }

  // 10. Git operations (if requested)
  if ((pr || push) && isGitRepo(projectPath) && hasChanges(projectPath)) {
    const totalFiles = result.projectFilesWritten.length +
      result.featureFilesWritten.length +
      result.agentFilesWritten.length;

    result.git = commitAndPush(projectPath, {
      message: `update: ${result.technologies} techs, ${result.features} features, ${totalFiles} files`,
      body: [
        `Trigger: generate command`,
        `Technologies: ${result.technologies}`,
        `Features: ${features.map(f => f.name).join(', ')}`,
        `Files updated: ${totalFiles}`,
      ].join('\n'),
      push: push || pr,
    });
  }

  result.message = `Generated: ${result.technologies} technologies, ${result.features} features, ${
    result.projectFilesWritten.length + result.featureFilesWritten.length + result.agentFilesWritten.length
  } files written`;

  return result;
}

// ============================================================================
// Status
// ============================================================================

export function agentsStatus(projectPath: string): StatusResult {
  if (!agentWorkspaceExists(projectPath)) {
    return {
      initialized: false,
      technologies: 0,
      features: 0,
      researchFiles: 0,
      staleResearch: 0,
      outcomes: { total: 0, successes: 0, failures: 0 },
      monorepo: null,
      hasChanges: false,
    };
  }

  const config = readAgentConfig(projectPath);
  const index = readAgentIndex(projectPath);
  const paths = getAgentWorkspacePaths(projectPath);

  // Count research files
  let researchFiles = 0;
  let staleResearch = 0;
  if (existsSync(paths.researchDir)) {
    const files = readdirSync(paths.researchDir) as string[];
    researchFiles = files.filter((f: string) => f.endsWith('.md')).length;

    // Check staleness
    const now = Date.now();
    for (const [tech, timestamp] of Object.entries(index.lastResearch)) {
      const fetchedAt = new Date(timestamp).getTime();
      if (now - fetchedAt > config.research_cadence_hours * 60 * 60 * 1000) {
        staleResearch++;
      }
    }
  }

  const monorepo = detectMonorepo(projectPath);
  const gitChanges = isGitRepo(projectPath) ? hasChanges(projectPath) : false;

  // Read lifecycle proposals from index
  const indexWithLifecycle = index as AgentIndex & { lifecycleProposals?: LifecycleProposal[] };
  const lifecycleProposals = indexWithLifecycle.lifecycleProposals;

  return {
    initialized: true,
    config,
    index,
    technologies: index.technologies.length,
    features: index.features.length,
    researchFiles,
    staleResearch,
    outcomes: index.outcomes,
    monorepo: monorepo?.type || null,
    hasChanges: gitChanges,
    lifecycleProposals,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getIndexedFilesFromFS(projectPath: string): string[] {
  // Fallback: walk src/ directory to get file list
  const files: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 5) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          const rel = relative(projectPath, fullPath).replace(/\\/g, '/');
          files.push(rel);
        }
      }
    } catch { /* permission error */ }
  }

  walk(projectPath, 0);
  return files;
}

function filterTopTechnologies(technologies: DetectedTechnology[]): DetectedTechnology[] {
  // Skip obvious noise and limit to top 20
  const skipPatterns = [
    /^@types\//,
    /^eslint/,
    /^prettier/,
    /^@eslint/,
    /^typescript$/,
    /^@esbuild\//,       // Platform-specific esbuild binaries
    /^@rollup\//,        // Platform-specific rollup binaries
    /^@swc\//,           // Platform-specific swc binaries
    /^@parcel\//,        // Platform-specific parcel binaries
    /^@biomejs\//,       // Platform-specific biome binaries
  ];

  return technologies
    .filter(t => !skipPatterns.some(p => p.test(t.name)))
    .filter(t => t.source.includes('lock') || t.source === 'package.json') // Only manifest/lock entries
    .slice(0, 20);
}

function createMinimalIntelligence(
  projectPath: string,
  technologies: DetectedTechnology[],
  features: DetectedFeature[],
): ProjectIntelligence {
  return {
    collectedAt: new Date().toISOString(),
    codebase: {
      fileCount: 0,
      totalLines: 0,
      languages: [...new Set(technologies.map(t => {
        if (t.source.includes('package')) return 'typescript';
        if (t.source.includes('Cargo')) return 'rust';
        if (t.source.includes('go.')) return 'go';
        if (t.source.includes('requirements') || t.source.includes('pyproject')) return 'python';
        return 'unknown';
      }))],
      keyDirectories: features.map(f => f.paths[0]?.replace('/**', '') || ''),
      symbolCount: 0,
      description: '',
      architectureNotes: '',
    },
    architecture: null,
    dependencyHotspots: [],
    patterns: [],
    decisions: [],
    riskFiles: [],
    deadCode: null,
    tests: { framework: 'unknown', testCount: 0, coverageGaps: [], uncoveredFunctions: [] },
    recentBugs: [],
    changeHotspots: [],
    activeFeature: null,
    docHealth: null,
    detectedTechnologies: technologies.map(t => ({
      name: t.name,
      source: t.source,
      importPaths: t.importPaths || [],
    })),
  };
}
