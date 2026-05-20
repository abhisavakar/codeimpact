import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ProjectIntelligence } from './intelligence-collector.js';
import type { ProviderResearchEntry } from './provider-research.js';
import type { FeatureCluster } from '../living-docs/feature-aggregator.js';
import { writeSkillMd, getSkillPath, slugify, type SkillMdInput } from './skill-generator.js';
import { readManifest, getKnowledgePaths } from './workspace.js';

export interface AutoGenerateInput {
  intel: ProjectIntelligence;
  providers: ProviderResearchEntry[];
  features: FeatureCluster[];
}

export interface AutoGenerateResult {
  skillsGenerated: number;
  skipped: number;
  paths: string[];
  /** Tracking data for the orchestrator to write into the manifest (C2 fix: single writer) */
  autoGeneration: {
    lastRunAt: string;
    fileCountAtRun: number;
    skillsGenerated: number;
  } | null;
}

export class SkillAutoGenerator {
  constructor(private readonly projectPath: string) {}

  shouldAutoGenerate(currentFileCount: number): boolean {
    const manifest = readManifest(this.projectPath);
    if (!manifest.autoGeneration) return true;

    // If skills directory is empty/missing, regenerate regardless of file count
    if (!this.hasExistingSkills()) return true;

    const previousCount = manifest.autoGeneration.fileCountAtRun;
    if (previousCount === 0) return true;

    // C1 fix: use actual current file count, not stale manifest data
    // W3 fix: also regenerate on significant shrinkage (>20%)
    const growthRatio = (currentFileCount - previousCount) / previousCount;
    return Math.abs(growthRatio) > 0.2;
  }

  generate(input: AutoGenerateInput): AutoGenerateResult {
    const result: AutoGenerateResult = { skillsGenerated: 0, skipped: 0, paths: [], autoGeneration: null };
    const currentFileCount = input.intel.codebase.fileCount;

    if (!this.shouldAutoGenerate(currentFileCount)) {
      console.error('[SkillAutoGenerator] skipping — project has not changed >20% since last run');
      return result;
    }

    // A. Technology skills (cap: 5)
    const techResult = this.generateTechnologySkills(input.intel, input.providers);
    result.skillsGenerated += techResult.generated;
    result.skipped += techResult.skipped;
    result.paths.push(...techResult.paths);

    // B. Feature skills (cap: 10, skip clusters < 3 files)
    const featureResult = this.generateFeatureSkills(input.intel, input.features);
    result.skillsGenerated += featureResult.generated;
    result.skipped += featureResult.skipped;
    result.paths.push(...featureResult.paths);

    // C. Project conventions skill (core, one per project)
    const convResult = this.generateProjectConventionsSkill(input.intel);
    result.skillsGenerated += convResult.generated;
    result.skipped += convResult.skipped;
    result.paths.push(...convResult.paths);

    // C2 fix: return tracking data instead of writing manifest directly
    result.autoGeneration = {
      lastRunAt: new Date().toISOString(),
      fileCountAtRun: currentFileCount,
      skillsGenerated: result.skillsGenerated,
    };

    console.error(`[SkillAutoGenerator] generated=${result.skillsGenerated}, skipped=${result.skipped}`);
    return result;
  }

  private generateTechnologySkills(
    intel: ProjectIntelligence,
    providers: ProviderResearchEntry[],
  ): { generated: number; skipped: number; paths: string[] } {
    let generated = 0;
    let skipped = 0;
    const paths: string[] = [];
    const providerMap = new Map<string, ProviderResearchEntry>();

    for (const p of providers) {
      providerMap.set(p.topic.toLowerCase(), p);
    }

    for (const tech of intel.detectedTechnologies) {
      if (generated >= 5) break;

      const topicKey = tech.name.toLowerCase()
        .replace(/\.js$/, '')
        .replace(/\s+/g, '-');

      // W1 fix: tighter provider matching — exact match or whole-word containment with min length
      const provider = this.matchProvider(topicKey, providerMap);

      if (!provider) {
        skipped++;
        continue;
      }

      const skillName = `${slugify(tech.name)}-patterns`;

      if (this.isUserEdited(skillName, 'technology')) {
        skipped++;
        continue;
      }

      const keyFiles = tech.importPaths.length > 0
        ? tech.importPaths.slice(0, 10).map(f => `- \`${f}\``).join('\n')
        : '- (no specific files detected)';

      const pitfalls = this.extractPitfalls(provider.summary);

      // M1 fix: conditionally include key integration files line to avoid blank lines
      const integrationLine = tech.importPaths.length > 0
        ? '\n- Key integration files: ' + tech.importPaths.slice(0, 3).map(f => '`' + f + '`').join(', ')
        : '';

      const body = `# ${tech.name} Patterns

## Key Files
${keyFiles}

## Rules
- Follow ${provider.provider} best practices: ${provider.summary.split('\n')[0]}${integrationLine}

## Watch Out
${pitfalls.length > 0 ? pitfalls.map(p => `- ${p}`).join('\n') : '- Review provider docs for latest pitfalls'}

## Verification
- Check imports reference correct ${tech.name} APIs
- Verify patterns align with ${provider.provider} documentation
`;

      const input: SkillMdInput = {
        name: skillName,
        description: `${tech.name} patterns and pitfalls for this project`,
        scope: 'technology',
        metadata: { auto_generated: 'true' },
        body,
      };

      const path = writeSkillMd(this.projectPath, input);
      paths.push(path);
      generated++;
    }

    return { generated, skipped, paths };
  }

