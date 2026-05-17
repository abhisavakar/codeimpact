import { dirname, relative, basename } from 'path';
import { Tier1Storage } from '../storage/tier1.js';
import { Tier2Storage } from '../storage/tier2.js';
import { Tier3Storage } from '../storage/tier3.js';
import { EmbeddingGenerator } from '../indexing/embeddings.js';
import { TokenBudget, estimateTokens } from '../utils/tokens.js';
import type { FeatureContextManager } from './feature-context.js';
import type { AssembledContext, AssemblyOptions, SearchResult, Decision, ContextParts, HotContext } from '../types/index.js';

export class ContextAssembler {
  private tier1: Tier1Storage;
  private tier2: Tier2Storage;
  private tier3: Tier3Storage;
  private embeddingGenerator: EmbeddingGenerator;
  private featureContextManager: FeatureContextManager | null = null;

  constructor(
    tier1: Tier1Storage,
    tier2: Tier2Storage,
    tier3: Tier3Storage,
    embeddingGenerator: EmbeddingGenerator
  ) {
    this.tier1 = tier1;
    this.tier2 = tier2;
    this.tier3 = tier3;
    this.embeddingGenerator = embeddingGenerator;
  }

  // Set feature context manager (injected after construction to avoid circular deps)
  setFeatureContextManager(manager: FeatureContextManager): void {
    this.featureContextManager = manager;
  }

  async assemble(query: string, options: AssemblyOptions = {}): Promise<AssembledContext> {
    const budget = new TokenBudget(options.maxTokens || 6000);
    const queryEmbedding = await this.embeddingGenerator.embed(query);

    // Step 0: HOT CONTEXT (HIGHEST PRIORITY) - Active Feature Context
    let hotContext: HotContext | null = null;
    if (this.featureContextManager) {
      hotContext = this.featureContextManager.getHotContext();
      if (hotContext.files.length > 0 || hotContext.changes.length > 0) {
        const hotText = this.formatHotContext(hotContext);
        if (budget.canFit(hotText)) {
          budget.allocate(hotText, 'hot-context');
        }
      }
    }

    // Step 1: Load and format Tier 1 (working context)
    const working = this.tier1.getContext();
    const workingText = this.formatTier1(working);

    if (workingText && budget.canFit(workingText)) {
      budget.allocate(workingText, 'tier1');
    }

    // Step 2: Semantic search in Tier 2
    const searchResults = this.tier2.search(queryEmbedding, 20);
    const rankedResults = this.rankResults(searchResults, options.currentFile);

    const tier2Content: SearchResult[] = [];
    for (const result of rankedResults) {
      const formatted = this.formatSearchResult(result);
      if (budget.canFit(formatted)) {
        budget.allocate(formatted, 'tier2');
        tier2Content.push(result);
      } else {
        break;
      }
    }

    // Step 3: Query Tier 3 if budget remains
    const tier3Content: string[] = [];
    if (budget.remaining() > 200) {
      const archives = this.tier3.searchRelevant(query, 3);
      for (const archive of archives) {
        if (archive.summary && budget.canFit(archive.summary)) {
          budget.allocate(archive.summary, 'tier3');
          tier3Content.push(archive.summary);
        }
      }
    }

    // Step 4: Get relevant decisions
    let decisions: Decision[] = [];
    try {
      decisions = this.tier2.searchDecisions(queryEmbedding, 5);
    } catch {
      decisions = this.tier2.getRecentDecisions(5);
    }

    const decisionsText = this.formatDecisions(decisions);
    if (decisionsText && budget.canFit(decisionsText)) {
      budget.allocate(decisionsText, 'decisions');
    }

    // Step 5: Assemble final context
    const context = this.formatFinalContext({
      working: { activeFile: working.activeFile },
      relevant: tier2Content,
      archive: tier3Content,
      decisions
    }, hotContext);

    return {
      context,
      sources: tier2Content.map(r => r.file),
      tokenCount: budget.used(),
      decisions
    };
  }

