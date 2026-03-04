import { execSync } from 'child_process';
import type { Tier2Storage } from '../storage/tier2.js';
import type { TestAwareness } from './test-awareness/index.js';
import type { TestInfo } from '../types/documentation.js';

/**
 * Represents a file affected by changes, with its distance from the changed file.
 */
export interface AffectedFile {
  file: string;
  depth: number;  // 0 = directly changed, 1 = direct dependent, 2+ = transitive
  imports: string[];  // What symbols it imports from the changed file
}

/**
 * Complete test impact analysis result.
 */
export interface TestImpactResult {
  changedFiles: string[];
  affectedFiles: AffectedFile[];
  testsToRun: TestInfo[];
  testsToSkip: TestInfo[];
  totalTests: number;
  coverage: {
    filesWithTests: number;
    filesWithoutTests: number;
    coveragePercent: number;
  };
  estimatedTime: {
    withImpactAnalysis: number;   // seconds
    withoutImpactAnalysis: number; // seconds
    saved: number;                 // seconds
    savedPercent: number;
  };
}

/**
 * TestImpactAnalyzer - Determines which tests need to run based on code changes.
 *
 * Uses the dependency graph and test coverage data to identify:
 * 1. Files affected by changes (direct and transitive dependents)
 * 2. Tests that cover those affected files
 * 3. Time savings from running only affected tests
 *
 * This enables "smart test selection" - run only the tests that could possibly
 * be affected by your changes, instead of the entire test suite.
 */
export class TestImpactAnalyzer {
  private tier2: Tier2Storage;
  private testAwareness: TestAwareness;
  private projectPath: string;

  // Estimated average time per test (seconds) - conservative estimate
  private static readonly SECONDS_PER_TEST = 0.5;

  constructor(tier2: Tier2Storage, testAwareness: TestAwareness, projectPath: string) {
    this.tier2 = tier2;
    this.testAwareness = testAwareness;
    this.projectPath = projectPath;
  }

  /**
   * Analyze the impact of changed files and determine which tests to run.
   */
  analyzeImpact(changedFiles: string[]): TestImpactResult {
    // Normalize file paths
    const normalizedChanges = changedFiles.map(f => this.normalizePath(f));

    // Get all affected files (direct changes + transitive dependents)
    const affectedFiles = this.getAffectedFiles(normalizedChanges);

    // Get all tests in the project
    const allTests = this.testAwareness.getAllTests();
    const totalTests = allTests.length;

    // Find tests that cover any of the affected files
    const testsToRun = this.findTestsForAffectedFiles(affectedFiles, normalizedChanges);
    const testsToRunIds = new Set(testsToRun.map(t => t.id));
    const testsToSkip = allTests.filter(t => !testsToRunIds.has(t.id));

    // Calculate coverage stats
    const affectedFilePaths = new Set([
      ...normalizedChanges,
      ...affectedFiles.map(f => f.file)
    ]);
    const filesWithTests = this.countFilesWithTests(affectedFilePaths, testsToRun);

    // Estimate time savings
    const estimatedTime = this.estimateTimeSavings(testsToRun.length, totalTests);

    return {
      changedFiles: normalizedChanges,
      affectedFiles,
      testsToRun,
      testsToSkip,
      totalTests,
      coverage: {
        filesWithTests,
        filesWithoutTests: affectedFilePaths.size - filesWithTests,
        coveragePercent: affectedFilePaths.size > 0
          ? Math.round((filesWithTests / affectedFilePaths.size) * 100)
          : 100,
      },
      estimatedTime,
    };
  }

  /**
   * Get changed files from git (staged + unstaged changes).
   */
  getChangedFilesFromGit(): string[] {
    try {
      // Get both staged and unstaged changes
      const staged = execSync('git diff --cached --name-only', {
        cwd: this.projectPath,
        encoding: 'utf-8',
      }).trim();

      const unstaged = execSync('git diff --name-only', {
        cwd: this.projectPath,
        encoding: 'utf-8',
      }).trim();

      // Combine and deduplicate
      const files = new Set<string>();

      for (const line of staged.split('\n')) {
        if (line.trim()) files.add(line.trim());
      }
      for (const line of unstaged.split('\n')) {
        if (line.trim()) files.add(line.trim());
      }

      return Array.from(files);
    } catch {
      // Git command failed (not a git repo, etc.)
      return [];
    }
  }

