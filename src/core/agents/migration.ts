/**
 * Migration Engine — transfers skills from legacy knowledge/ directory
 * to .code-impact/ as the single source of truth.
 *
 * Features:
 * - Dry-run mode: report what would be migrated without writing
 * - Backup: optionally backup originals before migration
 * - Conflict resolution: skip if target exists, merge rules/pitfalls
 * - Reads both legacy marker formats
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'fs';
import { join, relative, basename, dirname } from 'path';
import { getAgentWorkspacePaths, readAgentConfig, initAgentWorkspace } from './workspace.js';

// ============================================================================
// Types
// ============================================================================

export interface MigrationOptions {
  projectPath: string;
  dryRun?: boolean;
  backup?: boolean;
}

export interface MigrationResult {
  success: boolean;
  migrated: MigratedSkill[];
  skipped: SkippedSkill[];
  conflicts: ConflictSkill[];
  backupDir?: string;
}

export interface MigratedSkill {
  source: string;
  target: string;
  type: 'technology' | 'feature' | 'project';
}

export interface SkippedSkill {
  source: string;
  reason: string;
}

export interface ConflictSkill {
  source: string;
  target: string;
  resolution: 'skipped' | 'merged';
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Migrate skills from knowledge/ to .code-impact/.
 */
export function migrateKnowledge(options: MigrationOptions): MigrationResult {
  const { projectPath, dryRun = false, backup = false } = options;
  const result: MigrationResult = {
    success: true,
    migrated: [],
    skipped: [],
    conflicts: [],
  };

  const knowledgeDir = join(projectPath, 'knowledge');
  if (!existsSync(knowledgeDir)) {
    result.skipped.push({ source: 'knowledge/', reason: 'Directory does not exist' });
    return result;
  }

  // Ensure .code-impact workspace exists
  if (!dryRun) {
    initAgentWorkspace(projectPath);
  }

  const paths = getAgentWorkspacePaths(projectPath);

  // Backup if requested
  if (backup && !dryRun) {
    const backupDir = join(projectPath, `knowledge-backup-${Date.now()}`);
    cpSync(knowledgeDir, backupDir, { recursive: true });
    result.backupDir = backupDir;
  }

  // Discover skills in knowledge/
  const skillFiles = discoverSkillFiles(knowledgeDir);

  for (const skillFile of skillFiles) {
    const relPath = relative(knowledgeDir, skillFile);
    const classification = classifySkillPath(relPath);

    if (!classification) {
      result.skipped.push({ source: relPath, reason: 'Unknown skill path structure' });
      continue;
    }

    // Determine target path
    const targetPath = resolveTargetPath(paths, classification);

    if (existsSync(targetPath) && !dryRun) {
      // Conflict: target already exists — try to merge
      const merged = mergeSkills(skillFile, targetPath);
      if (merged) {
        result.conflicts.push({ source: relPath, target: relative(projectPath, targetPath), resolution: 'merged' });
      } else {
        result.conflicts.push({ source: relPath, target: relative(projectPath, targetPath), resolution: 'skipped' });
      }
      continue;
    }

    if (!dryRun) {
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(skillFile, targetPath);
    }

    result.migrated.push({
      source: relPath,
      target: relative(projectPath, targetPath),
      type: classification.type,
    });
  }

  return result;
}

// ============================================================================
// Skill Discovery
// ============================================================================

function discoverSkillFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string) {
    if (!existsSync(current)) return;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === 'SKILL.md' || entry.name.endsWith('.skill.md')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

// ============================================================================
// Path Classification
// ============================================================================

interface SkillClassification {
  type: 'technology' | 'feature' | 'project';
  name: string;
}

function classifySkillPath(relPath: string): SkillClassification | null {
  // knowledge/skills/technology/{name}/SKILL.md
  const techMatch = relPath.match(/skills[/\\]technology[/\\]([^/\\]+)[/\\]SKILL\.md$/i);
  if (techMatch && techMatch[1]) {
    return { type: 'technology', name: techMatch[1] };
  }

  // knowledge/skills/feature/{name}/SKILL.md
  const featureMatch = relPath.match(/skills[/\\]feature[/\\]([^/\\]+)[/\\]SKILL\.md$/i);
  if (featureMatch && featureMatch[1]) {
    return { type: 'feature', name: featureMatch[1] };
  }

  // knowledge/skills/project/SKILL.md
  const projectMatch = relPath.match(/skills[/\\]project[/\\]SKILL\.md$/i);
  if (projectMatch) {
    return { type: 'project', name: 'project' };
  }

  // Generic: knowledge/skills/{name}/SKILL.md
  const genericMatch = relPath.match(/skills[/\\]([^/\\]+)[/\\]SKILL\.md$/i);
  if (genericMatch && genericMatch[1]) {
    return { type: 'technology', name: genericMatch[1] };
  }

  // Any SKILL.md at any level
  const anyMatch = relPath.match(/([^/\\]+)[/\\]SKILL\.md$/i);
  if (anyMatch && anyMatch[1]) {
    return { type: 'feature', name: anyMatch[1] };
  }

  return null;
}

function resolveTargetPath(
  paths: ReturnType<typeof getAgentWorkspacePaths>,
  classification: SkillClassification,
): string {
  switch (classification.type) {
    case 'technology':
      // Technology skills go to research/{name}.md or project/SKILL.md
      return join(paths.projectDir, `${classification.name}-SKILL.md`);
    case 'feature':
      return join(paths.featuresDir, classification.name, 'SKILL.md');
    case 'project':
      return join(paths.projectDir, 'SKILL.md');
    default:
      return join(paths.projectDir, `${classification.name}-SKILL.md`);
  }
}

// ============================================================================
// Skill Merging
// ============================================================================

function mergeSkills(sourcePath: string, targetPath: string): boolean {
  try {
    const sourceContent = readFileSync(sourcePath, 'utf-8');
    const targetContent = readFileSync(targetPath, 'utf-8');

    // Extract rules and pitfalls from source
    const sourceRules = extractSection(sourceContent, 'Rules');
    const sourcePitfalls = extractSection(sourceContent, 'Pitfalls');

    if (!sourceRules && !sourcePitfalls) return false;

    let updated = targetContent;

    // Append source rules to target
    if (sourceRules) {
      const targetRulesIdx = updated.indexOf('## Rules');
      if (targetRulesIdx >= 0) {
        // Find end of rules section
        const nextSectionIdx = findNextSection(updated, targetRulesIdx + 8);
        const insertPoint = nextSectionIdx >= 0 ? nextSectionIdx : updated.length;
        updated = updated.slice(0, insertPoint) + sourceRules + '\n\n' + updated.slice(insertPoint);
      } else {
        updated += '\n\n## Rules\n' + sourceRules;
      }
    }

    if (sourcePitfalls) {
      const targetPitfallsIdx = updated.indexOf('## Pitfalls');
      if (targetPitfallsIdx >= 0) {
        const nextSectionIdx = findNextSection(updated, targetPitfallsIdx + 11);
        const insertPoint = nextSectionIdx >= 0 ? nextSectionIdx : updated.length;
        updated = updated.slice(0, insertPoint) + sourcePitfalls + '\n\n' + updated.slice(insertPoint);
      } else {
        updated += '\n\n## Pitfalls\n' + sourcePitfalls;
      }
    }

    if (updated !== targetContent) {
      writeFileSync(targetPath, updated);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function extractSection(content: string, heading: string): string | null {
  const idx = content.indexOf(`## ${heading}`);
  if (idx < 0) return null;
  const afterHeading = content.slice(idx + `## ${heading}`.length);
  const nextSection = findNextSection(afterHeading, 0);
  const section = nextSection >= 0 ? afterHeading.slice(0, nextSection) : afterHeading;
  const lines = section.split('\n').filter(l => l.startsWith('- '));
  return lines.length > 0 ? lines.join('\n') : null;
}

function findNextSection(content: string, startFrom: number): number {
  const match = content.slice(startFrom).match(/\n## /);
  return match ? startFrom + match.index! : -1;
}
