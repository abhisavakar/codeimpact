import { existsSync } from 'fs';
import { join } from 'path';
import type { CodeImpactEngine } from '../engine.js';
import type { ArchitectureDoc, ComponentDoc, DailyChangelog } from '../../types/documentation.js';
import { readManifest, writeManifest, ensureKnowledgeWorkspace, toProjectRelative, type KnowledgeManifest, type KnowledgeStatus } from './workspace.js';
import { KnowledgeDocSync } from './doc-sync.js';
import { PlatformRuleSync, type PlatformSyncResult } from './platform-sync.js';
import { ProviderResearch, type ProviderResearchEntry } from './provider-research.js';
import { IntelligenceCollector, type ProjectIntelligence } from './intelligence-collector.js';
import { SkillEvolutionEngine } from './skill-evolution.js';
import { SkillReader } from './skill-reader.js';
import { FeatureAggregator } from '../living-docs/feature-aggregator.js';

export interface KnowledgeGenerateOptions {
  reason?: string;
  changedFiles?: string[];
  dryRun?: boolean;
  architecture?: ArchitectureDoc;
  componentDocs?: ComponentDoc[];
  changelog?: DailyChangelog[];
}

export interface KnowledgeGenerateResult {
  manifest: KnowledgeManifest;
  syncedRules: PlatformSyncResult[];
}

export class KnowledgeOrchestrator {
  private readonly docSync: KnowledgeDocSync;
  private readonly platformSync: PlatformRuleSync;
  private readonly providerResearch: ProviderResearch;
  private readonly intelligenceCollector: IntelligenceCollector;
  private readonly evolutionEngine: SkillEvolutionEngine;
  private readonly featureAggregator: FeatureAggregator;
  private readonly skillReader: SkillReader;
  private timer: NodeJS.Timeout | null = null;
  private lastReason = 'unspecified';
  private pendingFiles = new Set<string>();
  private lastContentHash = '';
  private generateCount = 0;

  constructor(
    private readonly projectPath: string,
    private readonly engine: CodeImpactEngine,
  ) {
    this.docSync = new KnowledgeDocSync(projectPath);
    this.platformSync = new PlatformRuleSync(projectPath);
    this.providerResearch = new ProviderResearch(projectPath);
    this.intelligenceCollector = new IntelligenceCollector(engine);
    this.evolutionEngine = new SkillEvolutionEngine(engine);
    this.featureAggregator = new FeatureAggregator(projectPath, engine.getDatabase());
    this.skillReader = new SkillReader(projectPath);
  }

