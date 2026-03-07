/**
 * Memory Ghost Gateway
 *
 * The "Super Intelligent Brain" - provides proactive intelligence about current work.
 *
 * Modes:
 * - full: Complete ghost data (ghost insight + déjà vu + resurrection)
 * - conflicts: Check for conflicts with past decisions
 * - dejavu: Find similar past problems
 * - resurrect: Get context from last session
 */

import type { CodeImpactEngine, GhostInsight, ConflictWarning, DejaVuMatch, ResurrectedContext } from '../../core/engine.js';
import { countTokens, countObjectTokens } from '../../utils/token-counter.js';

export type MemoryGhostMode = 'full' | 'conflicts' | 'dejavu' | 'resurrect';

export interface MemoryGhostInput {
  /** What to check (default: full) */
  mode?: MemoryGhostMode;
  /** Code to check for conflicts/déjà vu */
  code?: string;
  /** Current file being worked on */
  file?: string;
  /** Query for déjà vu search */
  query?: string;
  /** Feature name for resurrection */
  feature_name?: string;
  /** Maximum results for déjà vu */
  max_results?: number;
}

export interface MemoryGhostResponse {
  /** Mode that was executed */
  mode: MemoryGhostMode;
  /** Sources used to generate response */
  sources_used: string[];
  /** Ghost insight - current work awareness */
  ghost?: {
    active_files: string[];
    recent_decisions: Array<{
      id: string;
      title: string;
      description: string;
    }>;
    suggestions: string[];
  };
  /** Conflict warnings */
  conflicts?: {
    has_conflicts: boolean;
    warnings: Array<{
      decision_id: string;
      decision_title: string;
      warning: string;
      severity: 'low' | 'medium' | 'high';
      matched_terms: string[];
    }>;
  };
  /** Déjà vu matches - similar past problems */
  deja_vu?: {
    has_matches: boolean;
    matches: Array<{
      type: 'query' | 'solution' | 'fix' | 'pattern';
      similarity: number;
      when: string;
      file: string;
      snippet: string;
      message: string;
      context?: string;
    }>;
  };
  /** Context resurrection - session continuity */
  resurrection?: {
    active_files: string[];
    last_queries: string[];
    last_edited_file: string | null;
    last_edit_time: string | null;
    possible_blocker: string | null;
    suggested_actions: string[];
    summary: string;
    time_since_last_active: string;
  };
  /** Resurrectable contexts */
  resurrectable_contexts?: Array<{
    id: string;
    name: string;
    last_active: string;
    summary: string;
  }>;
  /** Stats */
  stats?: {
    deja_vu: {
      total_queries: number;
      useful_queries: number;
      avg_usefulness: number;
    };
  };
}

/**
 * Handle a memory_ghost gateway call
 */
export async function handleMemoryGhost(
  engine: CodeImpactEngine,
  input: MemoryGhostInput
): Promise<MemoryGhostResponse> {
  const mode = input.mode || 'full';
  const sourcesUsed: string[] = [];

  let response: MemoryGhostResponse;

  switch (mode) {
    case 'conflicts':
      response = await handleConflictsMode(engine, input, sourcesUsed);
      break;

    case 'dejavu':
      response = await handleDejaVuMode(engine, input, sourcesUsed);
      break;

    case 'resurrect':
      response = await handleResurrectMode(engine, input, sourcesUsed);
      break;

    case 'full':
    default:
      response = await handleFullMode(engine, input, sourcesUsed);
      break;
  }

  // Track token usage for stats
  const inputTokens = countTokens(input.query || input.code || '');
  const outputTokens = countObjectTokens(response);
  engine.recordTokenUsage(`memory_ghost:${mode}`, inputTokens, outputTokens);

  return response;
}

/**
 * Full ghost mode - everything
 */
async function handleFullMode(
  engine: CodeImpactEngine,
  input: MemoryGhostInput,
  sourcesUsed: string[]
): Promise<MemoryGhostResponse> {
  sourcesUsed.push('ghost_insight', 'deja_vu', 'resurrect_context');

  // Notify file access if provided
  if (input.file) {
    await engine.notifyFileAccess(input.file);
  }

  // Get full ghost data
  const fullData = await engine.getFullGhostData('full', {
    code: input.code,
    file: input.file,
    query: input.query,
  });

  const response: MemoryGhostResponse = {
    mode: 'full',
    sources_used: sourcesUsed,
  };

  // Add ghost insight
  if (fullData.ghost) {
    response.ghost = formatGhostInsight(fullData.ghost);
  }

  // Add conflicts
  if (fullData.conflicts && fullData.conflicts.length > 0) {
    response.conflicts = formatConflicts(fullData.conflicts);
  }

  // Add déjà vu
  if (fullData.dejaVu && fullData.dejaVu.length > 0) {
    response.deja_vu = formatDejaVu(fullData.dejaVu);
  }

  // Add resurrection
  if (fullData.resurrection) {
    response.resurrection = formatResurrection(fullData.resurrection);
  }

  // Add resurrectable contexts
  const contexts = engine.getResurrectableContexts();
  if (contexts.length > 0) {
    response.resurrectable_contexts = contexts.map(c => ({
      id: c.id,
      name: c.name,
      last_active: c.lastActive.toISOString(),
      summary: c.summary,
    }));
  }

  // Add stats
  response.stats = {
    deja_vu: engine.getDejaVuStats(),
  };

  return response;
}

