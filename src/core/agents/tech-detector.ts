/**
 * Version-aware technology detector.
 * Parses lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock) to resolve exact versions.
 * Falls back to manifest (package.json) semver ranges when no lockfile is available.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DetectedTechnology } from './types.js';

// ============================================================================
// Public API
// ============================================================================

export function detectTechnologies(projectPath: string): DetectedTechnology[] {
  const technologies: DetectedTechnology[] = [];
  const seen = new Set<string>();

  // Priority 1: Lockfiles (exact versions)
  const lockfileTechs = detectFromLockfiles(projectPath);
  for (const tech of lockfileTechs) {
    if (!seen.has(tech.name)) {
      seen.add(tech.name);
      technologies.push(tech);
    }
  }

  // Priority 2: Manifests (declared versions)
  const manifestTechs = detectFromManifests(projectPath);
  for (const tech of manifestTechs) {
    if (!seen.has(tech.name)) {
      seen.add(tech.name);
      technologies.push(tech);
    }
  }

  // Priority 3: Config files (framework/tool detection)
  const configTechs = detectFromConfigFiles(projectPath);
  for (const tech of configTechs) {
    if (!seen.has(tech.name)) {
      seen.add(tech.name);
      technologies.push(tech);
    }
  }

  return technologies;
}

// ============================================================================
// Lockfile Parsers
// ============================================================================

function detectFromLockfiles(projectPath: string): DetectedTechnology[] {
  // Try each lockfile format in priority order
  const npmLock = join(projectPath, 'package-lock.json');
  if (existsSync(npmLock)) {
    return parsePackageLock(npmLock);
  }

  const pnpmLock = join(projectPath, 'pnpm-lock.yaml');
  if (existsSync(pnpmLock)) {
    return parsePnpmLock(pnpmLock);
  }

  const yarnLock = join(projectPath, 'yarn.lock');
  if (existsSync(yarnLock)) {
    return parseYarnLock(yarnLock);
  }

  return [];
}

function parsePackageLock(lockPath: string): DetectedTechnology[] {
  try {
    const content = JSON.parse(readFileSync(lockPath, 'utf-8'));
    const techs: DetectedTechnology[] = [];

    // package-lock.json v2/v3 format (packages field)
    if (content.packages) {
      for (const [key, pkg] of Object.entries(content.packages) as [string, { version?: string }][]) {
        if (!key || key === '') continue; // skip root
        const name = key.replace(/^node_modules\//, '');
        // Skip nested dependencies (only keep top-level)
        if (name.includes('node_modules/')) continue;
        if (pkg.version) {
          techs.push({
            name,
            version: pkg.version,
            source: 'package-lock.json',
            lockfileEntry: key,
          });
        }
      }
    }
    // package-lock.json v1 format (dependencies field)
    else if (content.dependencies) {
      for (const [name, dep] of Object.entries(content.dependencies) as [string, { version?: string }][]) {
        if (dep.version) {
          techs.push({
            name,
            version: dep.version,
            source: 'package-lock.json',
            lockfileEntry: name,
          });
        }
      }
    }

    return techs;
  } catch {
    return [];
  }
}

function parsePnpmLock(lockPath: string): DetectedTechnology[] {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const techs: DetectedTechnology[] = [];

    // pnpm-lock.yaml has packages like: /@scope/name@version or /name@version
    // Also newer format: packageName@version: ...
    const packageRegex = /^\s*[/'"]?(@?[^@\s'":]+)@(\d+\.\d+\.\d+[^'":]*)/gm;
    let match: RegExpExecArray | null;

    const seen = new Set<string>();
    while ((match = packageRegex.exec(content)) !== null) {
      const name = (match[1] || '').replace(/^\//, '');
      const version = (match[2] || '').replace(/['":]/g, '');
      if (name && !seen.has(name) && !name.includes('node_modules')) {
        seen.add(name);
        techs.push({
          name,
          version,
          source: 'pnpm-lock.yaml',
          lockfileEntry: `${name}@${version}`,
        });
      }
    }

    return techs;
  } catch {
    return [];
  }
}

function parseYarnLock(lockPath: string): DetectedTechnology[] {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const techs: DetectedTechnology[] = [];
    const seen = new Set<string>();

    // Yarn v1 format: "package@range": \n  version "x.y.z"
    // Yarn berry format: "package@npm:range": \n  version: x.y.z
    const lines = content.split('\n');
    let currentPackage = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      // Package header line (not indented, ends with :)
      if (!line.startsWith(' ') && !line.startsWith('#') && line.includes('@')) {
        // Extract package name from patterns like "express@^4.17.0, express@^4.18.0":
        const match = line.match(/^"?(@?[^@\s"]+)@/);
        if (match && match[1]) {
          currentPackage = match[1];
        }
      }

      // Version line (indented)
      if (currentPackage && line.match(/^\s+version\s/)) {
        const versionMatch = line.match(/version\s+"?([^"\s]+)"?/);
        if (versionMatch && versionMatch[1] && !seen.has(currentPackage)) {
          seen.add(currentPackage);
          techs.push({
            name: currentPackage,
            version: versionMatch[1],
            source: 'yarn.lock',
            lockfileEntry: `${currentPackage}@${versionMatch[1]}`,
          });
        }
        currentPackage = '';
      }
    }

    return techs;
  } catch {
    return [];
  }
}

// ============================================================================
// Manifest Parsers
// ============================================================================

function detectFromManifests(projectPath: string): DetectedTechnology[] {
  const techs: DetectedTechnology[] = [];

  // package.json
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      for (const [name, versionRange] of Object.entries(allDeps) as [string, string][]) {
        techs.push({
          name,
          version: cleanSemverRange(versionRange),
          source: 'package.json',
        });
      }
    } catch { /* ignore */ }
  }

  // requirements.txt (Python)
  const reqPath = join(projectPath, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      const content = readFileSync(reqPath, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([^\s]+)/);
        if (match && match[1] && match[2]) {
          techs.push({ name: match[1], version: match[2], source: 'requirements.txt' });
        }
      }
    } catch { /* ignore */ }
  }

  // go.mod (Go)
  const goModPath = join(projectPath, 'go.mod');
  if (existsSync(goModPath)) {
    try {
      const content = readFileSync(goModPath, 'utf-8');
      const reqRegex = /^\s+([^\s]+)\s+v([^\s]+)/gm;
      let match: RegExpExecArray | null;
      while ((match = reqRegex.exec(content)) !== null) {
        if (match[1] && match[2]) {
          techs.push({ name: match[1], version: match[2], source: 'go.mod' });
        }
      }
    } catch { /* ignore */ }
  }

  // Cargo.toml (Rust)
  const cargoPath = join(projectPath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const content = readFileSync(cargoPath, 'utf-8');
      const depRegex = /^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/gm;
      let match: RegExpExecArray | null;
      let inDeps = false;
      for (const line of content.split('\n')) {
        if (line.match(/^\[.*dependencies.*\]/)) { inDeps = true; continue; }
        if (line.match(/^\[/) && inDeps) { inDeps = false; continue; }
        if (inDeps) {
          const m = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
          if (m && m[1] && m[2]) {
            techs.push({ name: m[1], version: m[2], source: 'Cargo.toml' });
          }
        }
      }
    } catch { /* ignore */ }
  }

  return techs;
}