  private formatHotContext(hot: HotContext): string {
    let output = `## Active Feature Context\n\n`;

    if (hot.summary) {
      output += `**${hot.summary}**\n\n`;
    }

    if (hot.files.length > 0) {
      output += `### Files You're Working On\n`;
      for (const f of hot.files.slice(0, 8)) {
        output += `- \`${f.path}\` (touched ${f.touchCount}x)\n`;
      }
      output += `\n`;
    }

    if (hot.changes.length > 0) {
      output += `### Recent Changes\n`;
      for (const c of hot.changes.slice(0, 5)) {
        const fileName = basename(c.file);
        output += `- \`${fileName}\`: ${c.diff}\n`;
      }
      output += `\n`;
    }

    if (hot.queries.length > 0) {
      output += `### Recent Questions\n`;
      for (const q of hot.queries.slice(0, 3)) {
        output += `- "${q.query}"\n`;
      }
      output += `\n`;
    }

    return output;
  }

  private formatTier1(context: { activeFile: { path: string; content: string; language: string } | null }): string {
    if (!context.activeFile) {
      return '';
    }

    return `### Currently Active File
File: ${context.activeFile.path}
\`\`\`${context.activeFile.language}
${context.activeFile.content}
\`\`\`
`;
  }

  private formatSearchResult(result: SearchResult): string {
    const score = result.score !== undefined ? result.score : result.similarity;
    return `#### ${result.file} (relevance: ${(score * 100).toFixed(0)}%)
\`\`\`
${result.preview}
\`\`\`
`;
  }

  private formatDecisions(decisions: Decision[]): string {
    if (decisions.length === 0) {
      return '';
    }

    return decisions.map(d => {
      const date = d.createdAt.toLocaleDateString();
      return `- **${d.title}** (${date})
  ${d.description}`;
    }).join('\n\n');
  }

  private rankResults(results: SearchResult[], currentFile?: string): SearchResult[] {
    const filesViewed = this.tier1.getFilesViewed();

    return results
      .map(r => {
        let score = r.similarity;

        // Boost: Same directory as current file
        if (currentFile && dirname(r.file) === dirname(currentFile)) {
          score *= 1.5;
        }

        // Boost: Recently modified (within 24 hours)
        // lastModified is stored as seconds since epoch
        const hoursSinceModified = (Date.now() - r.lastModified * 1000) / 3600000;
        if (hoursSinceModified < 24) {
          score *= 1 + (0.3 * (24 - hoursSinceModified) / 24);
        }

        // Boost: Recently viewed in session
        if (filesViewed.includes(r.file)) {
          score *= 1.3;
        }

        return { ...r, score };
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  private formatFinalContext(parts: ContextParts, hotContext?: HotContext | null): string {
    const sections: string[] = [];

    // Hot context first (highest priority)
    if (hotContext && (hotContext.files.length > 0 || hotContext.changes.length > 0)) {
      sections.push(this.formatHotContext(hotContext));
    }

    sections.push('## Codebase Context\n');

    // Working file
    if (parts.working.activeFile) {
      sections.push(`### Working File
File: ${parts.working.activeFile.path}
\`\`\`${parts.working.activeFile.language}
${parts.working.activeFile.content}
\`\`\`
`);
    }

    // Relevant code
    if (parts.relevant.length > 0) {
      sections.push('### Relevant Code\n');
      for (const r of parts.relevant) {
        const score = r.score !== undefined ? r.score : r.similarity;
        sections.push(`#### ${r.file} (relevance: ${(score * 100).toFixed(0)}%)
\`\`\`
${r.preview}
\`\`\`
`);
      }
    }

    // Decisions
    if (parts.decisions.length > 0) {
      sections.push('### Architecture Decisions\n');
      for (const d of parts.decisions) {
        const date = d.createdAt.toLocaleDateString();
        sections.push(`- **${d.title}** (${date})
  ${d.description}
`);
      }
    }

    // Archive
    if (parts.archive.length > 0) {
      sections.push('### Historical Context\n');
      sections.push(parts.archive.join('\n\n'));
    }

    return sections.join('\n').trim();
  }
}
