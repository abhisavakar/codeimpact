import type { Tier2Storage } from '../storage/tier2.js';
import type { TestAwareness } from './test-awareness/index.js';

/**
 * Represents a file affected by changes to the target file.
 */
export interface AffectedFile {
  file: string;
  depth: number;
  imports: string[];
}

/**
 * Risk level classification.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Complete blast radius analysis result.
 */
export interface BlastRadiusResult {
  file: string;
  riskScore: number;  // 0-100
  riskLevel: RiskLevel;
  directDependents: number;
  transitiveDependents: number;
  totalAffected: number;
  affectedFiles: AffectedFile[];
  criticalPaths: string[];
  inCriticalPath: boolean;
  testCoverage: {
    covered: number;
    total: number;
    percent: number;
  };
  recommendation: string;
}

/**
 * Configuration for critical path detection.
 */
export interface CriticalPathConfig {
  patterns: string[];
  weight: number;
}

/**
 * BlastRadiusAnalyzer - Analyzes the impact of changing a file.
 *
 * Calculates:
 * 1. How many files would be affected (direct + transitive dependents)
 * 2. Risk score based on file location, dependents, and test coverage
 * 3. Whether the file is in a critical path (auth, payments, etc.)
 * 4. Recommendations for review process
 */
export class BlastRadiusAnalyzer {
  private tier2: Tier2Storage;
  private testAwareness: TestAwareness | null;

  // Critical path patterns with their risk weights
  private static readonly CRITICAL_PATHS: CriticalPathConfig[] = [
    { patterns: ['auth', 'authentication', 'login', 'session', 'token', 'jwt', 'oauth'], weight: 30 },
    { patterns: ['payment', 'billing', 'invoice', 'subscription', 'stripe', 'checkout'], weight: 35 },
    { patterns: ['security', 'crypto', 'encrypt', 'hash', 'password'], weight: 30 },
    { patterns: ['database', 'migration', 'schema', 'model'], weight: 25 },
    { patterns: ['api', 'endpoint', 'route', 'controller'], weight: 15 },
    { patterns: ['config', 'settings', 'env'], weight: 20 },
    { patterns: ['core', 'kernel', 'engine', 'base'], weight: 20 },
  ];

  constructor(tier2: Tier2Storage, testAwareness: TestAwareness | null = null) {
    this.tier2 = tier2;
    this.testAwareness = testAwareness;
  }

  /**
   * Analyze the blast radius of changing a specific file.
   */
  analyze(filePath: string, maxDepth: number = 3): BlastRadiusResult {
    // Normalize path
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Get transitive dependents
    const affectedFiles = this.tier2.getTransitiveDependents(normalizedPath, maxDepth);

    // Separate direct vs transitive
    const directDependents = affectedFiles.filter(f => f.depth === 1).length;
    const transitiveDependents = affectedFiles.filter(f => f.depth > 1).length;

    // Detect critical paths
    const criticalPaths = this.detectCriticalPaths(normalizedPath, affectedFiles);
    const inCriticalPath = this.isInCriticalPath(normalizedPath);

    // Calculate test coverage for affected files
    const testCoverage = this.calculateTestCoverage(normalizedPath, affectedFiles);

    // Calculate risk score
    const riskScore = this.calculateRiskScore(
      normalizedPath,
      directDependents,
      transitiveDependents,
      criticalPaths.length,
      inCriticalPath,
      testCoverage.percent
    );

    // Determine risk level
    const riskLevel = this.getRiskLevel(riskScore);

    // Generate recommendation
    const recommendation = this.generateRecommendation(riskLevel, criticalPaths.length, testCoverage.percent);

    return {
      file: normalizedPath,
      riskScore,
      riskLevel,
      directDependents,
      transitiveDependents,
      totalAffected: affectedFiles.length,
      affectedFiles: affectedFiles.map(f => ({
        file: f.file,
        depth: f.depth,
        imports: f.imports,
      })),
      criticalPaths,
      inCriticalPath,
      testCoverage,
      recommendation,
    };
  }

