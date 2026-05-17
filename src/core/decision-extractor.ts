import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import type { Decision } from '../types/index.js';
import { randomUUID } from 'crypto';

interface ExtractedDecision {
  title: string;
  description: string;
  source: 'git' | 'comment' | 'adr';
  file?: string;
  line?: number;
  tags: string[];
}

// Patterns for detecting decisions in commit messages
const COMMIT_PATTERNS = [
  // Conventional commits with architectural significance
  /^(?:feat|refactor|perf|build|ci)\(([^)]+)\):\s*(.+)/i,
  // Explicit decision markers
  /^(?:DECISION|ARCHITECTURE|ADR):\s*(.+)/i,
  // "Use X instead of Y" pattern
  /use\s+(\w+)\s+(?:instead of|over|rather than)\s+(\w+)/i,
  // "Switch to X" pattern
  /switch(?:ed|ing)?\s+to\s+(\w+)/i,
  // "Implement X pattern"
  /implement(?:ed|ing)?\s+(\w+)\s+pattern/i,
];

// Patterns for detecting decisions in code comments
const COMMENT_PATTERNS = [
  // Explicit decision markers
  { pattern: /(?:\/\/|#|\/\*)\s*DECISION:\s*(.+?)(?:\*\/)?$/gm, tag: 'decision' },
  { pattern: /(?:\/\/|#|\/\*)\s*ARCHITECTURE:\s*(.+?)(?:\*\/)?$/gm, tag: 'architecture' },
  { pattern: /(?:\/\/|#|\/\*)\s*ADR:\s*(.+?)(?:\*\/)?$/gm, tag: 'adr' },
  { pattern: /(?:\/\/|#|\/\*)\s*WHY:\s*(.+?)(?:\*\/)?$/gm, tag: 'rationale' },
  { pattern: /(?:\/\/|#|\/\*)\s*NOTE:\s*(.+?)(?:\*\/)?$/gm, tag: 'note' },
  { pattern: /(?:\/\/|#|\/\*)\s*IMPORTANT:\s*(.+?)(?:\*\/)?$/gm, tag: 'important' },
];

// Tags to assign based on content
const TAG_KEYWORDS: Record<string, string[]> = {
  database: ['database', 'db', 'sql', 'postgres', 'mysql', 'mongo', 'redis', 'sqlite', 'orm', 'prisma'],
  authentication: ['auth', 'login', 'jwt', 'oauth', 'session', 'password', 'token'],
  api: ['api', 'rest', 'graphql', 'endpoint', 'route', 'http'],
  performance: ['performance', 'cache', 'optimize', 'speed', 'fast', 'slow', 'memory'],
  security: ['security', 'encrypt', 'hash', 'ssl', 'https', 'csrf', 'xss', 'injection'],
  testing: ['test', 'jest', 'vitest', 'mocha', 'cypress', 'e2e', 'unit'],
  infrastructure: ['docker', 'kubernetes', 'aws', 'gcp', 'azure', 'deploy', 'ci', 'cd'],
  frontend: ['react', 'vue', 'angular', 'svelte', 'css', 'ui', 'component'],
  backend: ['server', 'node', 'express', 'fastify', 'middleware'],
};

export class DecisionExtractor {
  private projectPath: string;
  private isGitRepo: boolean;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.isGitRepo = existsSync(join(projectPath, '.git'));
  }

  async extractAll(): Promise<ExtractedDecision[]> {
    const decisions: ExtractedDecision[] = [];

    // Extract from git commits
    if (this.isGitRepo) {
      try {
        const gitDecisions = await this.extractFromGitCommits();
        decisions.push(...gitDecisions);
      } catch (error) {
        console.error('Error extracting from git:', error);
      }
    }

    // Extract from code comments
    try {
      const commentDecisions = await this.extractFromComments();
      decisions.push(...commentDecisions);
    } catch (error) {
      console.error('Error extracting from comments:', error);
    }

    // Extract from ADR files
    try {
      const adrDecisions = await this.extractFromADRFiles();
      decisions.push(...adrDecisions);
    } catch (error) {
      console.error('Error extracting from ADR files:', error);
    }

    return decisions;
  }

  private async extractFromGitCommits(): Promise<ExtractedDecision[]> {
    const decisions: ExtractedDecision[] = [];

    try {
      // Get recent commits with architectural significance
      const output = execSync(
        'git log --oneline -100 --format="%H|%s|%b"',
        { cwd: this.projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      );

      const commits = output.split('\n').filter(Boolean);

      for (const commit of commits) {
        const [hash, subject, ...bodyParts] = commit.split('|');
        const body = bodyParts.join('|');
        const fullMessage = `${subject}\n${body}`.trim();

        // Check for decision patterns
        for (const pattern of COMMIT_PATTERNS) {
          const match = fullMessage.match(pattern);
          if (match) {
            const title = this.extractTitle(subject || '');
            const description = body || subject || '';

            if (title && this.isArchitecturallySignificant(fullMessage)) {
              decisions.push({
                title,
                description: description.slice(0, 500),
                source: 'git',
                tags: this.extractTags(fullMessage)
              });
              break;
            }
          }
        }
      }
    } catch (error) {
      // Git command failed, probably not a git repo or no commits
    }

    return decisions.slice(0, 20); // Limit to 20 most recent
  }

  private async extractFromComments(): Promise<ExtractedDecision[]> {
    const decisions: ExtractedDecision[] = [];

    // Find all code files
    const patterns = ['**/*.ts', '**/*.js', '**/*.py', '**/*.go', '**/*.java', '**/*.rs'];
    const ignorePatterns = [
      '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
      '**/venv/**', '**/.venv/**', '**/env/**', '**/__pycache__/**',
      '**/vendor/**', '**/knowledge/**',
    ];

    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, {
          cwd: this.projectPath,
          ignore: ignorePatterns,
          absolute: true,
          nodir: true
        });

        for (const file of files.slice(0, 100)) { // Limit files to scan
          try {
            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i] || '';

              for (const { pattern, tag } of COMMENT_PATTERNS) {
                pattern.lastIndex = 0; // Reset regex state
                const match = pattern.exec(line);
                if (match && match[1]) {
                  const relativePath = file.replace(this.projectPath, '').replace(/^[/\\]/, '');

                  decisions.push({
                    title: this.extractTitle(match[1]),
                    description: match[1],
                    source: 'comment',
                    file: relativePath,
                    line: i + 1,
                    tags: [tag, ...this.extractTags(match[1])]
                  });
                }
              }
            }
          } catch {
            // Skip files that can't be read
          }
        }
      } catch {
        // Glob failed
      }
    }

    return decisions;
  }

  private async extractFromADRFiles(): Promise<ExtractedDecision[]> {
    const decisions: ExtractedDecision[] = [];

    // Look for ADR files in common locations
    const adrPatterns = [
      '**/docs/decisions/*.md',
      '**/docs/adr/*.md',
      '**/adr/*.md',
      '**/decisions/*.md'
    ];

    for (const pattern of adrPatterns) {
      try {
        const files = await glob(pattern, {
          cwd: this.projectPath,
          ignore: ['**/node_modules/**', '**/venv/**', '**/.venv/**', '**/env/**', '**/knowledge/**'],
          absolute: true,
          nodir: true
        });

        for (const file of files) {
          try {
            const content = readFileSync(file, 'utf-8');
            const title = this.extractADRTitle(content);
            const status = this.extractADRStatus(content);

            if (title && status !== 'superseded' && status !== 'deprecated') {
              const relativePath = file.replace(this.projectPath, '').replace(/^[/\\]/, '');

              decisions.push({
                title,
                description: this.extractADRDescription(content),
                source: 'adr',
                file: relativePath,
                tags: ['adr', ...this.extractTags(content)]
              });
            }
          } catch {
            // Skip files that can't be read
          }
        }
      } catch {
        // Glob failed
      }
    }

    return decisions;
  }

  private extractTitle(text: string): string {
    // Clean up the text to make a good title
    let title = text
      .replace(/^(?:feat|fix|refactor|perf|build|ci|docs|style|test|chore)\([^)]*\):\s*/i, '')
      .replace(/^(?:DECISION|ARCHITECTURE|ADR|WHY|NOTE|IMPORTANT):\s*/i, '')
      .trim();

    // Capitalize first letter
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    // Truncate if too long
    if (title.length > 100) {
      title = title.slice(0, 97) + '...';
    }

    return title;
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lowerText = text.toLowerCase();

    for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          tags.push(tag);
          break;
        }
      }
    }

    return [...new Set(tags)]; // Deduplicate
  }

  private isArchitecturallySignificant(text: string): boolean {
    const significantKeywords = [
      'architecture', 'design', 'pattern', 'implement', 'refactor',
      'migrate', 'switch', 'replace', 'instead', 'because', 'why',
      'decision', 'chose', 'choose', 'use', 'adopt', 'introduce'
    ];

    const lowerText = text.toLowerCase();
    return significantKeywords.some(keyword => lowerText.includes(keyword));
  }

  private extractADRTitle(content: string): string {
    // Look for # Title or title: in YAML frontmatter
    const titleMatch = content.match(/^#\s+(.+)$/m) ||
      content.match(/^title:\s*["']?([^"'\n]+)["']?$/m);

    return titleMatch ? titleMatch[1]!.trim() : '';
  }

  private extractADRStatus(content: string): string {
    const statusMatch = content.match(/^(?:##\s*)?status:\s*["']?(\w+)["']?$/im);
    return statusMatch ? statusMatch[1]!.toLowerCase() : 'accepted';
  }

  private extractADRDescription(content: string): string {
    // Try to find context or decision section
    const contextMatch = content.match(/##\s*Context\s*\n([\s\S]*?)(?=##|$)/i);
    const decisionMatch = content.match(/##\s*Decision\s*\n([\s\S]*?)(?=##|$)/i);

    let description = '';
    if (contextMatch) {
      description += contextMatch[1]!.trim();
    }
    if (decisionMatch) {
      description += (description ? '\n\n' : '') + decisionMatch[1]!.trim();
    }

    if (!description) {
      // Fallback: use first paragraph after title
      const lines = content.split('\n');
      const startIndex = lines.findIndex(l => l.startsWith('#'));
      if (startIndex >= 0) {
        const remaining = lines.slice(startIndex + 1).join('\n').trim();
        const firstPara = remaining.split(/\n\n/)[0];
        description = firstPara || '';
      }
    }

    return description.slice(0, 1000);
  }

  // Convert extracted decisions to proper Decision objects
  toDecisions(extracted: ExtractedDecision[]): Decision[] {
    return extracted.map(e => ({
      id: randomUUID(),
      title: e.title,
      description: `${e.description}\n\n[Source: ${e.source}${e.file ? `, ${e.file}` : ''}${e.line ? `:${e.line}` : ''}]`,
      files: e.file ? [e.file] : [],
      tags: e.tags,
      createdAt: new Date()
    }));
  }
}
