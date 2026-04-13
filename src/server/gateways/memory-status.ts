/**
 * Memory Status Gateway
 *
 * Routes to: get_project_summary, what_happened, what_changed, get_architecture,
 * get_changelog, validate_docs, get_context_health, list_patterns,
 * get_architecture_stats, find_undocumented, get_critical_context, get_learning_stats
 */

import type { CodeImpactEngine } from '../../core/engine.js';
import type { MemoryStatusInput, MemoryStatusResponse, MemoryStatusAction } from './types.js';
import { detectStatusAction, getStatusGathers } from './router.js';
import { aggregateStatusResults } from './aggregator.js';
import { countObjectTokens } from '../../utils/token-counter.js';
import { SkillReader } from '../../core/knowledge/skill-reader.js';
import { IntelligenceCollector } from '../../core/knowledge/intelligence-collector.js';

/**
 * Handle a memory_status gateway call
 */
export async function handleMemoryStatus(
  engine: CodeImpactEngine,
  input: MemoryStatusInput
): Promise<MemoryStatusResponse> {
  const action = detectStatusAction(input);
  const sourcesUsed: string[] = [];

  let response: MemoryStatusResponse;

  // Handle specific actions
  switch (action) {
    case 'summary':
      response = await handleProjectSummary(engine, input, sourcesUsed);
      break;

    case 'happened':
      response = await handleWhatHappened(engine, input, sourcesUsed);
      break;

    case 'changed':
      response = await handleWhatChanged(engine, input, sourcesUsed);
      break;

    case 'architecture':
      response = await handleArchitecture(engine, input, sourcesUsed);
      break;

    case 'changelog':
      response = await handleChangelog(engine, input, sourcesUsed);
      break;

    case 'health':
      response = await handleContextHealth(engine, input, sourcesUsed);
      break;

    case 'patterns':
      response = await handlePatterns(engine, input, sourcesUsed);
      break;

    case 'stats':
      response = await handleArchitectureStats(engine, input, sourcesUsed);
      break;

    case 'undocumented':
      response = await handleUndocumented(engine, input, sourcesUsed);
      break;

    case 'critical':
      response = await handleCriticalContext(engine, input, sourcesUsed);
      break;

    case 'learning':
      response = await handleLearningStats(engine, input, sourcesUsed);
      break;

    default:
      // Default to project summary
      response = await handleProjectSummary(engine, input, sourcesUsed);
      break;
  }

  // Track token usage for stats (minimal input for status queries)
  const inputTokens = 10; // Status queries have minimal input
  const outputTokens = countObjectTokens(response);
  engine.recordTokenUsage(`memory_status:${action}`, inputTokens, outputTokens);

  return response;
}

/**
 * Get project summary
 * Enhanced with proactive context resurrection for "Welcome back!" experience
 */
async function handleProjectSummary(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_project_summary');

  const summary = engine.getProjectSummary();

  // Get engine status for visibility
  const engineStatus = engine.getEngineStatus();

  // Also get learning stats for a fuller picture
  sourcesUsed.push('get_learning_stats');
  const learningStats = engine.getLearningStats();

  // Get resurrection data for proactive "Welcome back!" messaging
  sourcesUsed.push('resurrect_context');
  const resurrection = engine.resurrectContext();

  const response: MemoryStatusResponse = {
    sources_used: sourcesUsed,
    engine: {
      status: engineStatus.status,
      ready: engineStatus.ready,
      indexing: engineStatus.indexing,
    },
    project: {
      name: summary.name,
      description: summary.description,
      languages: summary.languages,
      total_files: summary.totalFiles,
      total_lines: summary.totalLines,
      key_directories: summary.keyDirectories,
      recent_decisions: summary.recentDecisions.map(d => ({
        id: d.id,
        title: d.title,
        created_at: d.createdAt.toISOString(),
      })),
    },
    learning: {
      total_queries: learningStats.usageStats.totalQueries,
      total_file_views: learningStats.usageStats.totalFileViews,
      top_files: learningStats.usageStats.topFiles.slice(0, 5),
      cache_size: learningStats.hotCacheStats.size,
    },
  };

  // Add resurrection data if there's meaningful context to resume
  if (resurrection.activeFiles.length > 0 || resurrection.lastQueries.length > 0) {
    (response as MemoryStatusResponse & { welcome_back?: unknown }).welcome_back = {
      summary: resurrection.summary,
      active_files: resurrection.activeFiles.slice(0, 5),
      last_queries: resurrection.lastQueries.slice(0, 3),
      possible_blocker: resurrection.possibleBlocker,
      suggested_actions: resurrection.suggestedActions,
      time_since_last_active: resurrection.timeSinceLastActive,
    };
  }

  try {
    const knowledgeStatus = engine.getKnowledgeStatus();
    const skillReader = new SkillReader(engine.getProjectPath());
    const existingSkills = skillReader.readLevel0();
    (response as MemoryStatusResponse & { knowledge?: unknown }).knowledge = {
      generated_at: knowledgeStatus.generatedAt,
      skill_count: existingSkills.length,
      doc_count: knowledgeStatus.docCount,
      provider_count: knowledgeStatus.providerCount,
      skills: existingSkills.slice(0, 20).map((s) => ({
        name: s.name,
        description: s.description,
        scope: s.scope,
      })),
    };
    sourcesUsed.push('knowledge_skills');

    try {
      const collector = new IntelligenceCollector(engine);
      const intel = collector.collect();
      const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const skillNames = new Set(existingSkills.map((s) => slugify(s.name)));

      const uncoveredTechs = intel.detectedTechnologies
        .filter((t) => !skillNames.has(slugify(t.name)) && !skillNames.has(slugify(t.name + '-patterns')) && !skillNames.has(slugify(t.name + '-integration')))
        .slice(0, 5)
        .map((t) => t.name);

      const uncoveredRiskFiles = intel.riskFiles
        .filter((f) => f.riskScore >= 60)
        .slice(0, 5)
        .map((f) => ({ file: f.file, risk_score: f.riskScore }));

      if (uncoveredTechs.length > 0 || uncoveredRiskFiles.length > 0) {
        (response as MemoryStatusResponse & { knowledge_gaps?: unknown }).knowledge_gaps = {
          uncovered_technologies: uncoveredTechs,
          high_risk_files_without_skills: uncoveredRiskFiles,
          suggestion: uncoveredTechs.length > 0
            ? `No skills exist for: ${uncoveredTechs.join(', ')}. Use memory_evolve(action="create_skill") to capture patterns.`
            : `${uncoveredRiskFiles.length} high-risk files lack skill coverage. Use memory_evolve(action="create_skill") to document pitfalls.`,
        };
        sourcesUsed.push('knowledge_gaps');
      }
    } catch {
      // intelligence collection may fail; non-critical
    }
  } catch {
    // knowledge workspace may not exist yet
  }

  return response;
}

