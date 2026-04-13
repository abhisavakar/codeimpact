import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

export interface KnowledgeWorkspacePaths {
  root: string;
  skillsRoot: string;
  docsRoot: string;
  architectureDocsRoot: string;
  featureDocsRoot: string;
  aggregatedDocsRoot: string;
  integrationDocsRoot: string;
  changelogDocsRoot: string;
  indexPath: string;
}

export interface SkillEvolutionEntry {
  action: string;
  section: string;
  content: string;
  reason: string;
  timestamp: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  scope: 'core' | 'technology' | 'feature' | 'risk';
  metadata?: Record<string, string>;
  body: string;
}

export interface KnowledgeManifest {
  version: string;
  generatedAt: string;
  projectPath: string;
  generatedFrom: {
    indexedFiles: number;
    source: string;
    reason: string;
  };
  skills: Array<{
    name: string;
    description: string;
    scope: string;
    file: string;
    updatedAt: string;
  }>;
  docs: Array<{
    type: 'architecture' | 'feature' | 'integration' | 'changelog';
    file: string;
    updatedAt: string;
  }>;
  providers: Array<{
    provider: string;
    topic: string;
    file: string;
    fetchedAt: string;
    freshnessHours: number;
  }>;
}

export interface KnowledgeStatus {
  generatedAt: string;
  skillCount: number;
  docCount: number;
  providerCount: number;
  workspaceRoot: string;
}

export function getKnowledgePaths(projectPath: string): KnowledgeWorkspacePaths {
  const root = join(projectPath, 'knowledge');
  const skillsRoot = join(root, 'skills');
  const docsRoot = join(root, 'docs');
  const architectureDocsRoot = join(docsRoot, 'architecture');
  const featureDocsRoot = join(docsRoot, 'features');
  const aggregatedDocsRoot = join(featureDocsRoot, '_aggregated');
  const integrationDocsRoot = join(docsRoot, 'integrations');
  const changelogDocsRoot = join(docsRoot, 'changelog');

  return {
    root,
    skillsRoot,
    docsRoot,
    architectureDocsRoot,
    featureDocsRoot,
    aggregatedDocsRoot,
    integrationDocsRoot,
    changelogDocsRoot,
    indexPath: join(root, 'index.json'),
  };
}

export function ensureKnowledgeWorkspace(projectPath: string): KnowledgeWorkspacePaths {
  const paths = getKnowledgePaths(projectPath);
  const requiredDirs = [
    paths.root,
    paths.skillsRoot,
    paths.docsRoot,
    paths.architectureDocsRoot,
    paths.featureDocsRoot,
    paths.aggregatedDocsRoot,
    paths.integrationDocsRoot,
    paths.changelogDocsRoot,
  ];

  for (const dir of requiredDirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return paths;
}

export function createEmptyManifest(projectPath: string): KnowledgeManifest {
  return {
    version: '2.0.0',
    generatedAt: new Date().toISOString(),
    projectPath,
    generatedFrom: {
      indexedFiles: 0,
      source: 'codeimpact',
      reason: 'initialization',
    },
    skills: [],
    docs: [],
    providers: [],
  };
}

export function readManifest(projectPath: string): KnowledgeManifest {
  const paths = ensureKnowledgeWorkspace(projectPath);
  if (!existsSync(paths.indexPath)) {
    const manifest = createEmptyManifest(projectPath);
    writeFileSync(paths.indexPath, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  try {
    return JSON.parse(readFileSync(paths.indexPath, 'utf-8')) as KnowledgeManifest;
  } catch {
    const manifest = createEmptyManifest(projectPath);
    writeFileSync(paths.indexPath, JSON.stringify(manifest, null, 2));
    return manifest;
  }
}

export function writeManifest(projectPath: string, manifest: KnowledgeManifest): void {
  const paths = ensureKnowledgeWorkspace(projectPath);
  writeFileSync(paths.indexPath, JSON.stringify(manifest, null, 2));
}

export function toProjectRelative(projectPath: string, absolutePath: string): string {
  return relative(projectPath, absolutePath).replace(/\\/g, '/');
}
