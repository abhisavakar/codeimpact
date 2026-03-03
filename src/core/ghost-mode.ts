/**
 * Ghost Mode - Silent Intelligence Layer
 *
 * Silently tracks what files Claude reads/writes. When code is written that
 * touches a file with recorded decisions, automatically checks for conflicts.
 * Makes CodeImpact feel "telepathic" by surfacing relevant context proactively.
 */

import type { Decision } from '../types/index.js';
import type { Tier2Storage } from '../storage/tier2.js';
import type { EmbeddingGenerator } from '../indexing/embeddings.js';

export interface ConflictWarning {
  decision: Decision;
  warning: string;
  severity: 'low' | 'medium' | 'high';
  matchedTerms: string[];
}

export interface FileContext {
  path: string;
  accessedAt: Date;
  relatedDecisions: Decision[];
  relatedPatterns: string[];
  accessCount: number;
}

export interface GhostInsight {
  activeFiles: string[];
  recentDecisions: Decision[];
  potentialConflicts: ConflictWarning[];
  suggestions: string[];
}

// Decision keywords that indicate strong stances
const DECISION_INDICATORS = [
  'use', 'always', 'never', 'prefer', 'avoid', 'must', 'should',
  'instead of', 'rather than', 'not', 'don\'t', 'do not',
];

// Technology/pattern keywords for matching
const TECH_PATTERNS = [
  // Auth
  { pattern: /\b(jwt|json\s*web\s*token)\b/i, category: 'auth', term: 'JWT' },
  { pattern: /\b(session|cookie)\b/i, category: 'auth', term: 'session' },
  { pattern: /\b(oauth|o-?auth)\b/i, category: 'auth', term: 'OAuth' },
  // Database
  { pattern: /\b(sql|mysql|postgres|postgresql)\b/i, category: 'database', term: 'SQL' },
  { pattern: /\b(mongo|mongodb|nosql)\b/i, category: 'database', term: 'MongoDB' },
  { pattern: /\b(redis|memcache)\b/i, category: 'cache', term: 'Redis' },
  // State
  { pattern: /\b(redux|zustand|mobx)\b/i, category: 'state', term: 'state-management' },
  { pattern: /\b(context\s*api|useContext)\b/i, category: 'state', term: 'Context API' },
  // Testing
  { pattern: /\b(jest|vitest|mocha)\b/i, category: 'testing', term: 'testing-framework' },
  { pattern: /\b(enzyme|testing-library|rtl)\b/i, category: 'testing', term: 'testing-library' },
  // API
  { pattern: /\b(rest|restful)\b/i, category: 'api', term: 'REST' },
  { pattern: /\b(graphql|gql)\b/i, category: 'api', term: 'GraphQL' },
  { pattern: /\b(grpc|protobuf)\b/i, category: 'api', term: 'gRPC' },
  // Style
  { pattern: /\b(tailwind|tailwindcss)\b/i, category: 'styling', term: 'Tailwind' },
  { pattern: /\b(styled-components|emotion)\b/i, category: 'styling', term: 'CSS-in-JS' },
  { pattern: /\b(sass|scss|less)\b/i, category: 'styling', term: 'CSS preprocessor' },
];

export interface FileImpact {
  changedFile: string;
  affectedFiles: string[];
  timestamp: Date;
}

export class GhostMode {
  private activeFiles: Map<string, FileContext> = new Map();
  private recentDecisions: Map<string, Decision[]> = new Map();
  private recentImpacts: Map<string, FileImpact> = new Map(); // Track file impacts
  private tier2: Tier2Storage;
  private embeddingGenerator: EmbeddingGenerator;

  // Ghost mode settings
  private readonly MAX_ACTIVE_FILES = 20;
  private readonly FILE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly DECISION_CACHE_SIZE = 50;
  private readonly IMPACT_TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor(tier2: Tier2Storage, embeddingGenerator: EmbeddingGenerator) {
    this.tier2 = tier2;
    this.embeddingGenerator = embeddingGenerator;
  }

  /**
   * Called when a file change impacts other files
   */
  onFileImpact(changedFile: string, affectedFiles: string[]): void {
    const impact: FileImpact = {
      changedFile,
      affectedFiles,
      timestamp: new Date()
    };

    // Store impact for each affected file
    for (const file of affectedFiles) {
      this.recentImpacts.set(file, impact);
    }

    // Evict old impacts
    this.evictStaleImpacts();
  }

  /**
   * Check if a file was recently impacted by changes to another file
   */
  getImpactWarning(filePath: string): FileImpact | null {
    const impact = this.recentImpacts.get(filePath);
    if (!impact) return null;

    // Check if still within TTL
    const age = Date.now() - impact.timestamp.getTime();
    if (age > this.IMPACT_TTL_MS) {
      this.recentImpacts.delete(filePath);
      return null;
    }

    return impact;
  }

