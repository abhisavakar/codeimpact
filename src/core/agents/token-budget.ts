/**
 * Token Budget Enforcement — deterministic section-priority truncation.
 * Ensures generated files stay within configured token limits.
 */

// ============================================================================
// Budget Configuration
// ============================================================================

export interface BudgetConfig {
  project_skill: number;
  project_conventions: number;
  project_architecture: number;
  project_agent: number;
  feature_skill: number;
  feature_agent: number;
  research: number;
}

export const DEFAULT_BUDGETS: BudgetConfig = {
  project_skill: 3000,
  project_conventions: 2000,
  project_architecture: 2500,
  project_agent: 1500,
  feature_skill: 2000,
  feature_agent: 1000,
  research: 4000,
};

// ============================================================================
// Section Priority (higher = kept when budget exceeded)
// ============================================================================

export const SECTION_PRIORITY: Record<string, number> = {
  'Scope': 100,
  'Rules': 90,
  'Key Facts': 85,
  'Pitfalls': 80,
  'Tasks': 70,
  'Research References': 60,
  'Lessons Learned': 50,
  'Examples': 40,
  'Statistics': 30,
  'Manual Notes': 20,
};

export function getSectionPriority(sectionName: string): number {
  // Try exact match first, then partial match
  if (SECTION_PRIORITY[sectionName] !== undefined) {
    return SECTION_PRIORITY[sectionName];
  }
  for (const [key, val] of Object.entries(SECTION_PRIORITY)) {
    if (sectionName.toLowerCase().includes(key.toLowerCase())) {
      return val;
    }
  }
  return 50; // default priority
}

// ============================================================================
// Token Estimation
// ============================================================================

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Budget Enforcement
// ============================================================================

export interface TruncationResult {
  content: string;
  originalTokens: number;
  finalTokens: number;
  sectionsDropped: string[];
  truncated: boolean;
}

/**
 * Enforce token budget on content with section-priority truncation.
 * Parses markdown sections, sorts by priority, and removes lowest-priority
 * sections until within budget.
 */
export function enforceTokenBudget(content: string, maxTokens: number): TruncationResult {
  const originalTokens = estimateTokens(content);

  if (maxTokens <= 0 || originalTokens <= maxTokens) {
    return {
      content,
      originalTokens,
      finalTokens: originalTokens,
      sectionsDropped: [],
      truncated: false,
    };
  }

  // Parse into sections
  const sections = parseMarkdownSections(content);

  // Sort by priority (highest first)
  sections.sort((a, b) => b.priority - a.priority);

  // Accumulate until budget exceeded
  const included: typeof sections = [];
  const dropped: string[] = [];
  let totalTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);
    if (totalTokens + sectionTokens <= maxTokens) {
      included.push(section);
      totalTokens += sectionTokens;
    } else {
      dropped.push(section.heading);
    }
  }

  // Re-sort included by original order
  included.sort((a, b) => a.originalIndex - b.originalIndex);

  const result = included.map(s => s.content).join('\n\n');
  const finalTokens = estimateTokens(result);

  return {
    content: result,
    originalTokens,
    finalTokens,
    sectionsDropped: dropped,
    truncated: dropped.length > 0,
  };
}

// ============================================================================
// Markdown Section Parser
// ============================================================================

interface ParsedSection {
  heading: string;
  content: string;
  priority: number;
  originalIndex: number;
}

function parseMarkdownSections(content: string): ParsedSection[] {
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let sectionIndex = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch && headingMatch[2]) {
      // Save previous section
      if (currentLines.length > 0 || currentHeading) {
        sections.push({
          heading: currentHeading || 'preamble',
          content: (currentHeading ? `## ${currentHeading}\n` : '') + currentLines.join('\n'),
          priority: getSectionPriority(currentHeading || 'preamble'),
          originalIndex: sectionIndex++,
        });
      }
      currentHeading = headingMatch[2];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Last section
  if (currentLines.length > 0 || currentHeading) {
    sections.push({
      heading: currentHeading || 'preamble',
      content: (currentHeading ? `## ${currentHeading}\n` : '') + currentLines.join('\n'),
      priority: getSectionPriority(currentHeading || 'preamble'),
      originalIndex: sectionIndex,
    });
  }

  return sections;
}

/**
 * Get the budget for a given file type.
 */
export function getBudgetForFileType(
  fileType: keyof BudgetConfig,
  overrides?: Partial<BudgetConfig>,
): number {
  const budgets = { ...DEFAULT_BUDGETS, ...overrides };
  return budgets[fileType] || 3000;
}
