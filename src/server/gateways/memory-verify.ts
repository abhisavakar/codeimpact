/**
 * Memory Verify Gateway
 *
 * Pre-commit quality gate for AI-generated code.
 *
 * Checks:
 * - imports: Do imports exist? Is the API being used correctly?
 * - security: Common vulnerability patterns (OWASP Top 10)
 * - dependencies: Is package in package.json? Is it installed?
 * - patterns: Does code follow project patterns?
 * - tests: Will this break tests?
 * - all: Run all checks (default)
 *
 * Solves top vibe coder problems:
 * - Hallucination detection (AI invents libraries that don't exist)
 * - Security scanning (1.7x more vulnerabilities in AI code)
 * - Pre-commit quality gate
 */

import type { CodeImpactEngine } from '../../core/engine.js';

// ============================================================================
// Types
// ============================================================================

export type VerifyCheck = 'imports' | 'security' | 'dependencies' | 'patterns' | 'tests' | 'all';

export interface MemoryVerifyInput {
  /** Code to verify */
  code: string;
  /** Target file path (enables import resolution and test checks) */
  file?: string;
  /** Specific checks to run (default: all) */
  checks?: VerifyCheck[];
  /** Intent/purpose of the code (improves suggestions) */
  intent?: string;
}

export interface MemoryVerifyResponse {
  /** Overall verdict */
  verdict: 'pass' | 'warning' | 'fail';
  /** Quality score (0-100, higher is better) */
  score: number;
  /** Sources used for verification */
  sources_used: string[];
  /** Human-readable summary */
  summary: string;
  /** Import verification results */
  imports?: {
    valid: boolean;
    issues: Array<{
      import: string;
      type: 'missing_package' | 'missing_file' | 'invalid_export' | 'deprecated' | 'hallucinated';
      message: string;
      suggestion?: string;
    }>;
    warnings: Array<{
      import: string;
      type: 'outdated' | 'security' | 'deprecated_api';
      message: string;
      suggestion?: string;
    }>;
  };
  /** Security scan results */
  security?: {
    safe: boolean;
    score: number;
    issues: Array<{
      type: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      line?: number;
      code?: string;
      message: string;
      cwe?: string;
      suggestion?: string;
    }>;
  };
  /** Dependency check results */
  dependencies?: {
    valid: boolean;
    issues: Array<{
      package: string;
      type: 'not_installed' | 'version_mismatch' | 'deprecated' | 'vulnerable' | 'unlisted';
      message: string;
      suggestion?: string;
    }>;
  };
  /** Pattern validation results (from memory_review) */
  patterns?: {
    valid: boolean;
    score: number;
    matched_pattern?: string;
    violations: Array<{
      rule: string;
      message: string;
      severity: string;
      suggestion?: string;
    }>;
  };
  /** Test impact results (from memory_review) */
  test_impact?: {
    safe: boolean;
    coverage_percent: number;
    would_fail: Array<{
      test_name: string;
      test_file: string;
      reason: string;
      suggested_fix?: string;
    }>;
  };
  /** Decision conflict warnings */
  conflicts?: {
    has_conflicts: boolean;
    conflicts: Array<{
      decision_id: string;
      decision_title: string;
      warning: string;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  /** Actionable suggestions to fix issues */
  suggestions: string[];
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle a memory_verify gateway call
 */
export async function handleMemoryVerify(
  engine: CodeImpactEngine,
  input: MemoryVerifyInput
): Promise<MemoryVerifyResponse> {
  const checks = input.checks || ['all'];
  const runAll = checks.includes('all');
  const sourcesUsed: string[] = [];
  const suggestions: string[] = [];

  let totalScore = 100;

  // Track file access for ghost mode
  if (input.file) {
    await engine.notifyFileAccess(input.file);
  }

  const response: MemoryVerifyResponse = {
    verdict: 'pass',
    score: 100,
    sources_used: sourcesUsed,
    summary: '',
    suggestions: [],
  };

  // Run code verification (imports, security, dependencies)
  if (runAll || checks.includes('imports') || checks.includes('security') || checks.includes('dependencies')) {
    sourcesUsed.push('code_verifier');

    const verifierChecks: ('imports' | 'security' | 'dependencies')[] = [];
    if (runAll || checks.includes('imports')) verifierChecks.push('imports');
    if (runAll || checks.includes('security')) verifierChecks.push('security');
    if (runAll || checks.includes('dependencies')) verifierChecks.push('dependencies');

    const verification = await engine.verifyCode(input.code, input.file, verifierChecks);

    // Add import results
    if (verification.imports) {
      response.imports = {
        valid: verification.imports.valid,
        issues: verification.imports.issues,
        warnings: verification.imports.warnings,
      };
      if (!verification.imports.valid) {
        totalScore -= verification.imports.issues.length * 15;
        suggestions.push(...verification.imports.issues.map(i => i.suggestion || i.message));
      }
      if (verification.imports.warnings.length > 0) {
        totalScore -= verification.imports.warnings.length * 5;
      }
    }

    // Add security results
    if (verification.security) {
      response.security = {
        safe: verification.security.safe,
        score: verification.security.score,
        issues: verification.security.issues,
      };
      if (!verification.security.safe) {
        totalScore = Math.min(totalScore, verification.security.score);
        suggestions.push(...verification.security.issues.map(i => i.suggestion || i.message));
      }
    }

    // Add dependency results
    if (verification.dependencies) {
      response.dependencies = {
        valid: verification.dependencies.valid,
        issues: verification.dependencies.issues,
      };
      if (!verification.dependencies.valid) {
        totalScore -= verification.dependencies.issues.length * 10;
        suggestions.push(...verification.dependencies.issues.map(d => d.suggestion || d.message));
      }
    }
  }

  // Run pattern validation
  if (runAll || checks.includes('patterns')) {
    sourcesUsed.push('validate_pattern');

    const patternResult = engine.validatePattern(input.code);

    response.patterns = {
      valid: patternResult.valid,
      score: patternResult.score,
      matched_pattern: patternResult.matchedPattern,
      violations: patternResult.violations,
    };

    if (!patternResult.valid) {
      totalScore -= patternResult.violations.length * 10;
      suggestions.push(...patternResult.violations
        .filter(v => v.suggestion)
        .map(v => v.suggestion!));
    }
  }

  // Run test impact check
  if ((runAll || checks.includes('tests')) && input.file) {
    sourcesUsed.push('check_tests');

    const testResult = engine.checkTests(input.code, input.file);

    response.test_impact = {
      safe: testResult.safe,
      coverage_percent: testResult.coveragePercent,
      would_fail: testResult.wouldFail.map(f => ({
        test_name: f.test.name,
        test_file: f.test.file,
        reason: f.reason,
        suggested_fix: f.suggestedFix,
      })),
    };

    if (!testResult.safe) {
      totalScore -= testResult.wouldFail.length * 15;
      suggestions.push(...testResult.wouldFail.map(f => f.suggestedFix || `Test "${f.test.name}" would fail: ${f.reason}`));
    }
  }

  // Check for decision conflicts (always run - it's cheap)
  sourcesUsed.push('ghost_conflicts');
  const conflicts = engine.checkGhostConflicts(input.code, input.file);

  if (conflicts.length > 0) {
    response.conflicts = {
      has_conflicts: true,
      conflicts: conflicts.map(c => ({
        decision_id: c.decision.id,
        decision_title: c.decision.title,
        warning: c.warning,
        severity: c.severity,
      })),
    };

    const highSeverity = conflicts.filter(c => c.severity === 'high').length;
    const mediumSeverity = conflicts.filter(c => c.severity === 'medium').length;
    totalScore -= highSeverity * 20 + mediumSeverity * 10;

    suggestions.push(...conflicts.map(c =>
      `Potential conflict with decision "${c.decision.title}": ${c.warning}`
    ));
  }

  // Calculate final verdict
  response.score = Math.max(0, Math.min(100, totalScore));
  response.verdict = calculateVerdict(response);
  response.summary = buildSummary(response);
  response.suggestions = [...new Set(suggestions)].slice(0, 10);

  // Track token usage for stats
  const tokensUsed = Math.ceil(JSON.stringify(response).length / 4);
  engine.recordTokenUsage('memory_verify', tokensUsed);

  return response;
}

// ============================================================================
// Helpers
// ============================================================================

function calculateVerdict(response: MemoryVerifyResponse): 'pass' | 'warning' | 'fail' {
  // Critical security issues = fail
  if (response.security?.issues.some(i => i.severity === 'critical')) {
    return 'fail';
  }

  // Multiple high severity security issues = fail
  const highSecurityCount = response.security?.issues.filter(i => i.severity === 'high').length || 0;
  if (highSecurityCount >= 2) {
    return 'fail';
  }

  // High severity conflicts = fail
  if (response.conflicts?.conflicts.some(c => c.severity === 'high')) {
    return 'fail';
  }

  // Missing packages (hallucination) = fail
  const hallucinatedImports = response.imports?.issues.filter(i =>
    i.type === 'missing_package' || i.type === 'hallucinated'
  ).length || 0;
  if (hallucinatedImports >= 2) {
    return 'fail';
  }

  // Score-based
  if (response.score >= 70) return 'pass';
  if (response.score >= 40) return 'warning';
  return 'fail';
}

function buildSummary(response: MemoryVerifyResponse): string {
  const parts: string[] = [];

  // Imports
  if (response.imports) {
    if (response.imports.valid && response.imports.warnings.length === 0) {
      parts.push('Imports: OK');
    } else {
      const issueCount = response.imports.issues.length;
      const warnCount = response.imports.warnings.length;
      if (issueCount > 0) {
        parts.push(`Imports: ${issueCount} issue${issueCount > 1 ? 's' : ''}`);
      }
      if (warnCount > 0) {
        parts.push(`${warnCount} warning${warnCount > 1 ? 's' : ''}`);
      }
    }
  }

  // Security
  if (response.security) {
    if (response.security.safe) {
      parts.push('Security: OK');
    } else {
      const critical = response.security.issues.filter(i => i.severity === 'critical').length;
      const high = response.security.issues.filter(i => i.severity === 'high').length;
      const medium = response.security.issues.filter(i => i.severity === 'medium').length;

      const secParts: string[] = [];
      if (critical > 0) secParts.push(`${critical} critical`);
      if (high > 0) secParts.push(`${high} high`);
      if (medium > 0) secParts.push(`${medium} medium`);
      parts.push(`Security: ${secParts.join(', ')}`);
    }
  }

  // Dependencies
  if (response.dependencies) {
    if (response.dependencies.valid) {
      parts.push('Deps: OK');
    } else {
      parts.push(`Deps: ${response.dependencies.issues.length} issue${response.dependencies.issues.length > 1 ? 's' : ''}`);
    }
  }

  // Patterns
  if (response.patterns) {
    if (response.patterns.valid) {
      parts.push('Patterns: OK');
    } else {
      parts.push(`Patterns: ${response.patterns.violations.length} violation${response.patterns.violations.length > 1 ? 's' : ''}`);
    }
  }

  // Tests
  if (response.test_impact) {
    if (response.test_impact.safe) {
      parts.push('Tests: OK');
    } else {
      parts.push(`Tests: ${response.test_impact.would_fail.length} would fail`);
    }
  }

  // Conflicts
  if (response.conflicts?.has_conflicts) {
    parts.push(`Conflicts: ${response.conflicts.conflicts.length}`);
  }

  const verdictEmoji = response.verdict === 'pass' ? '✅' : response.verdict === 'warning' ? '⚠️' : '❌';

  return `${verdictEmoji} [${response.verdict.toUpperCase()}] Score: ${response.score}/100 | ${parts.join(' | ')}`;
}
