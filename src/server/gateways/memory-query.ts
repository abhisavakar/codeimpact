/**
 * Memory Query Gateway
 *
 * Routes to: get_context, search_codebase, get_file_context, get_file_summary,
 * get_symbol, get_dependencies, get_predicted_files, get_confidence,
 * list_sources, suggest_existing
 */

import type { CodeImpactEngine } from '../../core/engine.js';
import type { MemoryQueryInput, MemoryQueryResponse, MemoryQueryAction } from './types.js';
import { detectQueryAction, parseQuery, isFilePath } from './router.js';
import { aggregateQueryResults, mergeSearchResults } from './aggregator.js';
import { formatTimeAgo } from '../../utils/time.js';
import { countTokens, countObjectTokens } from '../../utils/token-counter.js';

/**
 * Handle a memory_query gateway call
 */
export async function handleMemoryQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput
): Promise<MemoryQueryResponse> {
  const action = detectQueryAction(input);
  const sourcesUsed: string[] = [];

  let response: MemoryQueryResponse;

  // Route based on detected/explicit action
  switch (action) {
    case 'file':
      response = await handleFileQuery(engine, input, sourcesUsed);
      break;

    case 'summary':
      response = await handleSummaryQuery(engine, input, sourcesUsed);
      break;

    case 'symbol':
      response = await handleSymbolQuery(engine, input, sourcesUsed);
      break;

    case 'dependencies':
      response = await handleDependenciesQuery(engine, input, sourcesUsed);
      break;

    case 'predict':
      response = await handlePredictQuery(engine, input, sourcesUsed);
      break;

    case 'confidence':
      response = await handleConfidenceQuery(engine, input, sourcesUsed);
      break;

    case 'sources':
      response = await handleSourcesQuery(engine, input, sourcesUsed);
      break;

    case 'existing':
      response = await handleExistingQuery(engine, input, sourcesUsed);
      break;

    case 'search':
      response = await handleSearchOnlyQuery(engine, input, sourcesUsed);
      break;

    case 'context':
    default:
      response = await handleContextQuery(engine, input, sourcesUsed);
      break;
  }

  // Track token usage for stats (input = query, output = response)
  const inputTokens = countTokens(input.query || '');
  const outputTokens = countObjectTokens(response);
  engine.recordTokenUsage(`memory_query:${action}`, inputTokens, outputTokens);

  return response;
}

/**
 * Combined context + search query (default behavior)
 * Enhanced with déjà vu detection and proactive predictions
 */
async function handleContextQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_context', 'search_codebase');

  // Notify ghost mode of file access for silent tracking
  if (input.file) {
    engine.notifyFileAccess(input.file).catch(err => {
      console.error('Ghost mode file access error:', err);
    });
  }

  // Run context, search, and déjà vu in parallel
  const [contextResult, searchResults, dejaVuMatches] = await Promise.all([
    engine.getContext(input.query, input.file, input.max_tokens),
    engine.searchCodebase(input.query, input.max_results || 10),
    engine.findDejaVu(input.query, 3), // Check for similar past problems
  ]);

  const response = aggregateQueryResults(
    contextResult,
    searchResults,
    sourcesUsed
  ) as MemoryQueryResponse;

  // Add déjà vu matches if found (proactive intelligence)
  // Surfaced prominently to address "I feel like I solved this before" problem
  if (dejaVuMatches.length > 0) {
    sourcesUsed.push('deja_vu');

    // Format user-friendly messages
    const formattedMatches = dejaVuMatches.map(m => ({
      type: m.type,
      message: m.message,
      file: m.file,
      similarity: m.similarity,
      when: m.when.toISOString(),
      context: m.context,
      // Human-readable time ago
      time_ago: formatTimeAgo(m.when),
    }));

    (response as MemoryQueryResponse & { deja_vu?: unknown }).deja_vu = {
      has_matches: true,
      hint: formattedMatches.length === 1
        ? `You worked on something similar ${formattedMatches[0]?.time_ago || 'recently'}`
        : `Found ${formattedMatches.length} similar past problems`,
      matches: formattedMatches,
    };
  }

  // Add predicted files (proactive context)
  if (input.file) {
    sourcesUsed.push('predict_files');
    const predictedFiles = engine.getPredictedFiles(input.file, input.query);
    if (predictedFiles.length > 0) {
      (response as MemoryQueryResponse & { predictions?: unknown }).predictions = {
        likely_next_files: predictedFiles.slice(0, 5),
      };
    }
  }

  // If confidence requested, add it
  if (input.include_confidence && input.code) {
    sourcesUsed.push('get_confidence');
    const confidence = await engine.getConfidence(input.code, input.query);
    response.confidence = {
      level: confidence.confidence,
      score: confidence.score,
      reasoning: confidence.reasoning,
      indicator: engine.getConfidenceIndicator(confidence.confidence),
    };
  }

  // Record query for future déjà vu detection
  engine.recordQueryForDejaVu(input.query, contextResult.sources);

  return response;
}

/**
 * Search only (no context assembly)
 */
async function handleSearchOnlyQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('search_codebase');

  const searchResults = await engine.searchCodebase(
    input.query,
    input.max_results || 10
  );

  return {
    sources_used: sourcesUsed,
    search_results: searchResults.map(r => ({
      file: r.file,
      preview: r.preview,
      relevance: r.similarity,
      line_start: r.lineStart,
      line_end: r.lineEnd,
    })),
  };
}

/**
 * File context retrieval
 */
async function handleFileQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_file_context');

  // Determine file path from input.file or input.query
  const filePath = input.file || (isFilePath(input.query) ? input.query : null);

  if (!filePath) {
    return {
      sources_used: sourcesUsed,
      file_content: undefined,
    };
  }

  const result = await engine.getFileContext(filePath);

  if (!result) {
    return {
      sources_used: sourcesUsed,
      file_content: undefined,
    };
  }

  return {
    sources_used: sourcesUsed,
    file_content: {
      path: filePath,
      content: result.content,
      language: result.language,
      lines: result.lines,
    },
  };
}

