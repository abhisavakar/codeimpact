/**
 * Feature detector — identifies bounded subsystems in a codebase.
 * Uses import graph cohesion, CODEOWNERS, package boundaries, and path heuristics.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import type { DetectedFeature, FeatureDetectionConfig } from './types.js';

// ============================================================================
// Public API
// ============================================================================

export interface FeatureDetectorInput {
  projectPath: string;
  config: FeatureDetectionConfig;
  /** Import graph: source file → list of imported file paths */
  importGraph: Map<string, string[]>;
  /** All indexed file paths (relative to project) */
  indexedFiles: string[];
  /** Technologies detected per file pattern */
  fileTechMap?: Map<string, string[]>;
}

export function detectFeatures(input: FeatureDetectorInput): DetectedFeature[] {
  const { projectPath, config, importGraph, indexedFiles, fileTechMap } = input;

  let candidates: DetectedFeature[] = [];

  // Priority 1: Explicit boundaries (CODEOWNERS, package.json sub-packages)
  if (config.respect_package_boundaries) {
    const pkgFeatures = detectPackageBoundaryFeatures(projectPath, indexedFiles);
    candidates.push(...pkgFeatures);
  }

  if (config.respect_codeowners) {
    const ownerFeatures = detectCodeownerFeatures(projectPath, indexedFiles);
    candidates.push(...ownerFeatures);
  }

  // Priority 2: Import cohesion clustering
  const cohesionFeatures = detectCohesionFeatures(
    projectPath,
    importGraph,
    indexedFiles,
    config.min_cohesion,
    config.min_files,
  );
  candidates.push(...cohesionFeatures);

  // Priority 3: Path-based heuristics
  const pathFeatures = detectPathFeatures(projectPath, indexedFiles, config.min_files);
  candidates.push(...pathFeatures);

  // Deduplicate: prefer explicit boundaries, then cohesion, then path
  candidates = deduplicateFeatures(candidates);

  // Cap to max_features
  candidates = candidates.slice(0, config.max_features);

  // Enrich with technology info
  if (fileTechMap) {
    for (const feature of candidates) {
      feature.technologies = detectFeatureTechnologies(feature.paths, fileTechMap);
    }
  }

  // Associate test files
  for (const feature of candidates) {
    feature.testFiles = findTestFiles(feature.paths, indexedFiles);
  }

  return candidates;
}

// ============================================================================
// Package Boundary Detection
// ============================================================================

function detectPackageBoundaryFeatures(projectPath: string, indexedFiles: string[]): DetectedFeature[] {
  const features: DetectedFeature[] = [];

  // Find directories with their own package.json (not root)
  const subPackages = findSubPackageJsons(projectPath);

  for (const pkgDir of subPackages) {
    const relDir = relative(projectPath, pkgDir).replace(/\\/g, '/');
    const filesInPackage = indexedFiles.filter(f => f.startsWith(relDir + '/'));

    if (filesInPackage.length >= 3) {
      const name = slugify(basename(pkgDir));
      features.push({
        name,
        paths: [`${relDir}/**`],
        technologies: [],
        testFiles: [],
        cohesionScore: 1.0, // Explicit boundary = max cohesion
        fileCount: filesInPackage.length,
      });
    }
  }

  return features;
}

function findSubPackageJsons(projectPath: string): string[] {
  const results: string[] = [];
  const maxDepth = 3;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const lower = entry.name.toLowerCase();
        if (lower === 'node_modules' || lower === '.git' || lower === 'dist') continue;
        if (EXCLUDED_FEATURE_DIRS.has(lower)) continue;

        const subDir = join(dir, entry.name);
        const pkgJson = join(subDir, 'package.json');
        if (existsSync(pkgJson) && subDir !== projectPath) {
          results.push(subDir);
        }
        walk(subDir, depth + 1);
      }
    } catch { /* permission errors etc */ }
  }

  walk(projectPath, 0);
  return results;
}

// ============================================================================
// CODEOWNERS Detection
// ============================================================================