/**
 * Conflicts mode - check for decision conflicts
 */
async function handleConflictsMode(
  engine: CodeImpactEngine,
  input: MemoryGhostInput,
  sourcesUsed: string[]
): Promise<MemoryGhostResponse> {
  sourcesUsed.push('check_ghost_conflicts');

  if (!input.code) {
    return {
      mode: 'conflicts',
      sources_used: sourcesUsed,
      conflicts: {
        has_conflicts: false,
        warnings: [],
      },
    };
  }

  // Notify file access if provided
  if (input.file) {
    await engine.notifyFileAccess(input.file);
  }

  const warnings = engine.checkGhostConflicts(input.code, input.file);

  return {
    mode: 'conflicts',
    sources_used: sourcesUsed,
    conflicts: formatConflicts(warnings),
  };
}

/**
 * Déjà vu mode - find similar past problems
 */
async function handleDejaVuMode(
  engine: CodeImpactEngine,
  input: MemoryGhostInput,
  sourcesUsed: string[]
): Promise<MemoryGhostResponse> {
  sourcesUsed.push('find_deja_vu');

  const searchText = input.query || input.code || '';

  if (!searchText) {
    return {
      mode: 'dejavu',
      sources_used: sourcesUsed,
      deja_vu: {
        has_matches: false,
        matches: [],
      },
    };
  }

  const matches = await engine.findDejaVu(searchText, input.max_results || 5);

  return {
    mode: 'dejavu',
    sources_used: sourcesUsed,
    deja_vu: formatDejaVu(matches),
    stats: {
      deja_vu: engine.getDejaVuStats(),
    },
  };
}

/**
 * Resurrect mode - get context from last session
 */
async function handleResurrectMode(
  engine: CodeImpactEngine,
  input: MemoryGhostInput,
  sourcesUsed: string[]
): Promise<MemoryGhostResponse> {
  sourcesUsed.push('resurrect_context');

  const resurrection = engine.resurrectContext({
    featureName: input.feature_name,
  });

  const contexts = engine.getResurrectableContexts();

  return {
    mode: 'resurrect',
    sources_used: sourcesUsed,
    resurrection: formatResurrection(resurrection),
    resurrectable_contexts: contexts.map(c => ({
      id: c.id,
      name: c.name,
      last_active: c.lastActive.toISOString(),
      summary: c.summary,
    })),
  };
}

// ========== Formatters ==========

function formatGhostInsight(insight: GhostInsight): MemoryGhostResponse['ghost'] {
  return {
    active_files: insight.activeFiles,
    recent_decisions: insight.recentDecisions.map(d => ({
      id: d.id,
      title: d.title,
      description: d.description.slice(0, 200),
    })),
    suggestions: insight.suggestions,
  };
}

function formatConflicts(warnings: ConflictWarning[]): NonNullable<MemoryGhostResponse['conflicts']> {
  return {
    has_conflicts: warnings.length > 0,
    warnings: warnings.map(w => ({
      decision_id: w.decision.id,
      decision_title: w.decision.title,
      warning: w.warning,
      severity: w.severity,
      matched_terms: w.matchedTerms,
    })),
  };
}

function formatDejaVu(matches: DejaVuMatch[]): NonNullable<MemoryGhostResponse['deja_vu']> {
  return {
    has_matches: matches.length > 0,
    matches: matches.map(m => ({
      type: m.type,
      similarity: m.similarity,
      when: m.when.toISOString(),
      file: m.file,
      snippet: m.snippet,
      message: m.message,
      context: m.context,
    })),
  };
}

function formatResurrection(resurrection: ResurrectedContext): NonNullable<MemoryGhostResponse['resurrection']> {
  return {
    active_files: resurrection.activeFiles,
    last_queries: resurrection.lastQueries,
    last_edited_file: resurrection.lastEditedFile,
    last_edit_time: resurrection.lastEditTime?.toISOString() || null,
    possible_blocker: resurrection.possibleBlocker,
    suggested_actions: resurrection.suggestedActions,
    summary: resurrection.summary,
    time_since_last_active: resurrection.timeSinceLastActive,
  };
}