/**
 * What happened - activity summary
 */
async function handleWhatHappened(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('what_happened');

  const since = input.since || 'this week';
  const result = await engine.whatHappened(since, input.file);

  return {
    sources_used: sourcesUsed,
    activity: {
      time_range: {
        since: result.timeRange.since.toISOString(),
        until: result.timeRange.until.toISOString(),
      },
      summary: result.summary,
      changes_count: result.changes.length,
      decisions_count: result.decisions.length,
      files_affected: result.filesAffected.slice(0, 20),
    },
  };
}

/**
 * What changed - file changes
 */
async function handleWhatChanged(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('what_changed');

  const since = input.since || 'this week';
  const result = engine.whatChanged({
    since,
    file: input.file,
    author: input.author,
  });

  return {
    sources_used: sourcesUsed,
    changes: {
      period: result.period,
      total_files: result.totalFiles,
      total_lines_added: result.totalLinesAdded,
      total_lines_removed: result.totalLinesRemoved,
      by_author: result.byAuthor,
      recent: result.changes.slice(0, 20).map(c => ({
        file: c.file,
        type: c.type,
        lines_added: c.linesAdded,
        lines_removed: c.linesRemoved,
        author: c.author,
        timestamp: c.timestamp.toISOString(),
      })),
    },
  };
}

/**
 * Architecture overview
 */
async function handleArchitecture(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_architecture');

  const arch = await engine.getArchitecture();

  // Also get stats
  sourcesUsed.push('get_architecture_stats');
  const stats = engine.getArchitectureStats();

  return {
    sources_used: sourcesUsed,
    architecture: {
      name: arch.name,
      description: arch.description,
      diagram: arch.diagram,
      layers: arch.layers.map(l => ({
        name: l.name,
        directory: l.directory,
        files_count: l.files.length,
        purpose: l.purpose,
      })),
      data_flow: arch.dataFlow,
      key_components: arch.keyComponents.map(c => ({
        name: c.name,
        file: c.file,
        purpose: c.purpose,
      })),
    },
    stats: {
      patterns_total: stats.patterns.total,
      functions_total: stats.functions.total,
      functions_exported: stats.functions.exported,
    },
  };
}

/**
 * Changelog
 */
async function handleChangelog(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_changelog');

  const changelogs = await engine.getChangelog({
    since: input.since,
    groupBy: input.group_by,
    includeDecisions: input.include_decisions,
  });

  return {
    sources_used: sourcesUsed,
    changelog: changelogs.map(day => ({
      date: day.date.toISOString().split('T')[0] || day.date.toISOString(),
      summary: day.summary,
      features: day.features.length,
      fixes: day.fixes.length,
      refactors: day.refactors.length,
    })),
  };
}

/**
 * Context health
 */