  private evictStaleImpacts(): void {
    const now = Date.now();
    for (const [file, impact] of this.recentImpacts) {
      if (now - impact.timestamp.getTime() > this.IMPACT_TTL_MS) {
        this.recentImpacts.delete(file);
      }
    }
  }

  /**
   * Called when any file is read - silently track and pre-fetch decisions
   */
  async onFileAccess(filePath: string): Promise<void> {
    const now = new Date();

    // Update or create file context
    const existing = this.activeFiles.get(filePath);
    if (existing) {
      existing.accessedAt = now;
      existing.accessCount++;
    } else {
      // Pre-fetch related decisions for this file
      const relatedDecisions = await this.findRelatedDecisions(filePath);
      const relatedPatterns = await this.findRelatedPatterns(filePath);

      this.activeFiles.set(filePath, {
        path: filePath,
        accessedAt: now,
        relatedDecisions,
        relatedPatterns,
        accessCount: 1,
      });

      // Cache decisions for quick conflict checking
      this.recentDecisions.set(filePath, relatedDecisions);
    }

    // Evict stale entries
    this.evictStaleFiles();
  }

  /**
   * Called before code is written - returns potential conflicts
   */
  checkConflicts(code: string, targetFile?: string): ConflictWarning[] {
    const warnings: ConflictWarning[] = [];
    const codeTerms = this.extractTerms(code);

    // Get decisions to check against
    let decisionsToCheck: Decision[] = [];

    if (targetFile && this.recentDecisions.has(targetFile)) {
      decisionsToCheck = this.recentDecisions.get(targetFile) || [];
    } else {
      // Check against all cached decisions
      for (const decisions of this.recentDecisions.values()) {
        decisionsToCheck.push(...decisions);
      }
      // Deduplicate
      decisionsToCheck = this.deduplicateDecisions(decisionsToCheck);
    }

    // Check each decision for conflicts
    for (const decision of decisionsToCheck) {
      const conflict = this.detectConflict(code, codeTerms, decision);
      if (conflict) {
        warnings.push(conflict);
      }
    }

    // Sort by severity
    warnings.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    return warnings;
  }

  /**
   * Get current ghost insight - what the system knows about current work
   */
  getInsight(): GhostInsight {
    const activeFiles = Array.from(this.activeFiles.keys());
    const recentDecisions = this.getRecentUniqueDecisions();
    const suggestions = this.generateSuggestions();

    return {
      activeFiles,
      recentDecisions,
      potentialConflicts: [],
      suggestions,
    };
  }

  /**
   * Get ghost insight with conflict check for specific code
   */
  getInsightForCode(code: string, targetFile?: string): GhostInsight {
    const insight = this.getInsight();
    insight.potentialConflicts = this.checkConflicts(code, targetFile);
    return insight;
  }

  /**
   * Clear ghost mode state
   */
  clear(): void {
    this.activeFiles.clear();
    this.recentDecisions.clear();
  }

  /**
   * Get files most recently accessed
   */
  getRecentFiles(limit: number = 10): string[] {
    return Array.from(this.activeFiles.entries())
      .sort((a, b) => b[1].accessedAt.getTime() - a[1].accessedAt.getTime())
      .slice(0, limit)
      .map(([path]) => path);
  }

  /**
   * Get decisions related to recently accessed files
   */
  getRecentUniqueDecisions(limit: number = 10): Decision[] {
    const allDecisions: Decision[] = [];
    for (const decisions of this.recentDecisions.values()) {
      allDecisions.push(...decisions);
    }
    return this.deduplicateDecisions(allDecisions).slice(0, limit);
  }

  // ========== Private Methods ==========

  private async findRelatedDecisions(filePath: string): Promise<Decision[]> {
    try {
      // Search decisions by file path
      const pathParts = filePath.split(/[/\\]/);
      const fileName = pathParts[pathParts.length - 1] || '';
      const dirName = pathParts[pathParts.length - 2] || '';

      // Create a search query from file context
      const searchQuery = `${dirName} ${fileName.replace(/\.[^.]+$/, '')}`;
      const embedding = await this.embeddingGenerator.embed(searchQuery);

      return this.tier2.searchDecisions(embedding, 5);
    } catch {
      return [];
    }
  }

  private findRelatedPatterns(filePath: string): string[] {
    // Extract patterns from file extension and path
    const patterns: string[] = [];

    if (filePath.includes('test') || filePath.includes('spec')) {
      patterns.push('testing');
    }
    if (filePath.includes('api') || filePath.includes('route')) {
      patterns.push('api');
    }
    if (filePath.includes('component') || filePath.includes('ui')) {
      patterns.push('ui');
    }
    if (filePath.includes('model') || filePath.includes('schema')) {
      patterns.push('data-model');
    }
    if (filePath.includes('auth')) {
      patterns.push('authentication');
    }

    return patterns;
  }