  private generateFeatureSkills(
    intel: ProjectIntelligence,
    features: FeatureCluster[],
  ): { generated: number; skipped: number; paths: string[] } {
    let generated = 0;
    let skipped = 0;
    const paths: string[] = [];

    for (const cluster of features) {
      if (generated >= 10) break;

      // Skip clusters with < 3 files
      if (cluster.files.length < 3) {
        skipped++;
        continue;
      }

      const skillName = slugify(cluster.name);

      if (this.isUserEdited(skillName, 'feature')) {
        skipped++;
        continue;
      }

      const keyFiles = cluster.files.slice(0, 15).map(f => `- \`${f}\``).join('\n');

      // W4 fix: use normalized path containment instead of bidirectional includes()
      const clusterDir = cluster.directory.replace(/\\/g, '/');

      const riskFiles = intel.riskFiles
        .filter(r => {
          const riskPath = r.file.replace(/\\/g, '/');
          return riskPath.startsWith(clusterDir + '/') || cluster.files.some(f => f.replace(/\\/g, '/') === riskPath);
        })
        .slice(0, 5);

      const hotspots = intel.dependencyHotspots
        .filter(h => {
          const hotPath = h.file.replace(/\\/g, '/');
          return hotPath.startsWith(clusterDir + '/') || cluster.files.some(f => f.replace(/\\/g, '/') === hotPath);
        })
        .slice(0, 5);

      const relatedDecisions = intel.decisions
        .filter(d => d.files.some(df => {
          const decPath = df.replace(/\\/g, '/');
          return decPath.startsWith(clusterDir + '/') || cluster.files.some(cf => cf.replace(/\\/g, '/') === decPath);
        }))
        .slice(0, 5);

      const sharedDeps = cluster.sharedDependencies.length > 0
        ? cluster.sharedDependencies.slice(0, 5).map(d => `- Shared dependency: \`${d}\``).join('\n')
        : '';

      const decisionRules = relatedDecisions.length > 0
        ? relatedDecisions.map(d => `- Decision: ${d.title}`).join('\n')
        : '';

      const riskWarnings = riskFiles.length > 0
        ? riskFiles.map(r => `- \`${r.file}\` — risk ${r.riskLevel} (score: ${r.riskScore}): ${r.recommendation}`).join('\n')
        : '';

      const hotspotWarnings = hotspots.length > 0
        ? hotspots.map(h => `- \`${h.file}\` — ${h.dependentCount} dependents, risk ${h.riskLevel}`).join('\n')
        : '';

      const body = `# Feature: ${cluster.name}

Directory: \`${cluster.directory}\`
Purpose: ${cluster.purpose}

## Key Files
${keyFiles}

## Rules
- Maintain API contracts for shared dependencies in this module
${sharedDeps}
${decisionRules}

## Watch Out
${riskWarnings || hotspotWarnings ? `${riskWarnings}\n${hotspotWarnings}`.trim() : '- No high-risk files detected in this cluster'}

## Verification
- Changes to shared dependencies require checking all ${cluster.files.length} files in this module
${cluster.decisionTags.length > 0 ? `- Verify alignment with decisions: ${cluster.decisionTags.slice(0, 3).join(', ')}` : ''}
`;

      const input: SkillMdInput = {
        name: skillName,
        description: `Feature skill for ${cluster.name} (${cluster.files.length} files)`,
        scope: 'feature',
        metadata: { auto_generated: 'true' },
        body,
      };

      const path = writeSkillMd(this.projectPath, input);
      paths.push(path);
      generated++;
    }

    return { generated, skipped, paths };
  }