// ============================================================================
// Config File Detection
// ============================================================================

interface ConfigDetection {
  file: string;
  name: string;
  versionExtractor?: (content: string) => string | null;
}

const CONFIG_DETECTIONS: ConfigDetection[] = [
  { file: 'tsconfig.json', name: 'typescript' },
  { file: 'next.config.js', name: 'next.js' },
  { file: 'next.config.mjs', name: 'next.js' },
  { file: 'next.config.ts', name: 'next.js' },
  { file: 'vite.config.ts', name: 'vite' },
  { file: 'vite.config.js', name: 'vite' },
  { file: 'webpack.config.js', name: 'webpack' },
  { file: 'webpack.config.ts', name: 'webpack' },
  { file: '.babelrc', name: 'babel' },
  { file: 'babel.config.js', name: 'babel' },
  { file: '.eslintrc', name: 'eslint' },
  { file: '.eslintrc.js', name: 'eslint' },
  { file: 'eslint.config.js', name: 'eslint' },
  { file: 'tailwind.config.js', name: 'tailwindcss' },
  { file: 'tailwind.config.ts', name: 'tailwindcss' },
  { file: 'docker-compose.yml', name: 'docker-compose' },
  { file: 'docker-compose.yaml', name: 'docker-compose' },
  { file: 'Dockerfile', name: 'docker' },
  { file: 'vitest.config.ts', name: 'vitest' },
  { file: 'vitest.config.js', name: 'vitest' },
  { file: 'jest.config.js', name: 'jest' },
  { file: 'jest.config.ts', name: 'jest' },
  { file: 'prisma/schema.prisma', name: 'prisma' },
  { file: '.github/workflows', name: 'github-actions' },
  { file: 'turbo.json', name: 'turborepo' },
  { file: 'nx.json', name: 'nx' },
  { file: 'lerna.json', name: 'lerna' },
];