  /**
   * Format the analysis result for CLI output.
   */
  formatReport(result: BlastRadiusResult): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('BLAST RADIUS ANALYSIS');
    lines.push('='.repeat(60));
    lines.push('');

    // File info
    lines.push(`File: ${result.file}`);
    lines.push('');

    // Risk summary
    lines.push('RISK ASSESSMENT');
    lines.push('-'.repeat(40));
    lines.push(`Risk Score: ${result.riskScore}/100 (${result.riskLevel.toUpperCase()})`);
    lines.push(`In Critical Path: ${result.inCriticalPath ? 'YES' : 'No'}`);
    lines.push('');

    // Impact numbers
    lines.push('IMPACT');
    lines.push('-'.repeat(40));
    lines.push(`Direct dependents:     ${result.directDependents} files`);
    lines.push(`Transitive dependents: ${result.transitiveDependents} files`);
    lines.push(`Total affected:        ${result.totalAffected} files`);
    lines.push('');

    // Critical paths affected
    if (result.criticalPaths.length > 0) {
      lines.push('CRITICAL PATHS AFFECTED');
      lines.push('-'.repeat(40));
      for (const path of result.criticalPaths.slice(0, 10)) {
        lines.push(`  ${path}`);
      }
      if (result.criticalPaths.length > 10) {
        lines.push(`  ... and ${result.criticalPaths.length - 10} more`);
      }
      lines.push('');
    }

    // Test coverage
    lines.push('TEST COVERAGE');
    lines.push('-'.repeat(40));
    lines.push(`Covered files:   ${result.testCoverage.covered}/${result.testCoverage.total}`);
    lines.push(`Coverage:        ${result.testCoverage.percent}%`);
    lines.push('');

