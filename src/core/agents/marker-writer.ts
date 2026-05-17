/**
 * MarkerAwareWriter — unified file writer with marker-based content management
 * and content-hash deduplication to prevent unnecessary writes.
 *
 * Features:
 * - Preserves manual content outside markers
 * - Content-hash dedup: skips write if auto-content unchanged
 * - Section-priority truncation via token budgets
 * - Tracks write results (new/updated/unchanged/budget-truncated)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { computeContentHash } from './git-operations.js';
import type { MarkerConfig } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface MarkedSection {
  name: string;
  content: string;
  /** Higher priority sections survive truncation. Default: 50 */
  priority: number;
}

export interface WriteOptions {
  markers: MarkerConfig;
  /** Max approximate token count (chars / 4). 0 = unlimited */
  maxTokens: number;
  /** Skip write if content hash matches this value */
  contentHash?: string;
}

export interface WriteResult {
  written: boolean;
  reason: 'new' | 'updated' | 'unchanged' | 'budget-truncated';
  tokenCount: number;
  sectionsDropped: string[];
  manualContentPreserved: boolean;
  contentHash: string;
}

// ============================================================================
// Section Priority Constants
// ============================================================================

export const SECTION_PRIORITIES = {
  SCOPE: 100,
  RULES: 90,
  KEY_FACTS: 85,
  PITFALLS: 80,
  TASKS: 70,
  RESEARCH_REFS: 60,
  LESSONS: 50,
  EXAMPLES: 40,
  STATISTICS: 30,
} as const;

// ============================================================================
// MarkerAwareWriter
// ============================================================================

/**
 * Write a file with marker-delimited auto-content and manual content preservation.
 * Returns detailed write result including hash for idempotency tracking.
 */
export function writeMarkedFile(
  filePath: string,
  frontmatter: string,
  sections: MarkedSection[],
  options: WriteOptions,
): WriteResult {
  const result: WriteResult = {
    written: false,
    reason: 'unchanged',
    tokenCount: 0,
    sectionsDropped: [],
    manualContentPreserved: false,
    contentHash: '',
  };

  // Sort sections by priority (highest first) for truncation
  const sortedSections = [...sections].sort((a, b) => b.priority - a.priority);

  // Build auto-content from sections
  let autoContent = buildAutoContent(sortedSections, options.maxTokens, result);

  // Compute hash of auto-content for dedup
  const newHash = computeContentHash(autoContent);
  result.contentHash = newHash;

  // Check hash-based skip
  if (options.contentHash && options.contentHash === newHash) {
    result.reason = 'unchanged';
    result.tokenCount = estimateTokens(autoContent);
    return result;
  }

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');

    if (existing.includes(options.markers.start)) {
      // Extract existing auto-content hash for comparison
      const existingAutoContent = extractAutoContent(existing, options.markers);
      const existingHash = computeContentHash(existingAutoContent);

      if (existingHash === newHash) {
        result.reason = 'unchanged';
        result.tokenCount = estimateTokens(autoContent);
        return result;
      }

      // Update: replace auto section, preserve manual content
      const updated = replaceAutoSection(existing, autoContent, options.markers);
      result.manualContentPreserved = true;
      result.tokenCount = estimateTokens(updated);
      writeFileSync(filePath, updated);
      result.written = true;
      result.reason = result.sectionsDropped.length > 0 ? 'budget-truncated' : 'updated';
      return result;
    } else {
      // File exists but no markers — user fully owns it, skip
      result.reason = 'unchanged';
      result.manualContentPreserved = true;
      return result;
    }
  }

  // New file: frontmatter + markers + auto-content + manual section
  mkdirSync(dirname(filePath), { recursive: true });
  const fullContent = [
    frontmatter,
    '',
    options.markers.start,
    autoContent.trim(),
    options.markers.end,
    '',
    '## Manual Notes',
    '[Human-authored content preserved across regeneration]',
    '',
  ].join('\n');

  result.tokenCount = estimateTokens(fullContent);
  writeFileSync(filePath, fullContent);
  result.written = true;
  result.reason = result.sectionsDropped.length > 0 ? 'budget-truncated' : 'new';
  return result;
}

// ============================================================================
// Content Building with Budget Enforcement
// ============================================================================

function buildAutoContent(
  sortedSections: MarkedSection[],
  maxTokens: number,
  result: WriteResult,
): string {
  if (maxTokens <= 0) {
    // No budget — include all sections
    return sortedSections.map(s => s.content).join('\n\n');
  }

  const included: string[] = [];
  let totalTokens = 0;

  for (const section of sortedSections) {
    const sectionTokens = estimateTokens(section.content);
    if (totalTokens + sectionTokens <= maxTokens) {
      included.push(section.content);
      totalTokens += sectionTokens;
    } else {
      // Try to include a truncated version
      const remainingTokens = maxTokens - totalTokens;
      if (remainingTokens > 50) {
        // Include partial content
        const maxChars = remainingTokens * 4;
        const truncated = section.content.slice(0, maxChars) + '\n\n[... truncated to fit token budget]';
        included.push(truncated);
        totalTokens += remainingTokens;
      }
      result.sectionsDropped.push(section.name);
    }
  }

  return included.join('\n\n');
}

// ============================================================================
// Marker Content Management
// ============================================================================

function extractAutoContent(content: string, markers: MarkerConfig): string {
  const startIdx = content.indexOf(markers.start);
  const endIdx = content.indexOf(markers.end);
  if (startIdx < 0 || endIdx <= startIdx) return '';
  return content.slice(startIdx + markers.start.length, endIdx).trim();
}

function replaceAutoSection(
  existing: string,
  newAutoContent: string,
  markers: MarkerConfig,
): string {
  const startIdx = existing.indexOf(markers.start);
  const endIdx = existing.indexOf(markers.end);
  if (startIdx < 0 || endIdx <= startIdx) return existing;

  const before = existing.slice(0, startIdx + markers.start.length);
  const after = existing.slice(endIdx);

  return `${before}\n${newAutoContent.trim()}\n${after}`;
}

// ============================================================================
// Utilities
// ============================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
