import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { CodeImpactEngine } from '../engine.js';
import { SkillReader } from './skill-reader.js';
import { getKnowledgePaths } from './workspace.js';

export interface SkillPatch {
  skillId: string;
  section: 'constraints' | 'pitfalls' | 'steps' | 'verification';
  action: 'add' | 'replace' | 'remove';
  content: string;
  reason: string;
}

export interface EvolutionResult {
  patches: SkillPatch[];
  applied: number;
  skipped: number;
  summary: string;
}

export interface SkillUsageSummary {
  skillId: string;
  usageCount: number;
  constraintHits: number;
  pitfallHits: number;
  avgScoreDelta: number;
  lastUsed: string;
  neverTriggeredConstraints: string[];
  frequentPitfalls: string[];
}

const EVOLUTION_THRESHOLD = 5;

export class SkillEvolutionEngine {
  private readonly engine: CodeImpactEngine;
  private readonly projectPath: string;

  constructor(engine: CodeImpactEngine) {
    this.engine = engine;
    this.projectPath = engine.getProjectPath();
  }

  evolve(): EvolutionResult {
    const patches: SkillPatch[] = [];

    try {
      patches.push(...this.detectNewBugPitfalls());
      patches.push(...this.detectStaleConstraints());
      patches.push(...this.detectFrequentPitfalls());
      patches.push(...this.detectRiskEscalations());
    } catch (err) {
      console.error('[SkillEvolution] analysis error:', err);
    }

    let applied = 0;
    let skipped = 0;

    for (const patch of patches) {
      const success = this.applyPatch(patch);
      if (success) {
        applied++;
        this.engine.logSkillEvolution({
          skillId: patch.skillId,
          action: patch.action,
          section: patch.section,
          content: patch.content,
          reason: patch.reason,
        });
      } else {
        skipped++;
      }
    }

    const summary = applied > 0
      ? `Evolved ${applied} skill(s): ${patches.filter((_, i) => i < applied).map((p) => p.skillId).join(', ')}`
      : 'No evolution needed';

    console.error(`[SkillEvolution] ${summary} (${skipped} skipped)`);
    return { patches, applied, skipped, summary };
  }

  getUsageSummaries(): SkillUsageSummary[] {
    const stats = this.engine.getSkillUsageStats(undefined, 30);
    const reader = new SkillReader(this.projectPath);
    const allSkills = reader.readAllSkills();
    const skillMap = new Map(allSkills.map((s) => [s.id, s]));

    return stats.map((s) => {
      const skill = skillMap.get(s.skill_id);
      const constraints = skill
        ? this.extractSection(skill.content, 'Rules')
        : [];
      const triggeredConstraints = new Set<string>();

      const usageLogs = this.engine.getSkillUsageStats(s.skill_id, 30);
      for (const log of usageLogs) {
        if (log.constraint_hits > 0) {
          triggeredConstraints.add(s.skill_id);
        }
      }

      const neverTriggered = s.usage_count >= EVOLUTION_THRESHOLD
        ? constraints.filter((c) => !triggeredConstraints.has(c))
        : [];

      return {
        skillId: s.skill_id,
        usageCount: s.usage_count,
        constraintHits: s.constraint_hits,
        pitfallHits: s.pitfall_hits,
        avgScoreDelta: s.avg_score_delta,
        lastUsed: s.last_used,
        neverTriggeredConstraints: neverTriggered,
        frequentPitfalls: [],
      };
    });
  }

  private detectNewBugPitfalls(): SkillPatch[] {
    const patches: SkillPatch[] = [];
    try {
      const recentBugs = this.engine.findSimilarBugs('error', 10);
      if (recentBugs.length === 0) return patches;

      const reader = new SkillReader(this.projectPath);
      for (const bug of recentBugs.slice(0, 5)) {
        if (!bug.file) continue;
        const skills = reader.findSkillsForFile(bug.file);
        for (const skill of skills) {
          const existingPitfalls = this.extractSection(skill.content, 'Watch Out');
          const bugDesc = `${bug.error.slice(0, 80)}${bug.fix ? ` — fix: ${bug.fix.slice(0, 60)}` : ''}`;
          const alreadyKnown = existingPitfalls.some(
            (p) => p.toLowerCase().includes(bug.error.slice(0, 30).toLowerCase()),
          );
          if (!alreadyKnown) {
            patches.push({
              skillId: skill.id,
              section: 'pitfalls',
              action: 'add',
              content: `Bug in ${bug.file}: ${bugDesc}`,
              reason: `New bug recorded in file covered by this skill`,
            });
          }
        }
      }
    } catch {
      // non-critical
    }
    return patches;
  }