  /**
   * Get changed files from git compared to a specific branch.
   */
  getChangedFilesFromBranch(baseBranch: string = 'main'): string[] {
    try {
      const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
      }).trim();

      return output.split('\n').filter(line => line.trim());
    } catch {
      return [];
    }
  }

  /**
   * Format the analysis result for CLI output.
   */
  formatReport(result: TestImpactResult): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('TEST IMPACT ANALYSIS');
    lines.push('='.repeat(60));
    lines.push('');

    // Changed files
    lines.push('CHANGED FILES');
    lines.push('-'.repeat(40));
    if (result.changedFiles.length === 0) {
      lines.push('  No changed files detected.');
    } else {
      for (const file of result.changedFiles) {
        lines.push(`  ${file}`);
      }
    }
    lines.push('');

    // Affected files
    if (result.affectedFiles.length > 0) {
      lines.push('AFFECTED FILES (dependents)');
      lines.push('-'.repeat(40));
      for (const affected of result.affectedFiles.slice(0, 15)) {
        const depth = affected.depth === 1 ? 'direct' : `depth ${affected.depth}`;
        lines.push(`  ${affected.file} (${depth})`);
      }
      if (result.affectedFiles.length > 15) {
        lines.push(`  ... and ${result.affectedFiles.length - 15} more`);
      }
      lines.push('');
    }

    // Tests to run
    lines.push('TESTS TO RUN');
    lines.push('-'.repeat(40));
    if (result.testsToRun.length === 0) {
      lines.push('  No tests found for affected files.');
    } else {
      lines.push(`  ${result.testsToRun.length} tests (instead of ${result.totalTests})`);
      lines.push('');

      // Group by file
      const byFile = new Map<string, TestInfo[]>();
      for (const test of result.testsToRun) {
        if (!byFile.has(test.file)) byFile.set(test.file, []);
        byFile.get(test.file)!.push(test);
      }

      for (const [file, tests] of Array.from(byFile.entries()).slice(0, 10)) {
        lines.push(`  ${file}:`);
        for (const test of tests.slice(0, 5)) {
          const describes = test.describes ? `${test.describes} > ` : '';
          lines.push(`    - ${describes}${test.name}`);
        }
        if (tests.length > 5) {
          lines.push(`    ... and ${tests.length - 5} more tests`);
        }
      }
      if (byFile.size > 10) {
        lines.push(`  ... and ${byFile.size - 10} more test files`);
      }
    }
    lines.push('');

    // Time savings
    lines.push('TIME ESTIMATE');
    lines.push('-'.repeat(40));
    lines.push(`  With impact analysis:    ${this.formatTime(result.estimatedTime.withImpactAnalysis)}`);
    lines.push(`  Without impact analysis: ${this.formatTime(result.estimatedTime.withoutImpactAnalysis)}`);
    lines.push(`  Time saved:              ${this.formatTime(result.estimatedTime.saved)} (${result.estimatedTime.savedPercent}%)`);
    lines.push('');

    // Coverage
    lines.push('COVERAGE');
    lines.push('-'.repeat(40));
    lines.push(`  Files with test coverage:    ${result.coverage.filesWithTests}`);
    lines.push(`  Files without test coverage: ${result.coverage.filesWithoutTests}`);
    lines.push(`  Coverage: ${result.coverage.coveragePercent}%`);
    lines.push('');

    lines.push('='.repeat(60));

    // Command suggestion
    if (result.testsToRun.length > 0 && result.testsToRun.length < result.totalTests) {
      lines.push('');
      lines.push('RUN COMMAND:');
      const testFiles = [...new Set(result.testsToRun.map(t => t.file))];
      if (testFiles.length <= 5) {
        lines.push(`  npx jest ${testFiles.join(' ')}`);
      } else {
        lines.push(`  npx jest --testPathPattern="${testFiles.slice(0, 3).join('|')}"`);
        lines.push(`  # Or use: npx jest --changedSince=main`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format the analysis result as JSON.
   */
  formatReportJSON(result: TestImpactResult): string {
    return JSON.stringify({
      summary: {
        changedFiles: result.changedFiles.length,
        affectedFiles: result.affectedFiles.length,
        testsToRun: result.testsToRun.length,
        totalTests: result.totalTests,
        timeSavedSeconds: result.estimatedTime.saved,
        timeSavedPercent: result.estimatedTime.savedPercent,
      },
      changedFiles: result.changedFiles,
      affectedFiles: result.affectedFiles,
      testsToRun: result.testsToRun.map(t => ({
        id: t.id,
        file: t.file,
        name: t.name,
        describes: t.describes,
      })),
      testsToSkip: result.testsToSkip.map(t => ({
        id: t.id,
        file: t.file,
        name: t.name,
      })),
      coverage: result.coverage,
      estimatedTime: result.estimatedTime,
    }, null, 2);
  }

  // ==================== Private Helpers ====================

  /**
   * Get all files affected by the changed files (transitive dependents).
   */
  private getAffectedFiles(changedFiles: string[]): AffectedFile[] {
    const allAffected = new Map<string, AffectedFile>();

    for (const changedFile of changedFiles) {
      // Get transitive dependents (files that import this file, directly or indirectly)
      const dependents = this.tier2.getTransitiveDependents(changedFile, 3);

      for (const dep of dependents) {
        const existing = allAffected.get(dep.file);
        if (!existing || existing.depth > dep.depth) {
          allAffected.set(dep.file, {
            file: dep.file,
            depth: dep.depth,
            imports: dep.imports,
          });
        }
      }
    }

    // Sort by depth (closest first)
    return Array.from(allAffected.values()).sort((a, b) => a.depth - b.depth);
  }

  /**
   * Find tests that cover any of the affected files.
   */
  private findTestsForAffectedFiles(
    affectedFiles: AffectedFile[],
    changedFiles: string[]
  ): TestInfo[] {
    const testsMap = new Map<string, TestInfo>();

    // Get tests for directly changed files
    for (const file of changedFiles) {
      const tests = this.testAwareness.getTestsForFile(file);
      for (const test of tests) {
        testsMap.set(test.id, test);
      }
    }

    // Get tests for affected files
    for (const affected of affectedFiles) {
      const tests = this.testAwareness.getTestsForFile(affected.file);
      for (const test of tests) {
        testsMap.set(test.id, test);
      }
    }

    // Also check if any test file itself was changed
    for (const file of changedFiles) {
      if (this.isTestFile(file)) {
        const tests = this.testAwareness.getTestsByTestFile(file);
        for (const test of tests) {
          testsMap.set(test.id, test);
        }
      }
    }

    return Array.from(testsMap.values());
  }

  /**
   * Count how many affected files have test coverage.
   */
  private countFilesWithTests(affectedFiles: Set<string>, tests: TestInfo[]): number {
    const coveredFiles = new Set<string>();

    for (const test of tests) {
      for (const file of test.coversFiles) {
        if (affectedFiles.has(file) || affectedFiles.has(this.normalizePath(file))) {
          coveredFiles.add(file);
        }
      }
    }

    return coveredFiles.size;
  }

  /**
   * Estimate time savings from running only affected tests.
   */
  private estimateTimeSavings(
    testsToRun: number,
    totalTests: number
  ): TestImpactResult['estimatedTime'] {
    const withImpactAnalysis = testsToRun * TestImpactAnalyzer.SECONDS_PER_TEST;
    const withoutImpactAnalysis = totalTests * TestImpactAnalyzer.SECONDS_PER_TEST;
    const saved = withoutImpactAnalysis - withImpactAnalysis;
    const savedPercent = totalTests > 0
      ? Math.round((1 - testsToRun / totalTests) * 100)
      : 0;

    return {
      withImpactAnalysis: Math.round(withImpactAnalysis),
      withoutImpactAnalysis: Math.round(withoutImpactAnalysis),
      saved: Math.round(saved),
      savedPercent,
    };
  }

  /**
   * Check if a file is a test file.
   */
  private isTestFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return (
      normalized.includes('.test.') ||
      normalized.includes('.spec.') ||
      normalized.includes('__tests__/') ||
      normalized.includes('/test/') ||
      normalized.includes('/tests/')
    );
  }

  /**
   * Normalize a file path for comparison.
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  /**
   * Format seconds into human-readable time.
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
  }
}
