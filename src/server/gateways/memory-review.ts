/**
 * Memory Review Gateway
 *
 * Routes to: validate_pattern, check_conflicts, suggest_existing, check_tests,
 * get_confidence, find_similar_bugs, suggest_test_update, get_related_tests,
 * get_test_coverage
 */

import type { CodeImpactEngine } from '../../core/engine.js';
import type { MemoryReviewInput, MemoryReviewResponse } from './types.js';
import { detectReviewAction, getReviewChecks, isErrorMessage } from './router.js';
import {
  aggregateReviewResults,
  calculateRiskScore,
  getVerdict,
  type PatternValidationResult,
  type ConflictCheckResult,
  type ConfidenceCheckResult,
  type TestCheckResult,
  type ExistingFunctionResult,
} from './aggregator.js';
import { countTokens, countObjectTokens } from '../../utils/token-counter.js';
import { SkillReader } from '../../core/knowledge/skill-reader.js';
import { appendNudgeToResponse } from './nudge.js';

/**
 * Handle a memory_review gateway call
 */
export async function handleMemoryReview(
  engine: CodeImpactEngine,
  input: MemoryReviewInput
): Promise<MemoryReviewResponse> {
  const action = detectReviewAction(input);
  const sourcesUsed: string[] = [];

  let response: MemoryReviewResponse;

  // Handle specific actions
  if (action !== 'full') {
    switch (action) {
      case 'pattern':
        response = await handlePatternOnly(engine, input, sourcesUsed);
        break;

      case 'conflicts':
        response = await handleConflictsOnly(engine, input, sourcesUsed);
        break;

      case 'tests':
        response = await handleTestsOnly(engine, input, sourcesUsed);
        break;

      case 'confidence':
        response = await handleConfidenceOnly(engine, input, sourcesUsed);
        break;

      case 'bugs':
        response = await handleBugsOnly(engine, input, sourcesUsed);
        break;

      case 'coverage':
        response = await handleCoverageOnly(engine, input, sourcesUsed);
        break;

      default:
        response = await handleFullReview(engine, input, sourcesUsed);
    }
  } else {
    // Full review - run applicable checks in parallel
    response = await handleFullReview(engine, input, sourcesUsed);
  }

  // Track token usage for stats (input = code, output = response)
  const inputTokens = countTokens(input.code || '');
  const outputTokens = countObjectTokens(response);
  engine.recordTokenUsage(`memory_review:${action}`, inputTokens, outputTokens);

  return response;
}

/**
 * Full comprehensive review
 * Enhanced with Ghost Mode conflict detection
 */