function detectFromConfigFiles(projectPath: string): DetectedTechnology[] {
  const techs: DetectedTechnology[] = [];

  for (const detection of CONFIG_DETECTIONS) {
    const filePath = join(projectPath, detection.file);
    if (existsSync(filePath)) {
      let version = 'detected';
      if (detection.versionExtractor) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          version = detection.versionExtractor(content) || 'detected';
        } catch { /* ignore */ }
      }
      techs.push({
        name: detection.name,
        version,
        source: detection.file,
      });
    }
  }

  return techs;
}

// ============================================================================
// Monorepo Detection
// ============================================================================

export type MonorepoType = 'pnpm' | 'npm-workspaces' | 'yarn-workspaces' | 'turborepo' | 'nx' | 'lerna' | null;

export interface MonorepoInfo {
  type: MonorepoType;
  packages: string[];
  rootPath: string;
}

export function detectMonorepo(projectPath: string): MonorepoInfo | null {
  // pnpm workspace
  const pnpmWorkspace = join(projectPath, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWorkspace)) {
    const content = readFileSync(pnpmWorkspace, 'utf-8');
    const packages = extractWorkspacePatterns(content);
    return { type: 'pnpm', packages, rootPath: projectPath };
  }

  // Turborepo (check before generic workspaces since turbo uses workspaces too)
  if (existsSync(join(projectPath, 'turbo.json'))) {
    const pkgJson = join(projectPath, 'package.json');
    let packages: string[] = [];
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
        packages = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
      } catch { /* ignore */ }
    }
    return { type: 'turborepo', packages, rootPath: projectPath };
  }

  // npm/yarn workspaces in package.json
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.workspaces) {
        const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
        const type: MonorepoType = existsSync(join(projectPath, 'yarn.lock')) ? 'yarn-workspaces' : 'npm-workspaces';
        return { type, packages: patterns, rootPath: projectPath };
      }
    } catch { /* ignore */ }
  }

  // Nx
  if (existsSync(join(projectPath, 'nx.json'))) {
    return { type: 'nx', packages: ['packages/*', 'apps/*'], rootPath: projectPath };
  }

  // Lerna
  const lernaPath = join(projectPath, 'lerna.json');
  if (existsSync(lernaPath)) {
    try {
      const lerna = JSON.parse(readFileSync(lernaPath, 'utf-8'));
      return { type: 'lerna', packages: lerna.packages || ['packages/*'], rootPath: projectPath };
    } catch { /* ignore */ }
  }

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function cleanSemverRange(range: string): string {
  // Remove ^ ~ >= <= > < = workspace: prefixes
  return range.replace(/^[\^~>=<]+\s*/, '').replace(/^workspace:\*?/, '').trim();
}

function extractWorkspacePatterns(yamlContent: string): string[] {
  const patterns: string[] = [];
  const lines = yamlContent.split('\n');
  let inPackages = false;

  for (const line of lines) {
    if (line.match(/^packages:/i)) {
      inPackages = true;
      continue;
    }
    if (inPackages && line.match(/^\s+-\s+/)) {
      const pattern = line.replace(/^\s+-\s+/, '').replace(/['"`]/g, '').trim();
      if (pattern) patterns.push(pattern);
    } else if (inPackages && !line.match(/^\s/) && line.trim()) {
      inPackages = false;
    }
  }

  return patterns;
}