/**
 * File summary retrieval
 */
async function handleSummaryQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_file_summary');

  const filePath = input.file || (isFilePath(input.query) ? input.query : null);

  if (!filePath) {
    return {
      sources_used: sourcesUsed,
      file_summary: undefined,
    };
  }

  const summary = engine.getFileSummary(filePath);

  return {
    sources_used: sourcesUsed,
    file_summary: summary ? {
      path: filePath,
      summary,
    } : undefined,
  };
}

/**
 * Symbol lookup with fallback to semantic search
 * If no symbols found in AST index, falls back to codebase search
 */
async function handleSymbolQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_symbol');

  const symbolName = input.symbol || input.query;
  const results = await engine.searchSymbols(
    symbolName,
    input.symbol_kind,
    input.max_results || 10
  );

  // If we have results and a specific file, also get dependencies
  const firstResult = results[0];
  if (results.length > 0 && firstResult && firstResult.filePath) {
    sourcesUsed.push('get_dependencies');
    const deps = engine.getFileDependencies(firstResult.filePath);

    return {
      sources_used: sourcesUsed,
      symbols: results.map(s => ({
        name: s.name,
        kind: s.kind,
        file: s.filePath,
        line_start: s.lineStart,
        line_end: s.lineEnd,
        signature: s.signature || undefined,
        exported: s.exported,
      })),
      dependencies: {
        file: firstResult.filePath,
        imports: deps.imports,
        imported_by: deps.importedBy,
        symbols: deps.symbols,
      },
    };
  }

  // FALLBACK: If no symbols found, try semantic search
  // This handles cases where AST parsing failed or symbols weren't indexed
  if (results.length === 0) {
    sourcesUsed.push('search_codebase_fallback');

    const searchResults = await engine.searchCodebase(
      symbolName,
      input.max_results || 10
    );

    if (searchResults.length > 0) {
      return {
        sources_used: sourcesUsed,
        symbols: [], // No AST symbols found
        search_results: searchResults.map(r => ({
          file: r.file,
          preview: r.preview,
          relevance: Math.round(r.relevance * 100),
          line_start: r.lineStart,
          line_end: r.lineEnd,
        })),
        fallback_used: true,
        fallback_reason: 'No symbols found in AST index, used semantic search instead',
      };
    }
  }

  return {
    sources_used: sourcesUsed,
    symbols: results.map(s => ({
      name: s.name,
      kind: s.kind,
      file: s.filePath,
      line_start: s.lineStart,
      line_end: s.lineEnd,
      signature: s.signature || undefined,
      exported: s.exported,
    })),
  };
}

/**
 * Dependency lookup
 */
async function handleDependenciesQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_dependencies');

  const filePath = input.file || (isFilePath(input.query) ? input.query : null);

  if (!filePath) {
    return {
      sources_used: sourcesUsed,
      dependencies: undefined,
    };
  }

  const deps = engine.getFileDependencies(filePath);

  return {
    sources_used: sourcesUsed,
    dependencies: {
      file: filePath,
      imports: deps.imports,
      imported_by: deps.importedBy,
      symbols: deps.symbols,
    },
  };
}

/**
 * Predicted files query
 */
async function handlePredictQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_predicted_files');

  if (!input.file) {
    return {
      sources_used: sourcesUsed,
      predicted_files: undefined,
    };
  }

  const predicted = engine.getPredictedFiles(input.file, input.query);
  const preFetched = await engine.preFetchFiles(input.file, input.query);

  return {
    sources_used: sourcesUsed,
    predicted_files: {
      files: predicted,
      pre_fetched: preFetched,
    },
  };
}

/**
 * Confidence assessment query
 */
async function handleConfidenceQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('get_confidence');

  if (!input.code) {
    return {
      sources_used: sourcesUsed,
      confidence: undefined,
    };
  }

  const result = await engine.getConfidence(input.code, input.query);

  return {
    sources_used: sourcesUsed,
    confidence: {
      level: result.confidence,
      score: result.score,
      reasoning: result.reasoning,
      indicator: engine.getConfidenceIndicator(result.confidence),
    },
    source_attribution: {
      codebase_matches: result.sources.codebase.length,
      decision_matches: result.sources.decisions.length,
      pattern_matches: result.sources.patterns.length,
      used_general_knowledge: result.sources.usedGeneralKnowledge,
    },
  };
}

/**
 * Source attribution query
 */
async function handleSourcesQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('list_sources');

  if (!input.code) {
    return {
      sources_used: sourcesUsed,
      source_attribution: undefined,
    };
  }

  const sources = await engine.listConfidenceSources(input.code, input.query, true);

  return {
    sources_used: sourcesUsed,
    source_attribution: {
      codebase_matches: sources.codebase.length,
      decision_matches: sources.decisions.length,
      pattern_matches: sources.patterns.length,
      used_general_knowledge: sources.usedGeneralKnowledge,
    },
  };
}

/**
 * Existing function suggestions query
 */
async function handleExistingQuery(
  engine: CodeImpactEngine,
  input: MemoryQueryInput,
  sourcesUsed: string[]
): Promise<MemoryQueryResponse> {
  sourcesUsed.push('suggest_existing');

  const suggestions = engine.suggestExisting(
    input.query,
    input.max_results || 5
  );

  return {
    sources_used: sourcesUsed,
    existing_functions: suggestions.map(s => ({
      name: s.name,
      file: s.file,
      line: s.line,
      signature: s.signature,
      similarity: s.similarity,
    })),
  };
}