  private generateProjectConventionsSkill(
    intel: ProjectIntelligence,
  ): { generated: number; skipped: number; paths: string[] } {
    const skillName = 'project-conventions';

    if (this.isUserEdited(skillName, 'core')) {
      return { generated: 0, skipped: 1, paths: [] };
    }

    const languages = intel.codebase.languages.join(', ') || 'unknown';
    const testFramework = intel.tests.framework || 'unknown';

    const layers = intel.architecture?.layers ?? [];
    const layerRules = layers.length > 0
      ? layers.slice(0, 5).map(l => `- Layer \`${l.name}\` in \`${l.directory}\`: ${l.purpose}`).join('\n')
      : '- No architectural layers detected';

    const topPatterns = intel.architecture?.topPatterns ?? [];
    const patternRules = topPatterns.length > 0
      ? topPatterns.slice(0, 5).map(p => `- Pattern: ${p.name} (used ${p.usageCount} times)`).join('\n')
      : '';

    const riskWarnings = intel.riskFiles.slice(0, 5).map(
      r => `- \`${r.file}\` — risk ${r.riskLevel} (score: ${r.riskScore})`
    ).join('\n') || '- No high-risk files detected';

    const changeHotspots = intel.changeHotspots.slice(0, 5).map(
      h => `- \`${h.file}\` — ${h.changeCount} recent changes`
    ).join('\n') || '- No change hotspots detected';

    const body = `# Project Conventions

## Key Facts
- Languages: ${languages}
- Test framework: ${testFramework}
- Total files: ${intel.codebase.fileCount}
- Total symbols: ${intel.codebase.symbolCount}

## Rules
- Follow ${languages} conventions throughout the project
${layerRules}
${patternRules}

## Watch Out
### Risk Files
${riskWarnings}

### Change Hotspots
${changeHotspots}

## Verification
- Run tests with ${testFramework} before committing
- Check blast radius for changes to risk files
`;

    const input: SkillMdInput = {
      name: skillName,
      description: `Project-wide conventions, patterns, and risk areas`,
      scope: 'core',
      metadata: { auto_generated: 'true' },
      body,
    };

    const path = writeSkillMd(this.projectPath, input);
    return { generated: 1, skipped: 0, paths: [path] };
  }

  /** W1 fix: tighter matching — exact match, or contained match only if key is 3+ chars */
  private matchProvider(
    topicKey: string,
    providerMap: Map<string, ProviderResearchEntry>,
  ): ProviderResearchEntry | undefined {
    // Exact match first
    const exact = providerMap.get(topicKey);
    if (exact) return exact;

    // Contained match — require min 3 chars to avoid false positives like "js" matching everything
    for (const [key, p] of providerMap.entries()) {
      if (key.length < 3 && topicKey.length < 3) continue;
      if (topicKey === key) return p;
      if (key.length >= 3 && topicKey.includes(key)) return p;
      if (topicKey.length >= 3 && key.includes(topicKey)) return p;
    }
    return undefined;
  }

  private isUserEdited(skillName: string, scope: string): boolean {
    const skillPath = getSkillPath(this.projectPath, skillName, scope);
    if (!existsSync(skillPath)) return false;

    try {
      const content = readFileSync(skillPath, 'utf-8');
      return !content.includes('auto_generated: true');
    } catch {
      return false;
    }
  }

  /** M2 fix: case-insensitive pitfall heading detection */
  private extractPitfalls(summary: string): string[] {
    const pitfalls: string[] = [];
    const lines = summary.split('\n');
    let inPitfalls = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('pitfalls:')) {
        inPitfalls = true;
        continue;
      }
      if (inPitfalls && line.startsWith('- ')) {
        pitfalls.push(line.slice(2));
      } else if (inPitfalls && !line.startsWith('- ') && line.trim() !== '') {
        inPitfalls = false;
      }
    }

    return pitfalls;
  }

  /** M4 fix: check for actual SKILL.md files, not just non-empty dirs */
  private hasExistingSkills(): boolean {
    try {
      const paths = getKnowledgePaths(this.projectPath);
      if (!existsSync(paths.skillsRoot)) return false;
      const categories = readdirSync(paths.skillsRoot, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catPath = join(paths.skillsRoot, cat.name);
        const entries = readdirSync(catPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = join(catPath, entry.name, 'SKILL.md');
            if (existsSync(skillMd)) return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}