  private detectStaleConstraints(): SkillPatch[] {
    const patches: SkillPatch[] = [];
    try {
      const stats = this.engine.getSkillUsageStats(undefined, 60);
      for (const stat of stats) {
        if (stat.usage_count >= EVOLUTION_THRESHOLD * 2 && stat.constraint_hits === 0) {
          patches.push({
            skillId: stat.skill_id,
            section: 'constraints',
            action: 'add',
            content: `[auto-note] This skill has been checked ${stat.usage_count} times with 0 constraint triggers. Consider reviewing constraints for relevance.`,
            reason: `${stat.usage_count} usages with 0 constraint hits suggests constraints may be stale`,
          });
        }
      }
    } catch {
      // non-critical
    }
    return patches;
  }

  private detectFrequentPitfalls(): SkillPatch[] {
    const patches: SkillPatch[] = [];
    try {
      const stats = this.engine.getSkillUsageStats(undefined, 30);
      for (const stat of stats) {
        if (stat.pitfall_hits > 3 && stat.usage_count >= EVOLUTION_THRESHOLD) {
          const ratio = stat.pitfall_hits / stat.usage_count;
          if (ratio > 0.5) {
            patches.push({
              skillId: stat.skill_id,
              section: 'constraints',
              action: 'add',
              content: `[promoted from pitfall] Pitfalls triggered in ${Math.round(ratio * 100)}% of usages — enforce as constraint.`,
              reason: `Pitfall trigger rate ${Math.round(ratio * 100)}% exceeds threshold, promoting to constraint`,
            });
          }
        }
      }
    } catch {
      // non-critical
    }
    return patches;
  }

  private detectRiskEscalations(): SkillPatch[] {
    const patches: SkillPatch[] = [];
    try {
      const stats = this.engine.getSkillUsageStats(undefined, 14);
      for (const stat of stats) {
        if (stat.avg_score_delta < -10 && stat.usage_count >= 3) {
          const reader = new SkillReader(this.projectPath);
          const skills = reader.readAllSkills().filter((s) => s.id === stat.skill_id);
          if (skills.length > 0) {
            const skill = skills[0]!;
            const currentPriority = skill.content.match(/priority: (\w+)/);
            if (currentPriority && currentPriority[1] !== 'high') {
              patches.push({
                skillId: stat.skill_id,
                section: 'verification',
                action: 'add',
                content: `[auto-escalated] Avg score impact: ${stat.avg_score_delta}. Run extra verification before changes in this area.`,
                reason: `Negative avg score delta (${stat.avg_score_delta}) over ${stat.usage_count} usages indicates risk escalation`,
              });
            }
          }
        }
      }
    } catch {
      // non-critical
    }
    return patches;
  }

  private applyPatch(patch: SkillPatch): boolean {
    try {
      const reader = new SkillReader(this.projectPath);
      const skills = reader.readAllSkills().filter((s) => s.id === patch.skillId);
      if (skills.length === 0) return false;

      const paths = getKnowledgePaths(this.projectPath);
      const allFiles = this.findSkillFile(paths.skillsRoot, patch.skillId);
      if (!allFiles) return false;

      let content = readFileSync(allFiles, 'utf-8');

      const sectionMap: Record<string, string> = {
        constraints: '## Rules',
        pitfalls: '## Watch Out',
        steps: '## Steps',
        verification: '## Verify',
      };

      const header = sectionMap[patch.section];
      if (!header) return false;

      const sectionRegex = new RegExp(`(${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n)([\\s\\S]*?)(?=\n## |$)`);
      const match = content.match(sectionRegex);
      if (!match) return false;

      if (patch.action === 'add') {
        const existingLines = match[2]!;
        if (existingLines.includes(patch.content)) return false;
        const newSection = `${match[1]}${existingLines.trimEnd()}\n- ${patch.content}\n`;
        content = content.replace(match[0], newSection);
      } else if (patch.action === 'remove') {
        const lines = match[2]!.split('\n');
        const filtered = lines.filter((l) => !l.includes(patch.content));
        if (filtered.length === lines.length) return false;
        content = content.replace(match[0], `${match[1]}${filtered.join('\n')}`);
      }

      writeFileSync(allFiles, content);
      return true;
    } catch {
      return false;
    }
  }

  private findSkillFile(dir: string, skillId: string): string | null {
    const { readdirSync, statSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');

    if (!existsSync(dir)) return null;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const found = this.findSkillFile(fullPath, skillId);
        if (found) return found;
      } else if (entry.endsWith('.md')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          if (content.startsWith(`# ${skillId}\n`) || content.startsWith(`# ${skillId}\r\n`)) {
            return fullPath;
          }
        } catch {
          // skip
        }
      }
    }
    return null;
  }

  private extractSection(content: string, header: string): string[] {
    const regex = new RegExp(`## ${header}\n([\\s\\S]*?)(?:\n## |$)`);
    const match = content.match(regex);
    if (!match || !match[1]) return [];
    return match[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  }
}