async function handleContextHealth(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_context_health');

  const health = engine.getContextHealth();
  const drift = engine.detectDrift();

  // Also get critical context
  sourcesUsed.push('get_critical_context');
  const criticalItems = engine.getCriticalContext();

  return {
    sources_used: sourcesUsed,
    health: {
      health: health.health,
      tokens_used: health.tokensUsed,
      tokens_limit: health.tokensLimit,
      utilization: `${health.utilizationPercent}%`,
      drift_detected: health.driftDetected,
      compaction_needed: health.compactionNeeded,
      suggestions: health.suggestions,
    },
    critical: {
      total: criticalItems.length,
      by_type: {
        decision: criticalItems.filter(i => i.type === 'decision').length,
        requirement: criticalItems.filter(i => i.type === 'requirement').length,
        instruction: criticalItems.filter(i => i.type === 'instruction').length,
        custom: criticalItems.filter(i => i.type === 'custom').length,
      },
      items: criticalItems.slice(0, 10).map(item => ({
        id: item.id,
        type: item.type,
        content: item.content.slice(0, 100),
        reason: item.reason,
      })),
    },
  };
}

/**
 * Pattern list
 */
async function handlePatterns(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('list_patterns');

  const patterns = engine.listPatterns(input.category);

  // Group by category
  const byCategory: Record<string, number> = {};
  for (const pattern of patterns) {
    byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
  }

  return {
    sources_used: sourcesUsed,
    patterns: {
      total: patterns.length,
      by_category: byCategory,
      patterns: patterns.slice(0, 20).map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        usage_count: p.usageCount,
      })),
    },
  };
}

/**
 * Architecture stats
 */
async function handleArchitectureStats(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_architecture_stats');

  const stats = engine.getArchitectureStats();

  return {
    sources_used: sourcesUsed,
    stats: {
      patterns_total: stats.patterns.total,
      functions_total: stats.functions.total,
      functions_exported: stats.functions.exported,
    },
  };
}

/**
 * Find undocumented code
 */
async function handleUndocumented(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('find_undocumented');

  const items = await engine.findUndocumented({});

  // Group by importance
  const byImportance: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const item of items) {
    byImportance[item.importance] = (byImportance[item.importance] || 0) + 1;
  }

  // Also validate docs
  sourcesUsed.push('validate_docs');
  const docsResult = await engine.validateDocs();

  return {
    sources_used: sourcesUsed,
    undocumented: {
      total: items.length,
      by_importance: byImportance,
      items: items.slice(0, 30).map(i => ({
        file: i.file,
        symbol: i.symbol,
        type: i.type,
        importance: i.importance,
      })),
    },
    docs: {
      is_valid: docsResult.isValid,
      score: docsResult.score,
      outdated_count: docsResult.outdatedDocs.length,
      undocumented_count: docsResult.undocumentedCode.length,
      suggestions: docsResult.suggestions.slice(0, 5).map(s => ({
        file: s.file,
        suggestion: s.suggestion,
        priority: s.priority,
      })),
    },
  };
}

/**
 * Critical context items
 */
async function handleCriticalContext(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_critical_context');

  const items = engine.getCriticalContext();

  // Group by type
  const byType: Record<string, number> = {
    decision: 0,
    requirement: 0,
    instruction: 0,
    custom: 0,
  };
  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
  }

  return {
    sources_used: sourcesUsed,
    critical: {
      total: items.length,
      by_type: byType,
      items: items.map(item => ({
        id: item.id,
        type: item.type,
        content: item.content,
        reason: item.reason,
      })),
    },
  };
}

/**
 * Learning stats - enhanced with context resurrection for seamless session continuity
 */
async function handleLearningStats(
  engine: CodeImpactEngine,
  input: MemoryStatusInput,
  sourcesUsed: string[]
): Promise<MemoryStatusResponse> {
  sourcesUsed.push('get_learning_stats', 'resurrect_context');

  const stats = engine.getLearningStats();

  // Get context resurrection for session continuity
  const resurrection = engine.resurrectContext();
  const resurrectableContexts = engine.getResurrectableContexts();

  // Get déjà vu stats
  const dejaVuStats = engine.getDejaVuStats();

  const response: MemoryStatusResponse = {
    sources_used: sourcesUsed,
    learning: {
      total_queries: stats.usageStats.totalQueries,
      total_file_views: stats.usageStats.totalFileViews,
      top_files: stats.usageStats.topFiles,
      cache_size: stats.hotCacheStats.size,
    },
  };

  // Add resurrection data for "Welcome back!" experience
  (response as MemoryStatusResponse & { resurrection?: unknown }).resurrection = {
    summary: resurrection.summary,
    active_files: resurrection.activeFiles,
    last_queries: resurrection.lastQueries,
    possible_blocker: resurrection.possibleBlocker,
    suggested_actions: resurrection.suggestedActions,
    time_since_last_active: resurrection.timeSinceLastActive,
  };

  // Add resurrectable contexts
  if (resurrectableContexts.length > 0) {
    (response as MemoryStatusResponse & { resurrectable_contexts?: unknown }).resurrectable_contexts =
      resurrectableContexts.map(c => ({
        id: c.id,
        name: c.name,
        last_active: c.lastActive.toISOString(),
        summary: c.summary,
      }));
  }

  // Add déjà vu stats
  (response as MemoryStatusResponse & { deja_vu_stats?: unknown }).deja_vu_stats = {
    total_queries: dejaVuStats.totalQueries,
    useful_queries: dejaVuStats.usefulQueries,
    avg_usefulness: Math.round(dejaVuStats.avgUsefulness * 100) / 100,
  };

  return response;
}