async function handleFullReview(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  const checks = getReviewChecks(input);

  // Notify ghost mode of file access for silent tracking
  if (input.file) {
    engine.notifyFileAccess(input.file).catch(() => {});
  }

  // Build parallel operations
  const operations: Promise<unknown>[] = [];
  const operationKeys: string[] = [];

  if (checks.runPatterns) {
    sourcesUsed.push('validate_pattern');
    operations.push(Promise.resolve(engine.validatePattern(input.code)));
    operationKeys.push('pattern');
  }

  if (checks.runConflicts) {
    sourcesUsed.push('check_conflicts');
    operations.push(engine.checkCodeConflicts(input.code));
    operationKeys.push('conflicts');
  }

  // Always run ghost mode conflict check for proactive intelligence
  sourcesUsed.push('ghost_conflicts');
  operations.push(Promise.resolve(engine.checkGhostConflicts(input.code, input.file)));
  operationKeys.push('ghost');

  if (checks.runConfidence) {
    sourcesUsed.push('get_confidence');
    operations.push(engine.getConfidence(input.code, input.intent));
    operationKeys.push('confidence');
  }

  if (checks.runExisting && input.intent) {
    sourcesUsed.push('suggest_existing');
    operations.push(Promise.resolve(engine.suggestExisting(input.intent, 5)));
    operationKeys.push('existing');
  }

  if (checks.runTests && input.file) {
    sourcesUsed.push('check_tests');
    operations.push(Promise.resolve(engine.checkTests(input.code, input.file)));
    operationKeys.push('tests');
  }

  if (checks.runBugs && input.error) {
    sourcesUsed.push('find_similar_bugs');
    operations.push(Promise.resolve(engine.findSimilarBugs(input.error, 5)));
    operationKeys.push('bugs');
  }

  // Run all checks in parallel
  const results = await Promise.all(operations);

  // Map results to their keys
  const resultMap: Record<string, unknown> = {};
  operationKeys.forEach((key, index) => {
    resultMap[key] = results[index];
  });

  // Extract typed results
  const patternResult = resultMap.pattern as PatternValidationResult | undefined;
  const conflictsResult = resultMap.conflicts as ConflictCheckResult | undefined;
  const confidenceResult = resultMap.confidence as ConfidenceCheckResult | undefined;
  const existingResult = resultMap.existing as ExistingFunctionResult[] | undefined;
  const testsResult = resultMap.tests as TestCheckResult | undefined;
  const bugsResult = resultMap.bugs as Array<{
    error: string;
    similarity: number;
    fix: string;
    file?: string;
  }> | undefined;
  const ghostResult = resultMap.ghost as Array<{
    decision: { id: string; title: string };
    warning: string;
    severity: 'low' | 'medium' | 'high';
    matchedTerms: string[];
  }> | undefined;

  // Calculate risk score and aggregate
  const response = aggregateReviewResults(
    patternResult || null,
    conflictsResult ? {
      hasConflicts: conflictsResult.hasConflicts,
      conflicts: conflictsResult.conflicts,
    } : null,
    confidenceResult || null,
    existingResult || null,
    testsResult || null,
    sourcesUsed
  );

  // Add ghost mode conflict warnings (proactive intelligence)
  if (ghostResult && ghostResult.length > 0) {
    // Merge ghost conflicts into the conflicts response
    const ghostConflicts = ghostResult.map(g => ({
      decision_id: g.decision.id,
      decision_title: g.decision.title,
      conflict_description: g.warning,
      severity: g.severity,
    }));

    if (response.conflicts) {
      // Add ghost conflicts that aren't already in the regular conflicts
      const existingIds = new Set(response.conflicts.conflicts.map(c => c.decision_id));
      const newConflicts = ghostConflicts.filter(c => !existingIds.has(c.decision_id));
      response.conflicts.conflicts.push(...newConflicts);
      response.conflicts.has_conflicts = response.conflicts.conflicts.length > 0;
    } else if (ghostConflicts.length > 0) {
      response.conflicts = {
        has_conflicts: true,
        conflicts: ghostConflicts,
      };

      // Increase risk score for ghost conflicts
      const highSeverity = ghostConflicts.filter(c => c.severity === 'high').length;
      const mediumSeverity = ghostConflicts.filter(c => c.severity === 'medium').length;
      response.risk_score = Math.min(100, response.risk_score + highSeverity * 20 + mediumSeverity * 10);

      // Update verdict if needed
      if (response.risk_score >= 70) {
        response.verdict = 'reject';
      } else if (response.risk_score >= 30) {
        response.verdict = 'warning';
      }
    }
  }

  // Add similar bugs if found
  if (bugsResult && bugsResult.length > 0) {
    response.similar_bugs = bugsResult.map(b => ({
      error: b.error.slice(0, 100),
      similarity: b.similarity,
      fix: b.fix,
      file: b.file,
    }));
  }

  // Add skill constraints as additional review criteria — and affect risk_score
  try {
    const skillReader = new SkillReader(engine.getProjectPath());
    const relevantSkills = input.file
      ? skillReader.findSkillsForFile(input.file)
      : [];
    const constraints = relevantSkills.length > 0
      ? relevantSkills.flatMap((s) => {
          const rulesMatch = s.content.match(/## Rules\n([\s\S]*?)(?:\n## |$)/);
          if (!rulesMatch || !rulesMatch[1]) return [];
          return rulesMatch[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => `[${s.id}] ${l.slice(2)}`);
        })
      : skillReader.getSkillConstraints().slice(0, 5);

    if (constraints.length > 0) {
      (response as MemoryReviewResponse & { skill_constraints?: string[] }).skill_constraints = constraints.slice(0, 10);
      sourcesUsed.push('knowledge_skills');

      const codeToCheck = (input.code || '').toLowerCase();
      if (codeToCheck.length > 0) {
        let violationPenalty = 0;
        const violatedConstraints: string[] = [];

        for (const constraint of constraints) {
          const cleanConstraint = constraint.replace(/^\[.*?\]\s*/, '');

          const severityMatch = constraint.match(/\/(critical|warning|info)\]/);
          const severity = severityMatch ? severityMatch[1] : 'warning';

          const keywords = cleanConstraint
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 4);

          const negativeIndicators = ['avoid', 'never', 'don\'t', 'must not', 'do not', 'prohibit'];
          const isNegativeConstraint = negativeIndicators.some((neg) => cleanConstraint.toLowerCase().includes(neg));

          if (isNegativeConstraint) {
            const actionKeywords = keywords.filter(
              (w) => !negativeIndicators.some((neg) => neg.includes(w.toLowerCase())),
            );
            const violates = actionKeywords.some((kw) => codeToCheck.includes(kw.toLowerCase()));
            if (violates) {
              const penalty = severity === 'critical' ? 10 : severity === 'warning' ? 5 : 2;
              violationPenalty += penalty;
              violatedConstraints.push(constraint);
            }
          }
        }

        if (violationPenalty > 0) {
          response.risk_score = Math.min(100, response.risk_score + violationPenalty);
          if (response.risk_score >= 70) {
            response.verdict = 'reject';
          } else if (response.risk_score >= 30 && response.verdict === 'approve') {
            response.verdict = 'warning';
          }
          (response as any).skill_violations = violatedConstraints;
        }
      }

    }
    for (const skill of relevantSkills) {
      try {
        const violations = (response as any).skill_violations;
        engine.logSkillUsage({
          skillId: skill.id,
          toolName: 'memory_review',
          filePath: input.file,
          outcome: response.verdict,
          constraintTriggered: violations?.length > 0
            ? violations.slice(0, 3).join('; ')
            : undefined,
          verdict: response.verdict,
          scoreDelta: response.risk_score,
        });
      } catch {
        // non-critical
      }
    }
  } catch {
    // skill reader may not be available
  }

  appendNudgeToResponse(response, engine, 'memory_review', {
    verdict: response.verdict,
    riskScore: response.risk_score,
    filePath: input.file,
  });

  return response;
}