  private extractTerms(text: string): Set<string> {
    const terms = new Set<string>();

    // Extract technology/pattern terms
    for (const { pattern, term } of TECH_PATTERNS) {
      if (pattern.test(text)) {
        terms.add(term.toLowerCase());
      }
    }

    // Extract common programming terms
    const words = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
    for (const word of words) {
      if (word.length > 3) {
        terms.add(word);
      }
    }

    return terms;
  }

  private detectConflict(
    code: string,
    codeTerms: Set<string>,
    decision: Decision
  ): ConflictWarning | null {
    const decisionText = `${decision.title} ${decision.description}`.toLowerCase();
    const decisionTerms = this.extractTerms(decisionText);

    // Check for technology conflicts
    const matchedTerms: string[] = [];
    for (const term of codeTerms) {
      if (decisionTerms.has(term)) {
        matchedTerms.push(term);
      }
    }

    if (matchedTerms.length === 0) {
      return null;
    }

    // Check if decision opposes this technology
    const negativePattern = new RegExp(
      `(don't|do not|never|avoid|not)\\s+.{0,30}\\b(${matchedTerms.join('|')})\\b`,
      'i'
    );
    const preferOtherPattern = new RegExp(
      `(instead of|rather than)\\s+.{0,30}\\b(${matchedTerms.join('|')})\\b`,
      'i'
    );
    const isNegative = negativePattern.test(decisionText) || preferOtherPattern.test(decisionText);

    if (!isNegative) {
      // Check if decision uses a different technology in the same category
      for (const { pattern, category, term } of TECH_PATTERNS) {
        if (matchedTerms.some(m => m.toLowerCase() === term.toLowerCase())) {
          continue; // Skip the term we're using
        }

        if (pattern.test(decisionText)) {
          // Decision mentions a different tech in same category
          const codeUsesCategory = matchedTerms.some(m => {
            const match = TECH_PATTERNS.find(p => p.term.toLowerCase() === m.toLowerCase());
            return match && match.category === category;
          });

          if (codeUsesCategory) {
            return {
              decision,
              warning: `This code uses ${matchedTerms.join(', ')} but decision "${decision.title}" suggests using ${term}`,
              severity: 'medium',
              matchedTerms,
            };
          }
        }
      }

      return null;
    }

    // Determine severity
    let severity: 'low' | 'medium' | 'high' = 'low';
    if (decisionText.includes('must') || decisionText.includes('never') || decisionText.includes('always')) {
      severity = 'high';
    } else if (decisionText.includes('should') || decisionText.includes('prefer')) {
      severity = 'medium';
    }

    return {
      decision,
      warning: `This code may conflict with decision: "${decision.title}"`,
      severity,
      matchedTerms,
    };
  }

  private generateSuggestions(): string[] {
    const suggestions: string[] = [];

    // Suggest based on active files
    const recentFiles = this.getRecentFiles(5);
    if (recentFiles.length > 0) {
      const categories = new Set<string>();
      for (const file of recentFiles) {
        const ctx = this.activeFiles.get(file);
        if (ctx) {
          ctx.relatedPatterns.forEach(p => categories.add(p));
        }
      }

      if (categories.size > 0) {
        suggestions.push(`Working on: ${Array.from(categories).join(', ')}`);
      }
    }

    // Suggest based on decisions
    const decisions = this.getRecentUniqueDecisions(3);
    if (decisions.length > 0) {
      suggestions.push(`Relevant decisions: ${decisions.map(d => d.title).join(', ')}`);
    }

    return suggestions;
  }

  private deduplicateDecisions(decisions: Decision[]): Decision[] {
    const seen = new Set<string>();
    return decisions.filter(d => {
      if (seen.has(d.id)) {
        return false;
      }
      seen.add(d.id);
      return true;
    });
  }

  private evictStaleFiles(): void {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [path, context] of this.activeFiles.entries()) {
      if (now - context.accessedAt.getTime() > this.FILE_TTL_MS) {
        toEvict.push(path);
      }
    }

    // Evict stale files
    for (const path of toEvict) {
      this.activeFiles.delete(path);
      this.recentDecisions.delete(path);
    }

    // If still too many, evict oldest
    if (this.activeFiles.size > this.MAX_ACTIVE_FILES) {
      const entries = Array.from(this.activeFiles.entries())
        .sort((a, b) => a[1].accessedAt.getTime() - b[1].accessedAt.getTime());

      const toRemove = entries.slice(0, entries.length - this.MAX_ACTIVE_FILES);
      for (const [path] of toRemove) {
        this.activeFiles.delete(path);
        this.recentDecisions.delete(path);
      }
    }
  }
}