  schedule(reason: string, changedFiles: string[] = [], delayMs = 1500): void {
    this.lastReason = reason;
    for (const file of changedFiles) {
      this.pendingFiles.add(file);
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      Promise.resolve(this.generate({
        reason: this.lastReason,
        changedFiles: Array.from(this.pendingFiles),
      })).catch((error) => {
        console.error('[Knowledge] generation failed:', error);
      });
      this.pendingFiles.clear();
      this.timer = null;
    }, delayMs);
  }

  getStatus(): KnowledgeStatus {
    const paths = ensureKnowledgeWorkspace(this.projectPath);
    const manifest = readManifest(this.projectPath);
    return {
      generatedAt: manifest.generatedAt,
      skillCount: manifest.skills.length,
      docCount: manifest.docs.length,
      providerCount: manifest.providers.length,
      workspaceRoot: paths.root,
    };
  }

  generate(options?: KnowledgeGenerateOptions): KnowledgeGenerateResult {
    const reason = options?.reason || 'manual';
    const dryRun = !!options?.dryRun;
    console.error(`[Knowledge] generate start (reason=${reason}, dryRun=${dryRun})`);
    const paths = ensureKnowledgeWorkspace(this.projectPath);
    const manifest = readManifest(this.projectPath);

    const intel = this.intelligenceCollector.collect();

    this.fetchLivingDocsIntoOptions(options || {});

    const docs = this.mergeDocsWithExisting(manifest.docs, options, paths);

    const providerResults: ProviderResearchEntry[] = this.providerResearch.refresh({
      topics: this.detectProviderTopics(intel),
      dryRun,
    });
    for (const provider of providerResults) {
      const slug = provider.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      docs.push({
        type: 'integration',
        file: toProjectRelative(this.projectPath, `${paths.integrationDocsRoot}/${slug}.md`),
        updatedAt: provider.fetchedAt,
      });
    }

    let evolutionGuidance: string[] = [];
    this.generateCount++;
    if (!dryRun && this.generateCount % 3 === 0) {
      try {
        const evoResult = this.evolutionEngine.evolve();
        if (evoResult.applied > 0) {
          console.error(`[Knowledge] skill evolution: ${evoResult.summary}`);
        }
        const summaries = this.evolutionEngine.getUsageSummaries();
        evolutionGuidance = summaries
          .filter((s) => s.avgScoreDelta < -5 || s.pitfallHits > 3)
          .slice(0, 5)
          .map((s) => `${s.skillId}: ${s.avgScoreDelta < -5 ? `negative score impact (avg ${s.avgScoreDelta})` : `frequent pitfalls (${s.pitfallHits})`}`);
      } catch (err) {
        console.error('[Knowledge] evolution error:', err);
      }
    }

    const existingSkills = this.skillReader.readLevel0();
    const skillEntries = existingSkills.map((s) => ({
      name: s.name,
      description: s.description,
      scope: s.scope,
      file: toProjectRelative(this.projectPath, s.filePath),
      updatedAt: new Date().toISOString(),
    }));

    const skillIndex = existingSkills.map((s) => `${s.name}: ${s.description.slice(0, 80)}`);
    const skipSync = !dryRun && this.shouldSkipPlatformSync(skillIndex);
    const syncedRules = skipSync
      ? []
      : this.platformSync.syncAll(paths, skillIndex, { dryRun, evolutionGuidance });

    const updatedManifest: KnowledgeManifest = {
      ...manifest,
      generatedAt: new Date().toISOString(),
      generatedFrom: {
        indexedFiles: intel.codebase.fileCount,
        source: 'knowledge_orchestrator',
        reason,
      },
      skills: skillEntries,
      docs,
      providers: providerResults.map((provider) => ({
        provider: provider.provider,
        topic: provider.topic,
        file: `knowledge/docs/integrations/${provider.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
        fetchedAt: provider.fetchedAt,
        freshnessHours: provider.freshnessHours,
      })),
    };

    if (!dryRun) {
      try {
        const featureResult = this.featureAggregator.aggregate();
        for (const fPath of featureResult.files) {
          const relPath = toProjectRelative(this.projectPath, fPath);
          updatedManifest.docs.push({
            type: 'feature',
            file: relPath,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[Knowledge] feature aggregation error:', err);
      }

      writeManifest(this.projectPath, updatedManifest);

      try {
        this.docSync.syncIndex(updatedManifest);
      } catch {
        // non-critical
      }
    }

    console.error(
      `[Knowledge] generate done (skills=${updatedManifest.skills.length}, docs=${updatedManifest.docs.length}, providers=${updatedManifest.providers.length})`,
    );

    return { manifest: updatedManifest, syncedRules };
  }

  syncRulesOnly(dryRun = false): PlatformSyncResult[] {
    const paths = ensureKnowledgeWorkspace(this.projectPath);
    const existingSkills = this.skillReader.readLevel0();
    const skillIndex = existingSkills.map((s) => `${s.name}: ${s.description.slice(0, 80)}`);
    return this.platformSync.syncAll(paths, skillIndex, { dryRun });
  }

  refreshProviderResearch(topics?: string[], dryRun = false): ProviderResearchEntry[] {
    return this.providerResearch.refresh({ topics, dryRun });
  }

  private fetchLivingDocsIntoOptions(options: KnowledgeGenerateOptions): void {
    try {
      if (!options.architecture) {
        const cached = this.engine.getCachedArchitectureDoc();
        if (cached) {
          options.architecture = cached as ArchitectureDoc;
        }
      }
    } catch {
      // living docs may not be ready yet
    }

    try {
      if (!options.changelog) {
        const cachedChangelog = this.engine.getCachedChangelog();
        if (cachedChangelog && cachedChangelog.length > 0) {
          options.changelog = cachedChangelog as DailyChangelog[];
        }
      }
    } catch {
      // changelog may not be ready yet
    }
  }

  private mergeDocsWithExisting(
    existingDocs: KnowledgeManifest['docs'],
    options: KnowledgeGenerateOptions | undefined,
    paths: ReturnType<typeof ensureKnowledgeWorkspace>,
  ): KnowledgeManifest['docs'] {
    const docMap = new Map<string, KnowledgeManifest['docs'][0]>();

    for (const doc of existingDocs) {
      docMap.set(doc.file, doc);
    }

    if (options?.architecture) {
      const out = this.docSync.syncArchitecture(options.architecture);
      const relPath = toProjectRelative(this.projectPath, out.mdPath);
      docMap.set(relPath, { type: 'architecture', file: relPath, updatedAt: new Date().toISOString() });
    }
    if (options?.componentDocs?.length) {
      for (const componentDoc of options.componentDocs) {
        const out = this.docSync.syncComponent(componentDoc);
        const relPath = toProjectRelative(this.projectPath, out.mdPath);
        docMap.set(relPath, { type: 'feature', file: relPath, updatedAt: new Date().toISOString() });
      }
    }
    if (options?.changelog?.length) {
      const out = this.docSync.syncChangelog(options.changelog);
      const relPath = toProjectRelative(this.projectPath, out.mdPath);
      docMap.set(relPath, { type: 'changelog', file: relPath, updatedAt: new Date().toISOString() });
    }

    return Array.from(docMap.values());
  }

  private computeContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  private shouldSkipPlatformSync(skillIndex: string[]): boolean {
    const newHash = this.computeContentHash(skillIndex.join('|'));
    if (newHash === this.lastContentHash) {
      return true;
    }
    this.lastContentHash = newHash;
    return false;
  }

  private detectProviderTopics(intel: ProjectIntelligence): string[] {
    const topics: string[] = [];
    for (const tech of intel.detectedTechnologies) {
      const name = tech.name.toLowerCase();
      if (name.includes('fastapi') || name.includes('flask') || name.includes('django')) topics.push('fastapi');
      if (name.includes('aws')) topics.push('aws');
      if (name.includes('jwt') || name.includes('passport')) topics.push('jwt');
      if (name.includes('stripe')) topics.push('stripe');
      if (name.includes('graphql')) topics.push('graphql');
      if (name.includes('prisma') || name.includes('typeorm') || name.includes('mongoose')) topics.push('database');
    }
    return topics.length > 0 ? [...new Set(topics)] : ['general'];
  }
}
