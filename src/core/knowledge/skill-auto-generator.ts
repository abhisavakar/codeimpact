import { existsSync, readFileSync } from 'fs';
import type { ProjectIntelligence } from './intelligence-collector.js';
import type { ProviderResearchEntry } from './provider-research.js';
import type { FeatureCluster } from '../living-docs/feature-aggregator.js';
import { writeSkillMd, getSkillPath, type SkillMdInput } from './skill-generator.js';
import { readManifest, writeManifest } from './workspace.js';

export interface AutoGenerateInput {
  intel: ProjectIntelligence;
  providers: ProviderResearchEntry[];
  features: FeatureCluster[];
}

export interface AutoGenerateResult {
  skillsGenerated: number;
  skipped: number;
  paths: string[];
}

export class SkillAutoGenerator {
  constructor(private readonly projectPath: string) {}

  shouldAutoGenerate(): boolean {
    const manifest = readManifest(this.projectPath);
    if (!manifest.autoGeneration) return true;

    const previousCount = manifest.autoGeneration.fileCountAtRun;
    if (previousCount === 0) return true;

    const currentCount = this.getCurrentFileCount();
    const growthRatio = (currentCount - previousCount) / previousCount;
    return growthRatio > 0.2;
  }

  generate(input: AutoGenerateInput): AutoGenerateResult {
    const result: AutoGenerateResult = { skillsGenerated: 0, skipped: 0, paths: [] };

    if (!this.shouldAutoGenerate()) {
      console.error('[SkillAutoGenerator] skipping — project has not grown >20% since last run');
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

    // Write autoGeneration tracking to manifest
    const manifest = readManifest(this.projectPath);
    manifest.autoGeneration = {
      lastRunAt: new Date().toISOString(),
      fileCountAtRun: input.intel.codebase.fileCount,
      skillsGenerated: result.skillsGenerated,
    };
    writeManifest(this.projectPath, manifest);

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

      // Try to match provider by topic name or common aliases
      let provider: ProviderResearchEntry | undefined;
      for (const [key, p] of providerMap.entries()) {
        if (key === topicKey || topicKey.includes(key) || key.includes(topicKey)) {
          provider = p;
          break;
        }
      }

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

      const body = `# ${tech.name} Patterns

## Key Files
${keyFiles}

## Rules
- Follow ${provider.provider} best practices: ${provider.summary.split('\n')[0]}
${tech.importPaths.length > 0 ? '- Key integration files: ' + tech.importPaths.slice(0, 3).map(f => '`' + f + '`').join(', ') : ''}

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

      const riskFiles = intel.riskFiles
        .filter(r => cluster.files.some(f => f.includes(r.file) || r.file.includes(cluster.directory)))
        .slice(0, 5);

      const hotspots = intel.dependencyHotspots
        .filter(h => cluster.files.some(f => f.includes(h.file) || h.file.includes(cluster.directory)))
        .slice(0, 5);

      const relatedDecisions = intel.decisions
        .filter(d => d.files.some(df => cluster.files.some(cf => cf.includes(df) || df.includes(cluster.directory))))
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

  private extractPitfalls(summary: string): string[] {
    const pitfalls: string[] = [];
    const lines = summary.split('\n');
    let inPitfalls = false;

    for (const line of lines) {
      if (line.includes('pitfalls:') || line.includes('Pitfalls:')) {
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

  private getCurrentFileCount(): number {
    try {
      const manifest = readManifest(this.projectPath);
      return manifest.generatedFrom.indexedFiles;
    } catch {
      return 0;
    }
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