/**
 * Pattern validation only
 */
async function handlePatternOnly(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  sourcesUsed.push('validate_pattern');

  const result = engine.validatePattern(input.code);

  const riskScore = calculateRiskScore(result, null, null, null);

  return {
    verdict: getVerdict(riskScore),
    risk_score: riskScore,
    sources_used: sourcesUsed,
    patterns: {
      valid: result.valid,
      score: result.score,
      matched_pattern: result.matchedPattern,
      violations: result.violations,
    },
  };
}

/**
 * Conflict check only
 */
async function handleConflictsOnly(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  sourcesUsed.push('check_conflicts');

  const result = await engine.checkCodeConflicts(input.code);

  const riskScore = calculateRiskScore(null, {
    hasConflicts: result.hasConflicts,
    conflicts: result.conflicts,
  }, null, null);

  return {
    verdict: getVerdict(riskScore),
    risk_score: riskScore,
    sources_used: sourcesUsed,
    conflicts: {
      has_conflicts: result.hasConflicts,
      conflicts: result.conflicts.map(c => ({
        decision_id: c.decisionId,
        decision_title: c.decisionTitle,
        conflict_description: c.conflictDescription,
        severity: c.severity,
      })),
    },
  };
}

/**
 * Test check only
 */
async function handleTestsOnly(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  if (!input.file) {
    return {
      verdict: 'warning',
      risk_score: 50,
      sources_used: sourcesUsed,
    };
  }

  sourcesUsed.push('check_tests');

  const result = engine.checkTests(input.code, input.file);

  const riskScore = calculateRiskScore(null, null, result, null);

  return {
    verdict: getVerdict(riskScore),
    risk_score: riskScore,
    sources_used: sourcesUsed,
    test_impact: {
      safe: result.safe,
      coverage_percent: result.coveragePercent,
      would_fail: result.wouldFail.map(f => ({
        test_name: f.test.name,
        test_file: f.test.file,
        reason: f.reason,
        suggested_fix: f.suggestedFix,
      })),
      suggested_updates: result.suggestedTestUpdates.map(u => ({
        file: u.file,
        test_name: u.testName,
        before: u.before,
        after: u.after,
        reason: u.reason,
      })),
    },
  };
}

/**
 * Confidence check only
 */
async function handleConfidenceOnly(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  sourcesUsed.push('get_confidence');

  const result = await engine.getConfidence(input.code, input.intent);

  const riskScore = calculateRiskScore(null, null, null, result);

  return {
    verdict: getVerdict(riskScore),
    risk_score: riskScore,
    sources_used: sourcesUsed,
    confidence: {
      level: result.confidence,
      score: result.score,
      reasoning: result.reasoning,
    },
  };
}

/**
 * Bug search only
 */
async function handleBugsOnly(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  if (!input.error) {
    return {
      verdict: 'approve',
      risk_score: 0,
      sources_used: sourcesUsed,
    };
  }

  sourcesUsed.push('find_similar_bugs');

  const bugs = engine.findSimilarBugs(input.error, 5);

  return {
    verdict: bugs.length > 0 ? 'warning' : 'approve',
    risk_score: bugs.length > 0 ? 30 : 0,
    sources_used: sourcesUsed,
    similar_bugs: bugs.map(b => ({
      error: b.error.slice(0, 100),
      similarity: b.similarity,
      fix: b.fix,
      file: b.file,
    })),
  };
}

/**
 * Coverage check only
 */
async function handleCoverageOnly(
  engine: CodeImpactEngine,
  input: MemoryReviewInput,
  sourcesUsed: string[]
): Promise<MemoryReviewResponse> {
  if (!input.file) {
    return {
      verdict: 'warning',
      risk_score: 50,
      sources_used: sourcesUsed,
    };
  }

  sourcesUsed.push('get_test_coverage');

  const coverage = engine.getTestCoverage(input.file);

  // Risk based on coverage percentage
  const riskScore = Math.max(0, 100 - coverage.coveragePercent);

  return {
    verdict: getVerdict(riskScore),
    risk_score: riskScore,
    sources_used: sourcesUsed,
    coverage: {
      file: coverage.file,
      total_tests: coverage.totalTests,
      coverage_percent: coverage.coveragePercent,
      uncovered_functions: coverage.uncoveredFunctions,
    },
  };
}
