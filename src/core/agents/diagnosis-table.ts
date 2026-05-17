/**
 * Diagnosis Decision Table — declarative rule-based error classification.
 * Replaces the if/else chain in improvement-engine.ts with a prioritized
 * pattern-matching table for deterministic, testable diagnosis.
 */

import type { DiagnosisResult, DiagnosisCategory, OutcomeRecord } from './types.js';

// ============================================================================
// Decision Table Rule Definition
// ============================================================================

export interface DiagnosisRule {
  id: number;
  pattern: RegExp;
  category: DiagnosisCategory;
  confidence: number;
  description: string;
  suggestedFix: string;
  target: string;
  /** Optional: requires extra context check (e.g., scope validation) */
  contextCheck?: 'scope-check' | 'fix-present';
}

// ============================================================================
// The Decision Table — ordered by priority (first match wins)
// ============================================================================

export const DIAGNOSIS_RULES: DiagnosisRule[] = [
  // Rule 1: async better-sqlite3 (highest confidence specific pattern)
  {
    id: 1,
    pattern: /async.*better-sqlite3|await.*better-sqlite3|await.*db\.(prepare|exec|run)/i,
    category: 'wrong-assumption',
    confidence: 0.95,
    description: 'better-sqlite3 is synchronous — async/await is incorrect',
    suggestedFix: 'Remove async/await from better-sqlite3 calls',
    target: 'Feature SKILL Pitfalls',
  },
  // Rule 2: ESM require error
  {
    id: 2,
    pattern: /ERR_REQUIRE_ESM|require\(.*\).*esm/i,
    category: 'wrong-assumption',
    confidence: 0.90,
    description: 'Using require() in ESM context',
    suggestedFix: 'Use import instead of require in ESM modules',
    target: 'Feature SKILL Pitfalls',
  },
  // Rule 4: db.exec() returns nothing
  {
    id: 4,
    pattern: /db\.exec\(\).*undefined|exec.*returns nothing/i,
    category: 'wrong-assumption',
    confidence: 0.90,
    description: 'db.exec() returns nothing, not query results',
    suggestedFix: 'Use db.prepare().all() for SELECT queries',
    target: 'Feature SKILL Pitfalls',
  },
  // Rule 15: error + fixApplied both present (catch-all when no specific pattern matched)
  // Placed after high-confidence specific rules so they take precedence
  {
    id: 15,
    pattern: /.+/,
    category: 'wrong-assumption',
    confidence: 0.85,
    description: '', // Will be replaced with actual error message
    suggestedFix: 'Apply the fix as a skill patch',
    target: 'Immediate skill patch',
    contextCheck: 'fix-present',
  },
  // Rule 3: deprecated/removed API
  {
    id: 3,
    pattern: /deprecated.*api|api.*removed|api.*discontinued/i,
    category: 'outdated-research',
    confidence: 0.80,
    description: 'Using deprecated or removed API',
    suggestedFix: 'Re-research for current API patterns',
    target: 'Re-research trigger',
  },
  // Rule 9: scope error (checked via contextCheck)
  {
    id: 9,
    pattern: /.+/,
    category: 'scope-error',
    confidence: 0.80,
    description: 'Agent operated on file outside its scope',
    suggestedFix: 'Expand agent scope or route to correct agent',
    target: 'Feature AGENT Scope',
    contextCheck: 'scope-check',
  },
  // Rule 5: cannot find module
  {
    id: 5,
    pattern: /cannot find module|module not found|ERR_MODULE_NOT_FOUND/i,
    category: 'outdated-research',
    confidence: 0.70,
    description: 'Module not found — may need re-research',
    suggestedFix: 'Re-research the affected technology for updated package names',
    target: 'Re-research trigger',
  },
  // Rule 6: no exported member
  {
    id: 6,
    pattern: /no exported member|does not provide an export/i,
    category: 'outdated-research',
    confidence: 0.70,
    description: 'Export not found — API may have changed',
    suggestedFix: 'Re-research for updated export names',
    target: 'Re-research trigger',
  },
  // Rule 7: type assignability errors
  {
    id: 7,
    pattern: /type.*is not assignable to|property.*does not exist on type/i,
    category: 'wrong-assumption',
    confidence: 0.60,
    description: 'Type error suggests incorrect API usage',
    suggestedFix: 'Update skill with correct type information',
    target: 'Feature SKILL',
  },
  // Rule 8: argument count mismatch / TS errors
  {
    id: 8,
    pattern: /expected \d+ arguments.*got \d+|TS\d{4}/i,
    category: 'wrong-assumption',
    confidence: 0.60,
    description: 'TypeScript compilation error — wrong argument count or type error',
    suggestedFix: 'Check function signatures in research docs',
    target: 'Feature SKILL',
  },
  // Rule 13: null/undefined property access
  {
    id: 13,
    pattern: /Cannot read properties of (null|undefined)/i,
    category: 'wrong-assumption',
    confidence: 0.50,
    description: 'Null/undefined property access — missing null check',
    suggestedFix: 'Add null checks or optional chaining',
    target: 'Feature SKILL',
  },
  // Rule 10: test failure
  {
    id: 10,
    pattern: /FAIL|test.*failed|Assert(?:ion)?Error/i,
    category: 'missing-test',
    confidence: 0.50,
    description: 'Test failure indicates missing or incorrect test coverage',
    suggestedFix: 'Add test coverage for the affected code path',
    target: 'Feature AGENT Criteria',
  },
  // Rule 11: runtime type errors
  {
    id: 11,
    pattern: /TypeError:|ReferenceError:|RangeError:/,
    category: 'external-change',
    confidence: 0.40,
    description: 'Runtime error — possible dependency or environment change',
    suggestedFix: 'Check for dependency or environment changes',
    target: 'Project AGENT',
  },
  // Rule 12: network/permission errors
  {
    id: 12,
    pattern: /ECONNREFUSED|ETIMEDOUT|EACCES/,
    category: 'external-change',
    confidence: 0.40,
    description: 'Network or permission error — external service issue',
    suggestedFix: 'Check service availability and permissions',
    target: 'Project AGENT',
  },
  // Rule 14: generic fallback (last resort)
  {
    id: 14,
    pattern: /.+/,
    category: 'missing-convention',
    confidence: 0.30,
    description: 'Unclassified error',
    suggestedFix: 'Investigate and add convention to prevent recurrence',
    target: 'Project CONVENTIONS',
  },
];

