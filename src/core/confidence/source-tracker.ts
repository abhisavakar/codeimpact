import type { Tier2Storage } from '../../storage/tier2.js';
import type { EmbeddingGenerator } from '../../indexing/embeddings.js';
import type {
  ConfidenceSources,
  CodebaseMatch,
  DecisionMatch,
  PatternMatch
} from '../../types/documentation.js';

// Common code patterns to detect
const CODE_PATTERNS = [
  { name: 'error-handling', regex: /try\s*\{[\s\S]*?\}\s*catch/i },
  { name: 'async-await', regex: /async\s+function|await\s+/i },
  { name: 'null-check', regex: /\?\.|!==?\s*null|===?\s*null/i },
  { name: 'array-methods', regex: /\.(map|filter|reduce|forEach|find)\s*\(/i },
  { name: 'destructuring', regex: /const\s+\{[\s\S]*?\}\s*=|const\s+\[[\s\S]*?\]\s*=/i },
  { name: 'arrow-function', regex: /=>\s*\{|=>\s*[^{]/i },
  { name: 'class-definition', regex: /class\s+\w+(\s+extends\s+\w+)?\s*\{/i },
  { name: 'interface-definition', regex: /interface\s+\w+\s*\{/i },
  { name: 'type-definition', regex: /type\s+\w+\s*=/i },
  { name: 'import-statement', regex: /import\s+.*\s+from\s+['"`]/i },
  { name: 'export-statement', regex: /export\s+(default\s+)?(class|function|const|interface|type)/i },
  { name: 'promise-handling', regex: /\.then\s*\(|\.catch\s*\(|Promise\./i },
  { name: 'validation', regex: /if\s*\(.*\)\s*(throw|return)/i },
  { name: 'logging', regex: /console\.(log|error|warn|info)/i },
  { name: 'event-handling', regex: /\.on\(|addEventListener|emit\(/i }
];

export class SourceTracker {
  private tier2: Tier2Storage;
  private embeddingGenerator: EmbeddingGenerator;

  constructor(tier2: Tier2Storage, embeddingGenerator: EmbeddingGenerator) {
    this.tier2 = tier2;
    this.embeddingGenerator = embeddingGenerator;
  }

  async trackSources(code: string, context?: string): Promise<ConfidenceSources> {
    // Find similar code in codebase
    const codebaseMatches = await this.findSimilarCode(code, context);

    // Find related decisions
    const decisionMatches = await this.findRelatedDecisions(code, context);

    // Find matching patterns
    const patternMatches = this.findMatchingPatterns(code);

    // Determine if general knowledge was used
    const usedGeneralKnowledge = codebaseMatches.length === 0 && decisionMatches.length === 0;

    return {
      codebase: codebaseMatches,
      decisions: decisionMatches,
      patterns: patternMatches,
      usedGeneralKnowledge
    };
  }

  private async findSimilarCode(code: string, context?: string): Promise<CodebaseMatch[]> {
    const matches: CodebaseMatch[] = [];

    try {
      // Generate embedding for the code
      const textToEmbed = context ? `${context}\n${code}` : code;
      const embedding = await this.embeddingGenerator.embed(textToEmbed);

      // Search for similar code
      const results = this.tier2.search(embedding, 10);

      for (const result of results) {
        // Convert similarity to percentage (0-100)
        const similarity = Math.round(result.similarity * 100);

        if (similarity >= 30) { // Only include if at least 30% similar
          const file = this.tier2.getFile(result.path);
          const symbols = file ? this.tier2.getSymbolsByFile(file.id) : [];
          const dependents = this.tier2.getFileDependents(result.path);

          matches.push({
            file: result.path,
            similarity,
            snippet: result.preview,
            lastModified: file ? new Date(file.lastModified * 1000) : undefined,
            usageCount: dependents.length + 1,
            function: symbols.length > 0 ? symbols[0].name : undefined
          });
        }
      }
    } catch (error) {
      console.error('Error finding similar code:', error);
    }

    return matches.slice(0, 5); // Return top 5
  }

  private async findRelatedDecisions(code: string, context?: string): Promise<DecisionMatch[]> {
    const matches: DecisionMatch[] = [];

    try {
      // Generate embedding for decision search
      const textToEmbed = context ? `${context}\n${code}` : code;
      const embedding = await this.embeddingGenerator.embed(textToEmbed);

      // Search decisions
      const decisions = this.tier2.searchDecisions(embedding, 5);

      for (const decision of decisions) {
        // Calculate relevance based on similarity
        const relevance = Math.round(decision.similarity * 100);

        if (relevance >= 40) { // Only include if at least 40% relevant
          matches.push({
            id: decision.id,
            title: decision.title,
            date: decision.createdAt,
            relevance
          });
        }
      }
    } catch (error) {
      console.error('Error finding related decisions:', error);
    }

    return matches;
  }

  private findMatchingPatterns(code: string): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const pattern of CODE_PATTERNS) {
      if (pattern.regex.test(code)) {
        // Calculate confidence based on how common the pattern is
        const confidence = this.calculatePatternConfidence(pattern.name, code);

        matches.push({
          pattern: pattern.name,
          confidence,
          examples: this.findPatternExamples(pattern.name)
        });
      }
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches.slice(0, 5); // Return top 5
  }

  private calculatePatternConfidence(patternName: string, code: string): number {
    // Base confidence for detecting a pattern
    let confidence = 60;

    // Boost for common patterns
    const commonPatterns = ['error-handling', 'async-await', 'null-check', 'validation'];
    if (commonPatterns.includes(patternName)) {
      confidence += 15;
    }

    // Check if pattern is used correctly (basic heuristics)
    switch (patternName) {
      case 'error-handling':
        if (/catch\s*\(\s*\w+\s*\)\s*\{[\s\S]*\}/.test(code)) confidence += 10;
        break;
      case 'async-await':
        if (/await\s+[^;]+;/.test(code) && /async\s+/.test(code)) confidence += 10;
        break;
      case 'null-check':
        if (/\?\.\w+/.test(code) || /!==?\s*null/.test(code)) confidence += 10;
        break;
    }

    return Math.min(95, confidence);
  }

  private findPatternExamples(patternName: string): string[] {
    // Get files that use this pattern
    const examples: string[] = [];
    const files = this.tier2.getAllFiles();

    for (const file of files.slice(0, 50)) { // Check first 50 files
      const preview = file.preview || '';
      const pattern = CODE_PATTERNS.find(p => p.name === patternName);

      if (pattern && pattern.regex.test(preview)) {
        examples.push(file.path);
        if (examples.length >= 3) break;
      }
    }

    return examples;
  }

  // Get detailed source tracking for display
  async getDetailedTracking(code: string, context?: string): Promise<{
    codebaseWeight: number;
    decisionWeight: number;
    patternWeight: number;
    sources: ConfidenceSources;
    formatted: string;
  }> {
    const sources = await this.trackSources(code, context);

    // Calculate weights based on what was found
    let codebaseWeight = 0.5;
    let decisionWeight = 0.3;
    let patternWeight = 0.2;

    // Adjust weights if sources are missing
    if (sources.codebase.length === 0) {
      codebaseWeight = 0;
      decisionWeight += 0.25;
      patternWeight += 0.25;
    }

    if (sources.decisions.length === 0) {
      decisionWeight = 0;
      codebaseWeight += 0.15;
      patternWeight += 0.15;
    }

    // Format for display
    const lines: string[] = [];
    lines.push('\u{1F4CA} Suggestion Sources\n');

    if (sources.codebase.length > 0) {
      lines.push(`Codebase (${Math.round(codebaseWeight * 100)}% weight):`);
      for (const match of sources.codebase) {
        lines.push(`\u251C\u2500\u2500 ${match.file}${match.line ? `:${match.line}` : ''} (${match.similarity}% similar)`);
      }
      lines.push('');
    }

    if (sources.decisions.length > 0) {
      lines.push(`Decisions (${Math.round(decisionWeight * 100)}% weight):`);
      for (const decision of sources.decisions) {
        lines.push(`\u2514\u2500\u2500 "${decision.title}" (${decision.relevance}% relevant)`);
      }
      lines.push('');
    }

    if (sources.patterns.length > 0) {
      lines.push(`Patterns (${Math.round(patternWeight * 100)}% weight):`);
      for (const pattern of sources.patterns) {
        lines.push(`\u2514\u2500\u2500 ${pattern.pattern} (${pattern.confidence}% confidence)`);
      }
      lines.push('');
    }

    if (sources.usedGeneralKnowledge) {
      lines.push('General Knowledge: Used (no codebase matches found)');
    } else {
      lines.push('General Knowledge: Not used');
    }

    return {
      codebaseWeight,
      decisionWeight,
      patternWeight,
      sources,
      formatted: lines.join('\n')
    };
  }
}