function detectCodeownerFeatures(projectPath: string, indexedFiles: string[]): DetectedFeature[] {
  const features: DetectedFeature[] = [];

  // Look for CODEOWNERS in common locations
  const codeownersLocations = [
    join(projectPath, 'CODEOWNERS'),
    join(projectPath, '.github', 'CODEOWNERS'),
    join(projectPath, 'docs', 'CODEOWNERS'),
  ];

  let codeownersPath: string | null = null;
  for (const loc of codeownersLocations) {
    if (existsSync(loc)) {
      codeownersPath = loc;
      break;
    }
  }

  if (!codeownersPath) return features;

  try {
    const content = readFileSync(codeownersPath, 'utf-8');
    const entries = parseCodeowners(content);

    for (const entry of entries) {
      const matchingFiles = indexedFiles.filter(f => matchCodeownerPattern(f, entry.pattern));
      if (matchingFiles.length >= 3) {
        const name = slugify(entry.pattern.replace(/[/*]/g, '-').replace(/^-+|-+$/g, ''));
        features.push({
          name,
          paths: [entry.pattern],
          technologies: [],
          testFiles: [],
          cohesionScore: 0.9,
          fileCount: matchingFiles.length,
          owner: entry.owners[0],
        });
      }
    }
  } catch { /* ignore */ }

  return features;
}

interface CodeownerEntry {
  pattern: string;
  owners: string[];
}

function parseCodeowners(content: string): CodeownerEntry[] {
  const entries: CodeownerEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[0]) {
      entries.push({
        pattern: parts[0],
        owners: parts.slice(1),
      });
    }
  }
  return entries;
}

function matchCodeownerPattern(filePath: string, pattern: string): boolean {
  // Simple glob matching for CODEOWNERS patterns
  const normalized = pattern.replace(/^\//, '');
  if (normalized.endsWith('/**') || normalized.endsWith('/*')) {
    const prefix = normalized.replace(/\/\*\*?$/, '');
    return filePath.startsWith(prefix + '/') || filePath === prefix;
  }
  if (normalized.startsWith('*')) {
    return filePath.endsWith(normalized.slice(1));
  }
  return filePath === normalized || filePath.startsWith(normalized + '/');
}

// ============================================================================
// Import Cohesion Clustering
// ============================================================================

function detectCohesionFeatures(
  projectPath: string,
  importGraph: Map<string, string[]>,
  indexedFiles: string[],
  minCohesion: number,
  minFiles: number,
): DetectedFeature[] {
  const features: DetectedFeature[] = [];

  // Group files by their top-level source directory (e.g., src/auth, src/api)
  const dirGroups = groupByDirectory(indexedFiles, projectPath);

  for (const [dirPath, files] of dirGroups.entries()) {
    if (files.length < minFiles) continue;

    // Skip utility/shared directories
    const dirName = basename(dirPath);
    if (isUtilityDir(dirName)) continue;

    // Calculate cohesion: ratio of internal imports to total imports
    const cohesion = calculateCohesion(files, dirPath, importGraph);
    if (cohesion >= minCohesion) {
      features.push({
        name: slugify(dirName),
        paths: [`${dirPath}/**`],
        technologies: [],
        testFiles: [],
        cohesionScore: cohesion,
        fileCount: files.length,
      });
    }
  }

  return features;
}

/** Top-level directories that ARE valid source features (non-src roots) */
const SOURCE_TOP_DIRS = new Set([
  'src', 'app', 'apps', 'packages', 'services', 'modules',
  'test', 'tests', 'spec', 'e2e',
  'api', 'lib', 'cmd', 'internal', 'pkg',
]);

function groupByDirectory(files: string[], projectPath: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.split('/');
    let dirKey: string;

    // Find src-level directories (src/core, src/server, etc.)
    const srcIdx = parts.indexOf('src');
    if (srcIdx >= 0 && parts.length > srcIdx + 2) {
      dirKey = parts.slice(0, srcIdx + 2).join('/');
    } else if (parts.length >= 2 && parts[0]) {
      // Top-level dir — only allow recognized source directories
      const topDir = parts[0].toLowerCase();
      if (EXCLUDED_FEATURE_DIRS.has(topDir)) continue;
      if (!SOURCE_TOP_DIRS.has(topDir)) continue;
      dirKey = parts[0];
    } else {
      continue; // Root-level files don't form features
    }

    if (!groups.has(dirKey)) {
      groups.set(dirKey, []);
    }
    groups.get(dirKey)!.push(file);
  }

  return groups;
}

function calculateCohesion(
  files: string[],
  dirPath: string,
  importGraph: Map<string, string[]>,
): number {
  let internalImports = 0;
  let totalImports = 0;

  const fileSet = new Set(files);

  for (const file of files) {
    const imports = importGraph.get(file) || [];
    for (const imp of imports) {
      totalImports++;
      if (imp.startsWith(dirPath + '/') || fileSet.has(imp)) {
        internalImports++;
      }
    }
  }

  if (totalImports === 0) return 0;
  return internalImports / totalImports;
}

// ============================================================================
// Path-Based Heuristics
// ============================================================================

function detectPathFeatures(
  projectPath: string,
  indexedFiles: string[],
  minFiles: number,
): DetectedFeature[] {
  const features: DetectedFeature[] = [];
  const dirGroups = groupByDirectory(indexedFiles, projectPath);

  for (const [dirPath, files] of dirGroups.entries()) {
    if (files.length < minFiles) continue;
    const dirName = basename(dirPath);
    if (isUtilityDir(dirName)) continue;

    features.push({
      name: slugify(dirName),
      paths: [`${dirPath}/**`],
      technologies: [],
      testFiles: [],
      cohesionScore: 0.3, // Lower score since it's just path-based
      fileCount: files.length,
    });
  }

  return features;
}

// ============================================================================
// Deduplication
// ============================================================================

function deduplicateFeatures(features: DetectedFeature[]): DetectedFeature[] {
  // Sort by cohesion score descending (prefer higher confidence)
  const sorted = [...features].sort((a, b) => b.cohesionScore - a.cohesionScore);
  const result: DetectedFeature[] = [];
  const claimedNames = new Set<string>();

  for (const feature of sorted) {
    if (claimedNames.has(feature.name)) {
      // Merge paths into existing feature
      const existing = result.find(f => f.name === feature.name);
      if (existing) {
        for (const p of feature.paths) {
          if (!existing.paths.includes(p)) {
            existing.paths.push(p);
          }
        }
        existing.fileCount = Math.max(existing.fileCount, feature.fileCount);
        if (feature.owner && !existing.owner) {
          existing.owner = feature.owner;
        }
      }
      continue;
    }
    claimedNames.add(feature.name);
    result.push({ ...feature });
  }

  return result;
}

// ============================================================================
// Technology & Test Association
// ============================================================================

function detectFeatureTechnologies(paths: string[], fileTechMap: Map<string, string[]>): string[] {
  const techs = new Set<string>();
  for (const [file, techList] of fileTechMap.entries()) {
    for (const pattern of paths) {
      const prefix = pattern.replace(/\/\*\*$/, '');
      if (file.startsWith(prefix)) {
        for (const t of techList) techs.add(t);
      }
    }
  }
  return [...techs];
}

function findTestFiles(featurePaths: string[], allFiles: string[]): string[] {
  const testFiles: string[] = [];
  const testPatterns = ['.test.', '.spec.', '__tests__/', 'test/'];

  for (const file of allFiles) {
    const isTest = testPatterns.some(p => file.includes(p));
    if (!isTest) continue;

    // Check if test relates to any feature path
    for (const pattern of featurePaths) {
      const prefix = pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      const featureName = basename(prefix);
      if (file.includes(featureName)) {
        testFiles.push(file);
        break;
      }
    }
  }

  return testFiles;
}

// ============================================================================
// Helpers
// ============================================================================

const UTILITY_DIRS = new Set([
  'lib', 'libs', 'utils', 'util', 'helpers', 'helper',
  'shared', 'common', 'types', 'constants', 'config',
  'assets', 'static', 'public', 'vendor', 'third-party',
]);

/** Top-level directories that should never become features */
const EXCLUDED_FEATURE_DIRS = new Set([
  // Runtime-generated / workspace
  'knowledge', '.code-impact', '.codeimpact', '.claude', '.cursor',
  // Documentation
  'doc', 'docs', 'documentation',
  // Build / output
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  // Dependencies / virtual environments
  'node_modules', '.yarn', '.pnpm-store',
  'venv', '.venv', 'env', 'virtualenv', 'ENV',
  // CI / config
  '.github', '.gitlab', '.circleci', 'scripts', '.husky',
  // Test fixtures (not features themselves)
  'fixtures', 'base', '__fixtures__', '__snapshots__',
  // Data / migrations
  'migrations', 'seeds', 'data',
  // IDE / editor
  '.vscode', '.idea',
]);

function isUtilityDir(dirName: string): boolean {
  const lower = dirName.toLowerCase();
  return UTILITY_DIRS.has(lower) || EXCLUDED_FEATURE_DIRS.has(lower);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