// ============================================================================
// Diagnosis Function
// ============================================================================

export interface DiagnosisContext {
  errorMessage: string;
  errorFile?: string;
  agentName?: string;
  fixApplied?: string;
  /** Callback to check if file is within agent scope */
  isInScope?: (file: string, agent: string) => boolean;
}

/**
 * Diagnose an error using the decision table.
 * Returns the first matching rule's diagnosis, or null if no error message.
 */
export function diagnoseWithTable(ctx: DiagnosisContext): DiagnosisResult | null {
  const { errorMessage, errorFile, agentName, fixApplied, isInScope } = ctx;

  if (!errorMessage) return null;

  for (const rule of DIAGNOSIS_RULES) {
    // Context checks — skip rules that need special conditions not met
    if (rule.contextCheck === 'fix-present') {
      if (!fixApplied) continue;
    }

    if (rule.contextCheck === 'scope-check') {
      if (!errorFile || !agentName || !isInScope) continue;
      if (isInScope(errorFile, agentName)) continue; // File IS in scope, skip this rule
    }

    // Pattern match
    if (rule.pattern.test(errorMessage)) {
      return {
        category: rule.category,
        confidence: rule.confidence,
        // Use actual error message for fix-present rule, otherwise use rule description
        description: rule.description || errorMessage.slice(0, 200),
        suggestedFix: rule.suggestedFix,
        targetFile: errorFile,
        targetSection: rule.target,
      };
    }
  }

  return null;
}

/**
 * Convenience wrapper that builds DiagnosisContext from an OutcomeRecord.
 */
export function diagnoseOutcome(
  outcome: OutcomeRecord,
  isInScope?: (file: string, agent: string) => boolean,
): DiagnosisResult | null {
  return diagnoseWithTable({
    errorMessage: outcome.errorMessage || '',
    errorFile: outcome.errorFile,
    agentName: outcome.agent,
    fixApplied: outcome.fixApplied,
    isInScope,
  });
}
