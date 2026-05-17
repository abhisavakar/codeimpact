/**
 * Research Engine — Fetches, distills, and caches documentation for detected technologies.
 * Produces research/{tech}@{version}.md files with frontmatter and source citations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { DetectedTechnology, ResearchFile, DocSource } from './types.js';
import { getAgentWorkspacePaths } from './workspace.js';
import { assessTrust, renderTrustFrontmatter } from './research-trust.js';
import { inferDocSource } from './universal-inference.js';
import { estimateTokens } from '../../utils/token-counter.js';

// ============================================================================
// Public API
// ============================================================================

export interface ResearchOptions {
  maxTokensPerTech: number;
  cadenceHours: number;
  force?: boolean;
  fetchFn?: (url: string) => Promise<string>;
}

export interface ResearchResult {
  technology: string;
  version: string;
  file: string;
  status: 'created' | 'updated' | 'cached' | 'failed';
  tokenCount?: number;
  error?: string;
}

export async function researchTechnology(
  projectPath: string,
  tech: DetectedTechnology,
  options: ResearchOptions,
): Promise<ResearchResult> {
  const paths = getAgentWorkspacePaths(projectPath);
  // Sanitize scoped package names: @esbuild/aix-ppc64 → esbuild__aix-ppc64
  const safeName = tech.name.replace(/^@/, '').replace(/\//g, '__');
  const fileName = `${safeName}@${tech.version}.md`;
  const filePath = join(paths.researchDir, fileName);
  const relPath = `research/${fileName}`;

  // Check cache freshness
  if (!options.force && existsSync(filePath)) {
    const existing = readResearchFile(filePath);
    if (existing && !isStale(existing, options.cadenceHours)) {
      return { technology: tech.name, version: tech.version, file: relPath, status: 'cached' };
    }
  }

  // Find documentation source (universal — works for any ecosystem)
  const docSource = inferDocSource(tech.name, tech.source);
  if (!docSource) {
    // Generate a minimal stub
    const stub = generateStubResearch(tech);
    mkdirSync(paths.researchDir, { recursive: true });
    writeFileSync(filePath, stub);
    return { technology: tech.name, version: tech.version, file: relPath, status: 'created', tokenCount: estimateTokens(stub) };
  }

  // Fetch and distill
  try {
    const fetchFn = options.fetchFn || defaultFetch;
    const content = await fetchAndDistill(tech, docSource, fetchFn, options.maxTokensPerTech);

    const isNew = !existsSync(filePath);
    mkdirSync(paths.researchDir, { recursive: true });
    writeFileSync(filePath, content);

    const tokenCount = estimateTokens(content);
    return {
      technology: tech.name,
      version: tech.version,
      file: relPath,
      status: isNew ? 'created' : 'updated',
      tokenCount,
    };
  } catch (err) {
    // On failure, keep existing or write stub
    if (!existsSync(filePath)) {
      const stub = generateStubResearch(tech);
      mkdirSync(paths.researchDir, { recursive: true });
      writeFileSync(filePath, stub);
    }
    return {
      technology: tech.name,
      version: tech.version,
      file: relPath,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function researchAllTechnologies(
  projectPath: string,
  technologies: DetectedTechnology[],
  options: ResearchOptions,
): Promise<ResearchResult[]> {
  const results: ResearchResult[] = [];

  // Process sequentially to respect rate limits
  for (const tech of technologies) {
    const result = await researchTechnology(projectPath, tech, options);
    results.push(result);
  }

  return results;
}

// DOC_SOURCE_REGISTRY and findDocSource — replaced by inferDocSource from universal-inference.ts

// ============================================================================
// Fetch & Distill
// ============================================================================

async function fetchAndDistill(
  tech: DetectedTechnology,
  docSource: DocSource,
  fetchFn: (url: string) => Promise<string>,
  maxTokens: number,
): Promise<string> {
  const urls = [docSource.docsUrl];
  if (docSource.apiRefUrl && docSource.apiRefUrl !== docSource.docsUrl) {
    urls.push(docSource.apiRefUrl);
  }
  if (docSource.changelogUrl) {
    urls.push(docSource.changelogUrl);
  }

  // Fetch up to 5 pages (rate limit)
  const fetchedContent: Array<{ url: string; content: string }> = [];
  for (const url of urls.slice(0, 5)) {
    try {
      const content = await fetchFn(url);
      if (content) {
        fetchedContent.push({ url, content: content.slice(0, 50000) }); // Cap per page
      }
    } catch {
      // Skip failed fetches
    }
  }

  // If no content fetched, generate stub
  if (fetchedContent.length === 0) {
    return generateStubResearch(tech);
  }

  // Distill content
  return distillResearch(tech, docSource, fetchedContent, maxTokens);
}

function distillResearch(
  tech: DetectedTechnology,
  docSource: DocSource,
  fetchedContent: Array<{ url: string; content: string }>,
  maxTokens: number,
): string {
  const now = new Date().toISOString();
  const nextRefresh = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Extract key sections from fetched content
  let apiPatterns = '';
  let breakingChanges = '';
  let pitfalls = '';
  const sourceUrls: string[] = fetchedContent.map(fc => fc.url);

  for (const { content } of fetchedContent) {
    // Extract API patterns (look for code blocks and key methods)
    const codeBlocks = extractCodeBlocks(content);
    if (codeBlocks.length > 0) {
      apiPatterns += codeBlocks.slice(0, 5).join('\n\n') + '\n\n';
    }

    // Extract breaking changes / migration info
    const breakingSection = extractSection(content, ['breaking', 'migration', 'upgrade', 'deprecated']);
    if (breakingSection) {
      breakingChanges += breakingSection + '\n\n';
    }

    // Extract common pitfalls / gotchas
    const pitfallSection = extractSection(content, ['pitfall', 'gotcha', 'common mistake', 'note:', 'warning:']);
    if (pitfallSection) {
      pitfalls += pitfallSection + '\n\n';
    }
  }

  // Build content body first for trust assessment
  const bodyParts: string[] = [];
  if (breakingChanges.trim()) bodyParts.push('## Breaking Changes / Migration Notes\n' + breakingChanges.trim());
  if (apiPatterns.trim()) bodyParts.push('## Key API Patterns\n' + apiPatterns.trim());
  if (pitfalls.trim()) bodyParts.push('## Common Pitfalls\n' + pitfalls.trim());
  const bodyForTrust = bodyParts.join('\n\n');

  // Assess trust
  const trustAssessment = assessTrust(bodyForTrust, sourceUrls);
  const trustLines = renderTrustFrontmatter(trustAssessment);

  // Build frontmatter
  const lines: string[] = [
    '---',
    `technology: ${tech.name}`,
    `version: ${tech.version}`,
    'source_urls:',
    ...sourceUrls.map(u => `  - ${u}`),
    `installed_from: ${tech.source}`,
    `last_fetched: ${now}`,
    `next_refresh: ${nextRefresh}`,
    `token_count: 0`,
    ...trustLines,
    '---',
    '',
    `# ${tech.name} v${tech.version} — Distilled Reference`,
    '',
  ];

  if (breakingChanges.trim()) {
    lines.push('## Breaking Changes / Migration Notes');
    lines.push(truncateToTokenBudget(breakingChanges.trim(), Math.floor(maxTokens * 0.3)));
    lines.push('');
  }

  if (apiPatterns.trim()) {
    lines.push('## Key API Patterns');
    lines.push(truncateToTokenBudget(apiPatterns.trim(), Math.floor(maxTokens * 0.4)));
    lines.push('');
  }

  if (pitfalls.trim()) {
    lines.push('## Common Pitfalls');
    lines.push(truncateToTokenBudget(pitfalls.trim(), Math.floor(maxTokens * 0.2)));
    lines.push('');
  }

  lines.push('## Source Citations');
  for (const url of sourceUrls) {
    lines.push(`- ${url}`);
  }
  lines.push('');

  const result = lines.join('\n');

  // Update token count in frontmatter
  const tokenCount = estimateTokens(result);
  return result.replace('token_count: 0', `token_count: ${tokenCount}`);
}

// ============================================================================
// Content Extraction Helpers
// ============================================================================

function extractCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\w]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const block = match[1] || '';
    if (block.trim().length > 20 && block.trim().length < 500) {
      blocks.push('```\n' + block.trim() + '\n```');
    }
  }
  return blocks;
}

function extractSection(content: string, keywords: string[]): string | null {
  const lines = content.split('\n');
  const sections: string[] = [];
  let capturing = false;
  let captured: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some(kw => lower.includes(kw))) {
      if (capturing && captured.length > 0) {
        sections.push(captured.join('\n'));
        captured = [];
      }
      capturing = true;
      captured.push(line);
    } else if (capturing) {
      if (line.match(/^#{1,3}\s/) && captured.length > 2) {
        sections.push(captured.join('\n'));
        captured = [];
        capturing = false;
      } else {
        captured.push(line);
        if (captured.length > 20) {
          sections.push(captured.join('\n'));
          captured = [];
          capturing = false;
        }
      }
    }
  }

  if (captured.length > 0) {
    sections.push(captured.join('\n'));
  }

  return sections.length > 0 ? sections.slice(0, 3).join('\n\n') : null;
}

// ============================================================================
// Stub Generation
// ============================================================================

function generateStubResearch(tech: DetectedTechnology): string {
  const now = new Date().toISOString();
  const nextRefresh = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return [
    '---',
    `technology: ${tech.name}`,
    `version: ${tech.version}`,
    'source_urls: []',
    `installed_from: ${tech.source}`,
    `last_fetched: ${now}`,
    `next_refresh: ${nextRefresh}`,
    'token_count: 100',
    '---',
    '',
    `# ${tech.name} v${tech.version} — Distilled Reference`,
    '',
    '## Status',
    `No documentation fetched yet. Research pending.`,
    '',
    '## Key Facts',
    `- Package: ${tech.name}`,
    `- Version: ${tech.version}`,
    `- Source: ${tech.source}`,
    '',
  ].join('\n');
}

// ============================================================================
// Reading Existing Research
// ============================================================================

function readResearchFile(filePath: string): ResearchFile | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const fm = frontmatterMatch[1] || '';
    const getValue = (key: string): string => {
      const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return match && match[1] ? match[1].trim() : '';
    };

    return {
      technology: getValue('technology'),
      version: getValue('version'),
      sourceUrls: [],
      installedFrom: getValue('installed_from'),
      lastFetched: getValue('last_fetched'),
      nextRefresh: getValue('next_refresh'),
      tokenCount: parseInt(getValue('token_count')) || 0,
      content,
    };
  } catch {
    return null;
  }
}

export function getResearchContent(projectPath: string, technology: string, version?: string): string | null {
  const paths = getAgentWorkspacePaths(projectPath);

  // Try exact match first
  if (version) {
    const exactPath = join(paths.researchDir, `${technology}@${version}.md`);
    if (existsSync(exactPath)) {
      return readFileSync(exactPath, 'utf-8');
    }
  }

  // Try to find any version
  if (existsSync(paths.researchDir)) {
    const files = readdirSync(paths.researchDir) as string[];
    const match = files.find((f: string) => f.startsWith(`${technology}@`));
    if (match) {
      return readFileSync(join(paths.researchDir, match), 'utf-8');
    }
  }

  return null;
}

// ============================================================================
// Utilities
// ============================================================================

function isStale(research: ResearchFile, cadenceHours: number): boolean {
  if (!research.lastFetched) return true;
  const fetchedAt = new Date(research.lastFetched).getTime();
  const staleAfter = fetchedAt + cadenceHours * 60 * 60 * 1000;
  return Date.now() > staleAfter;
}


function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated to fit token budget]';
}

async function defaultFetch(url: string): Promise<string> {
  // Use Node.js native fetch (available in Node 18+)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CodeImpact/1.0 (documentation-research)',
        'Accept': 'text/html,text/markdown,text/plain',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return '';
    const html = await response.text();
    return htmlToMarkdown(html);
  } catch {
    return '';
  }
}

function htmlToMarkdown(html: string): string {
  // Basic HTML to markdown conversion (no external deps)
  let text = html;

  // Remove script/style
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');

  // Convert headings
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n');

  // Convert code blocks
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n');
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // Convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert lists
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Convert paragraphs
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}
