/**
 * Memory Record Gateway
 *
 * Routes to: record_decision, record_decision_with_author, learn_pattern,
 * mark_context_useful, set_feature_context, mark_critical, add_pattern_example
 *
 * Smart Decision Detection: Auto-detects when content looks like a decision
 */

import type { CodeImpactEngine } from '../../core/engine.js';
import type { MemoryRecordInput, MemoryRecordResponse } from './types.js';
import { detectRecordType, validateRecordInput } from './router.js';

// Patterns that indicate decision-like content
const DECISION_PATTERNS = [
  /we('ll| will) use/i,
  /decided to/i,
  /going with/i,
  /instead of/i,
  /because.*better/i,
  /chose/i,
  /choosing/i,
  /prefer/i,
  /preferring/i,
  /let's use/i,
  /we should use/i,
  /the approach is/i,
  /our strategy is/i,
  /we're using/i,
  /will implement.*using/i,
  /architecture.*decision/i,
  /technical.*decision/i,
];

/**
 * Check if content looks like an architectural decision
 */
function looksLikeDecision(content: string): boolean {
  return DECISION_PATTERNS.some(re => re.test(content));
}

/**
 * Extract a potential title from decision-like content
 */
function extractDecisionTitle(content: string): string | null {
  // Try to find a clear decision statement
  const patterns = [
    /(?:decided to|we'll|we will|going with|chose|choosing)\s+(.+?)(?:\.|$)/i,
    /(?:use|using)\s+(\w+(?:\s+\w+){0,3})\s+(?:for|instead|because)/i,
    /(?:prefer|preferring)\s+(.+?)\s+(?:over|instead|to)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      // Capitalize first letter and clean up
      const title = match[1].trim();
      return title.charAt(0).toUpperCase() + title.slice(1);
    }
  }

  // Fallback: use first sentence, truncated
  const firstSentence = content.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 0) {
    return firstSentence.slice(0, 50) + (firstSentence.length > 50 ? '...' : '');
  }

  return null;
}

/**
 * Handle a memory_record gateway call
 */
export async function handleMemoryRecord(
  engine: CodeImpactEngine,
  input: MemoryRecordInput
): Promise<MemoryRecordResponse> {
  // Validate input
  const validation = validateRecordInput(input);
  if (!validation.valid) {
    return {
      success: false,
      type: validation.type,
      message: validation.error || 'Invalid input',
    };
  }

  let recordType = validation.type;
  let warnings: MemoryRecordResponse['warnings'] = undefined;

  // Smart Decision Detection: Check if content looks like a decision
  if (recordType !== 'decision' && looksLikeDecision(input.content)) {
    if (!input.title) {
      // Content looks like a decision but no title - add hint
      const suggestedTitle = extractDecisionTitle(input.content);
      warnings = [{
        type: 'hint',
        message: `This looks like an architectural decision. ${suggestedTitle
          ? `Suggested title: "${suggestedTitle}". `
          : ''}Add a title to save it as a decision.`,
        severity: 'low',
      }];

      // If the caller didn't specify a type and it looks like a decision, offer to record it
      if (!input.type && suggestedTitle) {
        // Auto-upgrade to decision if we can extract a title
        recordType = 'decision';
        input.title = suggestedTitle;
      }
    } else {
      // Has title and looks like decision - treat as decision
      recordType = 'decision';
    }
  }

  // Pre-check conflicts for decisions
  if (recordType === 'decision' && input.code) {
    const conflicts = await engine.checkCodeConflicts(input.code);
    if (conflicts.hasConflicts) {
      const conflictWarnings = conflicts.conflicts.map(c => ({
        type: 'conflict' as const,
        message: `Conflicts with decision "${c.decisionTitle}": ${c.conflictDescription}`,
        severity: c.severity as 'low' | 'medium' | 'high',
      }));
      warnings = warnings ? [...warnings, ...conflictWarnings] : conflictWarnings;
    }
  }

  let response: MemoryRecordResponse;

  // Route to appropriate recording method
  switch (recordType) {
    case 'decision':
      response = await handleRecordDecision(engine, input, warnings);
      break;

    case 'pattern':
      response = await handleRecordPattern(engine, input);
      break;

    case 'example':
      response = await handleRecordPatternExample(engine, input);
      break;

    case 'feedback':
      response = await handleRecordFeedback(engine, input);
      break;

    case 'feature':
      response = await handleRecordFeature(engine, input);
      break;

    case 'critical':
      response = await handleRecordCritical(engine, input);
      break;

    default:
      response = {
        success: false,
        type: recordType,
        message: `Unknown record type: ${recordType}`,
      };
  }

  // Track token usage for stats
  const tokensUsed = Math.ceil(JSON.stringify(response).length / 4);
  engine.recordTokenUsage(`memory_record:${recordType}`, tokensUsed);

  return response;
}

