/**
 * Generator — renders project-level and feature-level SKILL.md, CONVENTIONS.md,
 * ARCHITECTURE.md files with marker-based auto sections and manual content preservation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import type { AgentConfig, AgentIndex, DetectedTechnology, DetectedFeature } from './types.js';
import { getAgentWorkspacePaths, updateMarkedSection, readAgentConfig } from './workspace.js';
import { writeMarkedFile as writeMarkedFileImpl, SECTION_PRIORITIES, type MarkedSection, type WriteOptions, type WriteResult } from './marker-writer.js';
import { DEFAULT_BUDGETS, getSectionPriority } from './token-budget.js';
import type { ProjectIntelligence } from '../knowledge/intelligence-collector.js';

// ============================================================================
// Public API
// ============================================================================

export interface GeneratorInput {
  projectPath: string;
  intelligence: ProjectIntelligence;
  technologies: DetectedTechnology[];
  features: DetectedFeature[];
  index: AgentIndex;
}

export interface GeneratorResult {
  filesWritten: string[];
  filesSkipped: string[];
}

export function generateProjectFiles(input: GeneratorInput): GeneratorResult {
  const { projectPath, intelligence, technologies, features, index } = input;
  const config = readAgentConfig(projectPath);
  const paths = getAgentWorkspacePaths(projectPath);
  const result: GeneratorResult = { filesWritten: [], filesSkipped: [] };

  // Ensure project directory exists
  mkdirSync(paths.projectDir, { recursive: true });

  // Generate project/SKILL.md
  const skillPath = join(paths.projectDir, 'SKILL.md');
  writeMarkedFile(skillPath, renderProjectSkill(intelligence, technologies, config), config, result, 'project_skill');

  // Generate project/CONVENTIONS.md
  const convPath = join(paths.projectDir, 'CONVENTIONS.md');
  writeMarkedFile(convPath, renderConventions(intelligence, config), config, result, 'project_conventions');

  // Generate project/ARCHITECTURE.md
  const archPath = join(paths.projectDir, 'ARCHITECTURE.md');
  writeMarkedFile(archPath, renderArchitecture(intelligence, config), config, result, 'project_architecture');

  return result;
}

export function generateFeatureFiles(input: GeneratorInput): GeneratorResult {
  const { projectPath, intelligence, technologies, features, index } = input;
  const config = readAgentConfig(projectPath);
  const paths = getAgentWorkspacePaths(projectPath);
  const result: GeneratorResult = { filesWritten: [], filesSkipped: [] };

  for (const feature of features) {
    const featureDir = join(paths.featuresDir, feature.name);
    mkdirSync(featureDir, { recursive: true });

    // Generate features/{name}/SKILL.md
    const skillPath = join(featureDir, 'SKILL.md');
    const featureTechs = technologies.filter(t => feature.technologies.includes(t.name));
    writeMarkedFile(skillPath, renderFeatureSkill(feature, featureTechs, config), config, result, 'feature_skill');
  }

  return result;
}

// ============================================================================
// Project File Renderers
// ============================================================================

function renderProjectSkill(
  intel: ProjectIntelligence,
  technologies: DetectedTechnology[],
  config: AgentConfig,
): { frontmatter: string; autoContent: string } {
  const frontmatter = [
    '---',
    'name: project-overview',
    'description: High-level project knowledge. Consult when working across multiple features.',
    'version: 1.0',
    'metadata:',
    '  scope: project',
    '  generated_by: code-impact',
    `  last_updated: ${new Date().toISOString().split('T')[0]}`,
    '---',
    '',
    '# Project Overview',
  ].join('\n');

  const lines: string[] = [];

  // Tech Stack
  lines.push('## Tech Stack');
  if (technologies.length > 0) {
    const topTechs = technologies.slice(0, 15);
    for (const tech of topTechs) {
      lines.push(`- ${tech.name} ${tech.version} (from ${tech.source})`);
    }
  } else {
    lines.push(`- Languages: ${intel.codebase.languages.join(', ')}`);
  }
  lines.push('');

  // Architecture
  if (intel.architecture) {
    lines.push('## Architecture');
    if (intel.architecture.layers.length > 0) {
      for (const layer of intel.architecture.layers) {
        lines.push(`- **${layer.name}** (${layer.directory}) — ${layer.purpose} [${layer.fileCount} files]`);
      }
    }
    if (intel.architecture.dataFlow.length > 0) {
      lines.push('');
      lines.push('**Data Flow**: ' + intel.architecture.dataFlow.join(' → '));
    }
    lines.push('');
  }

  // Key Directories
  lines.push('## Key Directories');
  lines.push('| Directory | Purpose |');
  lines.push('|-----------|---------|');
  if (intel.architecture?.layers) {
    for (const layer of intel.architecture.layers) {
      lines.push(`| ${layer.directory}/ | ${layer.purpose} |`);
    }
  } else {
    for (const dir of intel.codebase.keyDirectories) {
      lines.push(`| ${dir}/ | Source code |`);
    }
  }
  lines.push('');

  // Risk Files
  if (intel.riskFiles.length > 0) {
    lines.push('## High-Risk Files');
    for (const rf of intel.riskFiles.slice(0, 5)) {
      lines.push(`- \`${rf.file}\` — Risk: ${rf.riskScore}/100 (${rf.recommendation})`);
    }
    lines.push('');
  }

  return { frontmatter, autoContent: lines.join('\n') };
}

function renderConventions(
  intel: ProjectIntelligence,
  config: AgentConfig,
): { frontmatter: string; autoContent: string } {
  const frontmatter = [
    '---',
    'name: project-conventions',
    'description: Enforced coding standards. Check before any code change.',
    'version: 1.0',
    '---',
    '',
    '# Conventions',
  ].join('\n');

  const lines: string[] = [];

  // Pattern-based conventions
  if (intel.patterns.length > 0) {
    lines.push('## Detected Patterns');
    for (const pattern of intel.patterns.slice(0, 10)) {
      lines.push(`### ${pattern.name}`);
      lines.push(`Category: ${pattern.category} | Usage: ${pattern.usageCount} files`);
      if (pattern.topRules.length > 0) {
        for (const rule of pattern.topRules.slice(0, 3)) {
          lines.push(`- [${rule.severity}] ${rule.rule}`);
        }
      }
      lines.push('');
    }
  }

  // Language info
  lines.push('## Languages & Structure');
  lines.push(`- Languages: ${intel.codebase.languages.join(', ')}`);
  lines.push(`- Total files: ${intel.codebase.fileCount}`);
  lines.push(`- Total lines: ${intel.codebase.totalLines}`);
  lines.push('');

  // Decisions as conventions
  if (intel.decisions.length > 0) {
    lines.push('## Architectural Decisions');
    for (const decision of intel.decisions.slice(0, 5)) {
      lines.push(`- **${decision.title}**: ${decision.description.slice(0, 100)}`);
    }
    lines.push('');
  }

  return { frontmatter, autoContent: lines.join('\n') };
}

function renderArchitecture(
  intel: ProjectIntelligence,
  config: AgentConfig,
): { frontmatter: string; autoContent: string } {
  const frontmatter = [
    '---',
    'name: project-architecture',
    'description: System architecture diagram and data flow.',
    'version: 1.0',
    '---',
    '',
    '# Architecture',
  ].join('\n');

  const lines: string[] = [];

  if (intel.architecture) {
    // Layers
    if (intel.architecture.layers.length > 0) {
      lines.push('## Layers');
      for (let i = 0; i < intel.architecture.layers.length; i++) {
        const layer = intel.architecture.layers[i]!;
        lines.push(`${i + 1}. **${layer.name}** (${layer.directory}/) — ${layer.purpose}`);
      }
      lines.push('');
    }

    // Data Flow
    if (intel.architecture.dataFlow.length > 0) {
      lines.push('## Data Flow');
      lines.push(intel.architecture.dataFlow.join(' → '));
      lines.push('');
    }

    // Key Components
    if (intel.architecture.keyComponents.length > 0) {
      lines.push('## Key Components');
      lines.push('| Component | File | Responsibility |');
      lines.push('|-----------|------|---------------|');
      for (const comp of intel.architecture.keyComponents.slice(0, 15)) {
        lines.push(`| ${comp.name} | ${comp.file} | ${comp.purpose} |`);
      }
      lines.push('');
    }

    // Function stats
    lines.push('## Statistics');
    lines.push(`- Total functions: ${intel.architecture.functionStats.total}`);
    lines.push(`- Exported functions: ${intel.architecture.functionStats.exported}`);
    lines.push(`- Symbols tracked: ${intel.codebase.symbolCount}`);
    lines.push('');
  }

  // Dependency hotspots
  if (intel.dependencyHotspots.length > 0) {
    lines.push('## Dependency Hotspots');
    for (const hs of intel.dependencyHotspots.slice(0, 5)) {
      lines.push(`- \`${hs.file}\` — ${hs.dependentCount} dependents (risk: ${hs.riskLevel})`);
    }
    lines.push('');
  }

  return { frontmatter, autoContent: lines.join('\n') };
}

// ============================================================================
// Feature File Renderers
// ============================================================================

function renderFeatureSkill(
  feature: DetectedFeature,
  technologies: DetectedTechnology[],
  config: AgentConfig,
): { frontmatter: string; autoContent: string } {
  const techNames = technologies.map(t => t.name);
  const researchRefs = technologies.map(t => `research/${t.name}@${t.version}.md`);

  const frontmatter = [
    '---',
    `name: ${feature.name}-feature`,
    `description: ${feature.name} feature knowledge. Use when modifying files in ${feature.paths[0]}.`,
    'version: 1.0',
    'metadata:',
    '  scope: feature',
    '  generated_by: code-impact',
    `  technologies: [${techNames.join(', ')}]`,
    `  research_refs: [${researchRefs.join(', ')}]`,
    '---',
    '',
    `# ${capitalize(feature.name)} Feature`,
  ].join('\n');

  const lines: string[] = [];

  // Scope
  lines.push('## Scope');
  for (const p of feature.paths) {
    lines.push(`- ${p}`);
  }
  if (feature.testFiles.length > 0) {
    for (const tf of feature.testFiles) {
      lines.push(`- ${tf}`);
    }
  }
  lines.push('');

  // Key Facts
  lines.push('## Key Facts');
  lines.push(`- Files: ${feature.fileCount}`);
  lines.push(`- Cohesion score: ${feature.cohesionScore.toFixed(2)}`);
  if (feature.owner) {
    lines.push(`- Owner: ${feature.owner}`);
  }
  if (technologies.length > 0) {
    lines.push(`- Technologies: ${techNames.join(', ')}`);
  }
  lines.push('');

  // Research References
  if (researchRefs.length > 0) {
    lines.push('## Research References');
    for (const ref of researchRefs) {
      const tech = technologies.find(t => ref.includes(t.name));
      if (tech) {
        lines.push(`- [${tech.name} v${tech.version}](../${ref})`);
      }
    }
    lines.push('');
  }

  // Rules — derived from technology patterns and conventions
  lines.push('## Rules');
  if (technologies.length > 0) {
    for (const tech of technologies) {
      if (tech.name === 'express') {
        lines.push('- Use Router() for modular route definitions');
        lines.push('- Always register error handler middleware last');
      } else if (tech.name === 'better-sqlite3') {
        lines.push('- Use db.prepare().all() for SELECT, db.prepare().run() for INSERT/UPDATE/DELETE');
        lines.push('- better-sqlite3 is synchronous — do NOT use async/await');
      } else if (tech.name === 'stripe') {
        lines.push('- Always verify webhook signatures before processing events');
        lines.push('- Use idempotency keys for payment creation');
      } else if (tech.name === 'jsonwebtoken') {
        lines.push('- Always verify tokens before trusting decoded data');
        lines.push('- Set explicit expiration times on all tokens');
      } else {
        lines.push(`- Follow ${tech.name} v${tech.version} API conventions`);
      }
    }
  } else {
    lines.push('- Follow project coding conventions for this feature');
  }
  lines.push('');

  // Pitfalls — from research + known mistakes
  lines.push('## Pitfalls');
  if (technologies.length > 0) {
    for (const tech of technologies) {
      if (tech.name === 'express') {
        lines.push('- Forgetting to call next() in middleware causes request to hang');
      } else if (tech.name === 'better-sqlite3') {
        lines.push('- db.exec() returns nothing — using it for SELECT gives undefined');
      } else if (tech.name === 'stripe') {
        lines.push('- Stripe webhook events may arrive out of order — handle idempotently');
      } else if (tech.name === 'jsonwebtoken') {
        lines.push('- Using jwt.decode() without verify() is a security vulnerability');
      }
    }
    if (technologies.every(t => !['express', 'better-sqlite3', 'stripe', 'jsonwebtoken'].includes(t.name))) {
      lines.push('- Check research docs for version-specific breaking changes');
    }
  } else {
    lines.push('- Check for null/undefined before property access on external data');
  }
  lines.push('');

  return { frontmatter, autoContent: lines.join('\n') };
}

// ============================================================================
// File Writing with Marker Preservation + Content-Hash Dedup + Token Budget
// ============================================================================

type FileType = 'project_skill' | 'project_conventions' | 'project_architecture' | 'project_agent' | 'feature_skill' | 'feature_agent';

function writeMarkedFile(
  filePath: string,
  content: { frontmatter: string; autoContent: string },
  config: AgentConfig,
  result: GeneratorResult,
  fileType?: FileType,
): void {
  const { frontmatter, autoContent } = content;

  // Parse autoContent into prioritized sections for budget enforcement
  const sections = parseAutoContentSections(autoContent);

  // Get token budget for this file type
  const maxTokens = fileType ? DEFAULT_BUDGETS[fileType] : 0;

  const options: WriteOptions = {
    markers: config.markers,
    maxTokens,
  };

  const writeResult = writeMarkedFileImpl(filePath, frontmatter, sections, options);

  if (writeResult.written) {
    result.filesWritten.push(filePath);
  } else {
    result.filesSkipped.push(filePath);
  }
}

/**
 * Parse auto-content markdown into prioritized sections for budget enforcement.
 */
function parseAutoContentSections(autoContent: string): MarkedSection[] {
  const lines = autoContent.split('\n');
  const sections: MarkedSection[] = [];
  let currentName = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch && headingMatch[1]) {
      // Save previous section
      if (currentLines.length > 0 || currentName) {
        sections.push({
          name: currentName || 'preamble',
          content: currentLines.join('\n'),
          priority: getSectionPriority(currentName || 'preamble'),
        });
      }
      currentName = headingMatch[1];
      currentLines = [line]; // Include the heading in content
    } else {
      currentLines.push(line);
    }
  }

  // Last section
  if (currentLines.length > 0 || currentName) {
    sections.push({
      name: currentName || 'preamble',
      content: currentLines.join('\n'),
      priority: getSectionPriority(currentName || 'preamble'),
    });
  }

  return sections;
}

// ============================================================================
// Helpers
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, ' ');
}