    // Affected files
    if (result.affectedFiles.length > 0) {
      lines.push('AFFECTED FILES');
      lines.push('-'.repeat(40));

      // Group by depth
      const byDepth = new Map<number, AffectedFile[]>();
      for (const file of result.affectedFiles) {
        if (!byDepth.has(file.depth)) byDepth.set(file.depth, []);
        byDepth.get(file.depth)!.push(file);
      }

      for (const [depth, files] of Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])) {
        const label = depth === 1 ? 'Direct' : `Depth ${depth}`;
        lines.push(`  ${label} (${files.length} files):`);
        for (const file of files.slice(0, 5)) {
          lines.push(`    - ${file.file}`);
        }
        if (files.length > 5) {
          lines.push(`    ... and ${files.length - 5} more`);
        }
      }
      lines.push('');
    }

    // Recommendation
    lines.push('RECOMMENDATION');
    lines.push('-'.repeat(40));
    lines.push(`  ${result.recommendation}`);
    lines.push('');

    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  /**
   * Format the analysis result as JSON.
   */
  formatReportJSON(result: BlastRadiusResult): string {
    return JSON.stringify({
      file: result.file,
      risk: {
        score: result.riskScore,
        level: result.riskLevel,
        inCriticalPath: result.inCriticalPath,
      },
      impact: {
        directDependents: result.directDependents,
        transitiveDependents: result.transitiveDependents,
        totalAffected: result.totalAffected,
      },
      criticalPaths: result.criticalPaths,
      testCoverage: result.testCoverage,
      affectedFiles: result.affectedFiles,
      recommendation: result.recommendation,
    }, null, 2);
  }

  // ==================== Private Helpers ====================

  /**
   * Calculate risk score (0-100) based on multiple factors.
   */
  private calculateRiskScore(
    filePath: string,
    directDependents: number,
    transitiveDependents: number,
    criticalPathsAffected: number,
    inCriticalPath: boolean,
    testCoveragePercent: number
  ): number {
    let score = 0;

    // Base score from dependents (max 40 points)
    // More dependents = higher risk
    const totalDependents = directDependents + transitiveDependents;
    if (totalDependents === 0) {
      score += 5;  // Low risk if nothing depends on it
    } else if (totalDependents <= 3) {
      score += 15;
    } else if (totalDependents <= 10) {
      score += 25;
    } else if (totalDependents <= 25) {
      score += 35;
    } else {
      score += 40;
    }

    // Critical path bonus (max 35 points)
    if (inCriticalPath) {
      score += this.getCriticalPathWeight(filePath);
    }

    // Affected critical paths bonus (max 15 points)
    if (criticalPathsAffected > 0) {
      score += Math.min(15, criticalPathsAffected * 3);
    }

    // Test coverage penalty/bonus (max 10 points)
    // Low coverage = higher risk
    if (testCoveragePercent < 30) {
      score += 10;  // High risk - poor test coverage
    } else if (testCoveragePercent < 60) {
      score += 5;   // Medium risk
    } else if (testCoveragePercent >= 80) {
      score -= 5;   // Lower risk due to good coverage
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get the risk weight for a file in a critical path.
   */
  private getCriticalPathWeight(filePath: string): number {
    const normalizedPath = filePath.toLowerCase();
    let maxWeight = 0;

    for (const config of BlastRadiusAnalyzer.CRITICAL_PATHS) {
      for (const pattern of config.patterns) {
        if (normalizedPath.includes(pattern)) {
          maxWeight = Math.max(maxWeight, config.weight);
        }
      }
    }

    return maxWeight;
  }

  /**
   * Check if a file is in a critical path.
   */
  private isInCriticalPath(filePath: string): boolean {
    const normalizedPath = filePath.toLowerCase();

    for (const config of BlastRadiusAnalyzer.CRITICAL_PATHS) {
      for (const pattern of config.patterns) {
        if (normalizedPath.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detect critical paths among affected files.
   */
  private detectCriticalPaths(
    targetFile: string,
    affectedFiles: Array<{ file: string; depth: number; imports: string[] }>
  ): string[] {
    const criticalPaths: string[] = [];

    // Check the target file itself
    if (this.isInCriticalPath(targetFile)) {
      criticalPaths.push(targetFile);
    }

    // Check affected files
    for (const affected of affectedFiles) {
      if (this.isInCriticalPath(affected.file)) {
        criticalPaths.push(affected.file);
      }
    }

    return criticalPaths;
  }

  /**
   * Calculate test coverage for affected files.
   */
  private calculateTestCoverage(
    targetFile: string,
    affectedFiles: Array<{ file: string; depth: number; imports: string[] }>
  ): { covered: number; total: number; percent: number } {
    if (!this.testAwareness) {
      return { covered: 0, total: 0, percent: 0 };
    }

    const allFiles = [targetFile, ...affectedFiles.map(f => f.file)];
    let covered = 0;
    const total = allFiles.length;

    for (const file of allFiles) {
      const tests = this.testAwareness.getTestsForFile(file);
      if (tests.length > 0) {
        covered++;
      }
    }

    const percent = total > 0 ? Math.round((covered / total) * 100) : 0;
    return { covered, total, percent };
  }

  /**
   * Determine risk level from score.
   */
  private getRiskLevel(score: number): RiskLevel {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  /**
   * Generate a recommendation based on analysis.
   */
  private generateRecommendation(
    riskLevel: RiskLevel,
    criticalPathsAffected: number,
    testCoveragePercent: number
  ): string {
    const recommendations: string[] = [];

    switch (riskLevel) {
      case 'critical':
        recommendations.push('Senior engineer review required.');
        recommendations.push('Consider staging deployment with monitoring.');
        break;
      case 'high':
        recommendations.push('Peer review recommended before merge.');
        break;
      case 'medium':
        recommendations.push('Standard review process.');
        break;
      case 'low':
        recommendations.push('Low risk change, standard process applies.');
        break;
    }

    if (criticalPathsAffected > 0) {
      recommendations.push(`Affects ${criticalPathsAffected} critical path(s) - extra caution advised.`);
    }

    if (testCoveragePercent < 50) {
      recommendations.push('Consider adding tests before making changes.');
    }

    return recommendations.join(' ');
  }
}
