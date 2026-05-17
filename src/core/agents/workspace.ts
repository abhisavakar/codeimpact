/**
 * Agent workspace management for .code-impact/ directory.
 * Handles directory creation, config.yaml read/write, and index.json management.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AgentConfig, AgentIndex } from './types.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_OUTPUT_DIR = '.code-impact';

export const DEFAULT_CONFIG: AgentConfig = {
  version: 1,
  output_dir: DEFAULT_OUTPUT_DIR,
  branch: 'code-impact/skills',
  auto_research: true,
  research_cadence_hours: 168,
  research_max_tokens_per_tech: 4000,
  auto_pr: true,
  monorepo: 'auto',
  feature_detection: {
    min_files: 3,
    min_cohesion: 0.4,
    max_features: 20,
    respect_codeowners: true,
    respect_package_boundaries: true,
  },
  ignore_patterns: [
    'node_modules/**',
    'dist/**',
    '.git/**',
    'coverage/**',
    '.next/**',
    'build/**',
    'venv/**',
    '.venv/**',
    'env/**',
    '__pycache__/**',
    'vendor/**',
    'knowledge/**',
  ],
  markers: {
    start: '<!-- code-impact:auto-start -->',
    end: '<!-- code-impact:auto-end -->',
  },
};

// ============================================================================
// Workspace Paths
// ============================================================================

export interface AgentWorkspacePaths {
  root: string;
  configPath: string;
  indexPath: string;
  projectDir: string;
  researchDir: string;
  featuresDir: string;
}

export function getAgentWorkspacePaths(projectPath: string, outputDir?: string): AgentWorkspacePaths {
  const dir = outputDir || DEFAULT_OUTPUT_DIR;
  const root = join(projectPath, dir);
  return {
    root,
    configPath: join(root, 'config.yaml'),
    indexPath: join(root, 'index.json'),
    projectDir: join(root, 'project'),
    researchDir: join(root, 'research'),
    featuresDir: join(root, 'features'),
  };
}

// ============================================================================
// Config YAML (simple serializer/parser - no external dep)
// ============================================================================

function serializeYaml(config: AgentConfig): string {
  const lines: string[] = [];
  lines.push(`version: ${config.version}`);
  lines.push(`output_dir: ${config.output_dir}`);
  lines.push(`branch: ${config.branch}`);
  lines.push(`auto_research: ${config.auto_research}`);
  lines.push(`research_cadence_hours: ${config.research_cadence_hours}`);
  lines.push(`research_max_tokens_per_tech: ${config.research_max_tokens_per_tech}`);
  lines.push(`auto_pr: ${config.auto_pr}`);
  lines.push(`monorepo: ${config.monorepo}`);
  lines.push('feature_detection:');
  lines.push(`  min_files: ${config.feature_detection.min_files}`);
  lines.push(`  min_cohesion: ${config.feature_detection.min_cohesion}`);
  lines.push(`  max_features: ${config.feature_detection.max_features}`);
  lines.push(`  respect_codeowners: ${config.feature_detection.respect_codeowners}`);
  lines.push(`  respect_package_boundaries: ${config.feature_detection.respect_package_boundaries}`);
  lines.push('ignore_patterns:');
  for (const pattern of config.ignore_patterns) {
    lines.push(`  - "${pattern}"`);
  }
  lines.push('markers:');
  lines.push(`  start: "${config.markers.start}"`);
  lines.push(`  end: "${config.markers.end}"`);
  return lines.join('\n') + '\n';
}

function parseYaml(content: string): Partial<AgentConfig> {
  const config: Record<string, unknown> = {};
  const featureDetection: Record<string, unknown> = {};
  const markers: Record<string, unknown> = {};
  const ignorePatterns: string[] = [];

  let currentSection = '';
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level list item
    if (trimmed.startsWith('  - ') && currentSection === 'ignore_patterns') {
      const val = trimmed.slice(4).replace(/^["']|["']$/g, '');
      ignorePatterns.push(val);
      continue;
    }

    // Nested key-value
    if (trimmed.startsWith('  ') && !trimmed.startsWith('  -')) {
      const parts = trimmed.trim().split(':');
      const key = parts[0] || '';
      const val = parts.slice(1).join(':').trim().replace(/^["']|["']$/g, '');
      if (key && currentSection === 'feature_detection') {
        featureDetection[key] = parseValue(val);
      } else if (key && currentSection === 'markers') {
        markers[key] = val;
      }
      continue;
    }

    // Top-level key-value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      if (val === '' || val === undefined) {
        currentSection = key;
        continue;
      }

      config[key] = parseValue(val.replace(/^["']|["']$/g, ''));
      currentSection = '';
    }
  }

  const result: Partial<AgentConfig> = {
    ...config as Partial<AgentConfig>,
  };

  if (Object.keys(featureDetection).length > 0) {
    result.feature_detection = featureDetection as unknown as AgentConfig['feature_detection'];
  }
  if (Object.keys(markers).length > 0) {
    result.markers = markers as unknown as AgentConfig['markers'];
  }
  if (ignorePatterns.length > 0) {
    result.ignore_patterns = ignorePatterns;
  }

  return result;
}

function parseValue(val: string): string | number | boolean {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'auto') return 'auto' as unknown as string;
  const num = Number(val);
  if (!isNaN(num) && val !== '') return num;
  return val;
}

// ============================================================================
// Workspace Operations
// ============================================================================

export function initAgentWorkspace(projectPath: string): AgentWorkspacePaths {
  const paths = getAgentWorkspacePaths(projectPath);

  // Create directory structure
  const dirs = [paths.root, paths.projectDir, paths.researchDir, paths.featuresDir];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Write default config if not exists
  if (!existsSync(paths.configPath)) {
    writeFileSync(paths.configPath, serializeYaml(DEFAULT_CONFIG));
  }

  // Write empty index if not exists
  if (!existsSync(paths.indexPath)) {
    const index = createEmptyIndex(projectPath);
    writeFileSync(paths.indexPath, JSON.stringify(index, null, 2));
  }

  return paths;
}

export function readAgentConfig(projectPath: string): AgentConfig {
  const paths = getAgentWorkspacePaths(projectPath);
  if (!existsSync(paths.configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(paths.configPath, 'utf-8');
    const parsed = parseYaml(content);
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeAgentConfig(projectPath: string, config: AgentConfig): void {
  const paths = getAgentWorkspacePaths(projectPath);
  if (!existsSync(paths.root)) {
    mkdirSync(paths.root, { recursive: true });
  }
  writeFileSync(paths.configPath, serializeYaml(config));
}

export function readAgentIndex(projectPath: string): AgentIndex {
  const paths = getAgentWorkspacePaths(projectPath);
  if (!existsSync(paths.indexPath)) {
    return createEmptyIndex(projectPath);
  }

  try {
    return JSON.parse(readFileSync(paths.indexPath, 'utf-8')) as AgentIndex;
  } catch {
    return createEmptyIndex(projectPath);
  }
}

export function writeAgentIndex(projectPath: string, index: AgentIndex): void {
  const paths = getAgentWorkspacePaths(projectPath);
  if (!existsSync(paths.root)) {
    mkdirSync(paths.root, { recursive: true });
  }
  writeFileSync(paths.indexPath, JSON.stringify(index, null, 2));
}

export function createEmptyIndex(projectPath: string): AgentIndex {
  const config = readAgentConfig(projectPath);
  return {
    version: '3.0.0',
    generatedAt: new Date().toISOString(),
    projectPath,
    config: {
      branch: config.branch,
      monorepo: config.monorepo === true,
    },
    technologies: [],
    features: [],
    project: {
      skillFile: 'project/SKILL.md',
      conventionsFile: 'project/CONVENTIONS.md',
      architectureFile: 'project/ARCHITECTURE.md',
      agentFile: 'project/AGENT.md',
    },
    lastResearch: {},
    outcomes: { total: 0, successes: 0, failures: 0 },
  };
}

export function agentWorkspaceExists(projectPath: string): boolean {
  const paths = getAgentWorkspacePaths(projectPath);
  return existsSync(paths.root) && existsSync(paths.configPath);
}

// ============================================================================
// Feature Directory Management
// ============================================================================

export function ensureFeatureDir(projectPath: string, featureName: string): string {
  const paths = getAgentWorkspacePaths(projectPath);
  const featureDir = join(paths.featuresDir, featureName);
  if (!existsSync(featureDir)) {
    mkdirSync(featureDir, { recursive: true });
  }
  return featureDir;
}

// ============================================================================
// Marker-Based Content Management
// ============================================================================

export function updateMarkedSection(
  existingContent: string,
  newSection: string,
  markers: AgentConfig['markers'],
): string {
  const block = `${markers.start}\n${newSection.trim()}\n${markers.end}`;

  if (!existingContent.trim()) {
    return `${block}\n`;
  }

  const startIdx = existingContent.indexOf(markers.start);
  const endIdx = existingContent.indexOf(markers.end);

  if (startIdx >= 0 && endIdx > startIdx) {
    const before = existingContent.slice(0, startIdx).trimEnd();
    const after = existingContent.slice(endIdx + markers.end.length).trimStart();
    const parts = [before, block, after].filter(p => p.length > 0);
    return parts.join('\n\n') + '\n';
  }

  // No markers found — append block
  return `${existingContent.trimEnd()}\n\n${block}\n`;
}

export function extractManualContent(
  content: string,
  markers: AgentConfig['markers'],
): { before: string; after: string } {
  const startIdx = content.indexOf(markers.start);
  const endIdx = content.indexOf(markers.end);

  if (startIdx < 0 || endIdx < 0) {
    return { before: content, after: '' };
  }

  const before = content.slice(0, startIdx).trimEnd();
  const after = content.slice(endIdx + markers.end.length).trimStart();
  return { before, after };
}

// ============================================================================
// Helpers
// ============================================================================

function mergeConfig(defaults: AgentConfig, overrides: Partial<AgentConfig>): AgentConfig {
  return {
    version: (overrides.version as number) ?? defaults.version,
    output_dir: (overrides.output_dir as string) ?? defaults.output_dir,
    branch: (overrides.branch as string) ?? defaults.branch,
    auto_research: (overrides.auto_research as boolean) ?? defaults.auto_research,
    research_cadence_hours: (overrides.research_cadence_hours as number) ?? defaults.research_cadence_hours,
    research_max_tokens_per_tech: (overrides.research_max_tokens_per_tech as number) ?? defaults.research_max_tokens_per_tech,
    auto_pr: (overrides.auto_pr as boolean) ?? defaults.auto_pr,
    monorepo: (overrides.monorepo as AgentConfig['monorepo']) ?? defaults.monorepo,
    feature_detection: {
      ...defaults.feature_detection,
      ...(overrides.feature_detection || {}),
    },
    ignore_patterns: overrides.ignore_patterns ?? defaults.ignore_patterns,
    markers: {
      ...defaults.markers,
      ...(overrides.markers || {}),
    },
  };
}