/**
 * Record a decision
 */
async function handleRecordDecision(
  engine: CodeImpactEngine,
  input: MemoryRecordInput,
  warnings?: MemoryRecordResponse['warnings']
): Promise<MemoryRecordResponse> {
  const title = input.title!;
  const description = input.content;

  let decision;

  if (input.author) {
    // Use author-attributed decision recording
    decision = await engine.recordDecisionWithAuthor(
      title,
      description,
      input.author,
      input.files,
      input.tags,
      input.status || 'accepted'
    );
  } else {
    // Use simple decision recording
    decision = await engine.recordDecision(
      title,
      description,
      input.files,
      input.tags
    );
  }

  return {
    success: true,
    type: 'decision',
    id: decision.id,
    message: `Decision recorded: "${title}"`,
    warnings,
    record: {
      id: decision.id,
      title: decision.title,
      description: decision.description,
      author: decision.author,
      status: decision.status,
      files: decision.files,
      tags: decision.tags,
      created_at: decision.createdAt.toISOString(),
    },
  };
}

/**
 * Record a pattern
 */
async function handleRecordPattern(
  engine: CodeImpactEngine,
  input: MemoryRecordInput
): Promise<MemoryRecordResponse> {
  const code = input.code!;
  const name = input.pattern_name || input.title!;
  const description = input.content || undefined;
  const category = input.category || undefined;

  const result = engine.learnPattern(code, name, description, category);

  return {
    success: result.success,
    type: 'pattern',
    id: result.patternId,
    message: result.message,
  };
}

/**
 * Add an example to a pattern
 */
async function handleRecordPatternExample(
  engine: CodeImpactEngine,
  input: MemoryRecordInput
): Promise<MemoryRecordResponse> {
  const patternId = input.pattern_id!;
  const code = input.code!;
  const explanation = input.explanation || input.content;
  const isAntiPattern = input.is_anti_pattern || false;

  const success = engine.addPatternExample(patternId, code, explanation, isAntiPattern);

  if (!success) {
    return {
      success: false,
      type: 'example',
      message: `Pattern not found: ${patternId}`,
    };
  }

  return {
    success: true,
    type: 'example',
    message: `${isAntiPattern ? 'Anti-pattern' : 'Example'} added to pattern ${patternId}`,
    record: {
      pattern_id: patternId,
      is_anti_pattern: isAntiPattern,
    },
  };
}

/**
 * Record feedback about context usefulness
 */
async function handleRecordFeedback(
  engine: CodeImpactEngine,
  input: MemoryRecordInput
): Promise<MemoryRecordResponse> {
  const query = input.query || input.content;
  const wasUseful = input.was_useful!;

  engine.markContextUsefulness(query, wasUseful);

  return {
    success: true,
    type: 'feedback',
    message: `Feedback recorded: context was ${wasUseful ? 'useful' : 'not useful'}`,
    record: {
      query,
      was_useful: wasUseful,
    },
  };
}

/**
 * Start tracking a feature context
 */
async function handleRecordFeature(
  engine: CodeImpactEngine,
  input: MemoryRecordInput
): Promise<MemoryRecordResponse> {
  const name = input.content;

  const context = engine.startFeatureContext(name);

  // Track initial files if provided
  if (input.files && input.files.length > 0) {
    for (const file of input.files) {
      engine.trackFileOpened(file);
    }
  }

  return {
    success: true,
    type: 'feature',
    id: context.id,
    message: `Now tracking feature: "${name}"`,
    record: {
      id: context.id,
      name: context.name,
      files: input.files || [],
    },
  };
}

/**
 * Mark content as critical (never compressed)
 */
async function handleRecordCritical(
  engine: CodeImpactEngine,
  input: MemoryRecordInput
): Promise<MemoryRecordResponse> {
  const content = input.content;
  const type = input.critical_type;
  const reason = input.reason;

  const critical = engine.markCritical(content, { type, reason });

  return {
    success: true,
    type: 'critical',
    id: critical.id,
    message: `Marked as critical: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
    record: {
      id: critical.id,
      type: critical.type,
      content: critical.content,
      reason: critical.reason,
      never_compress: critical.neverCompress,
      created_at: critical.createdAt.toISOString(),
    },
  };
}
