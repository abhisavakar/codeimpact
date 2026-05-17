/**
 * Research Trust Scoring — evaluates quality and reliability of fetched
 * documentation content, producing a trust score for research files.
 */

// ============================================================================
// Types
// ============================================================================

export interface TrustAssessment {
  score: number;       // 0.0 to 1.0
  verified: boolean;   // score >= threshold
  signals: TrustSignal[];
  sectionsExtracted: {
    breaking_changes: boolean;
    api_patterns: boolean;
    common_pitfalls: boolean;
    migration_notes: boolean;
  };
}

export interface TrustSignal {
  name: string;
  weight: number;
  present: boolean;
  detail?: string;
}

export interface TrustConfig {
  threshold: number;   // Below this, mark as unverified (default: 0.5)
}

export const DEFAULT_TRUST_CONFIG: TrustConfig = {
  threshold: 0.5,
};

// ============================================================================
// Trust Scoring
// ============================================================================

/**
 * Evaluate trust of research content based on multiple signals.
 */
export function assessTrust(
  content: string,
  sourceUrls: string[],
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): TrustAssessment {
  const signals: TrustSignal[] = [];

  // Signal 1: Has code examples
  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  signals.push({
    name: 'has_code_examples',
    weight: 0.25,
    present: codeBlockCount >= 1,
    detail: `${Math.floor(codeBlockCount)} code blocks found`,
  });

  // Signal 2: Content length sufficient
  const contentLength = content.length;
  signals.push({
    name: 'sufficient_content',
    weight: 0.20,
    present: contentLength > 500,
    detail: `${contentLength} chars`,
  });

  // Signal 3: Has API patterns section
  const hasApiPatterns = /## (Key )?API Patterns/i.test(content);
  signals.push({
    name: 'api_patterns_section',
    weight: 0.15,
    present: hasApiPatterns,
  });

  // Signal 4: Has breaking changes / migration notes
  const hasBreaking = /## (Breaking|Migration)/i.test(content);
  signals.push({
    name: 'breaking_changes_section',
    weight: 0.10,
    present: hasBreaking,
  });

  // Signal 5: Has pitfalls / gotchas
  const hasPitfalls = /## (Common )?(Pitfalls|Gotchas)/i.test(content);
  signals.push({
    name: 'pitfalls_section',
    weight: 0.10,
    present: hasPitfalls,
  });

  // Signal 6: Source URLs are real (not empty)
  const hasRealSources = sourceUrls.length > 0 && sourceUrls.some(u => u.startsWith('http'));
  signals.push({
    name: 'real_source_urls',
    weight: 0.10,
    present: hasRealSources,
    detail: `${sourceUrls.length} source(s)`,
  });

  // Signal 7: No "Research pending" stub
  const isStub = content.includes('No documentation fetched yet') || content.includes('Research pending');
  signals.push({
    name: 'not_stub',
    weight: 0.10,
    present: !isStub,
  });

  // Compute weighted score
  let score = 0;
  for (const signal of signals) {
    if (signal.present) {
      score += signal.weight;
    }
  }

  // Clamp to [0, 1]
  score = Math.min(1, Math.max(0, score));

  return {
    score: Math.round(score * 100) / 100,
    verified: score >= config.threshold,
    signals,
    sectionsExtracted: {
      breaking_changes: hasBreaking,
      api_patterns: hasApiPatterns,
      common_pitfalls: hasPitfalls,
      migration_notes: /## Migration/i.test(content),
    },
  };
}

/**
 * Generate trust frontmatter lines for inclusion in research files.
 */
export function renderTrustFrontmatter(assessment: TrustAssessment): string[] {
  return [
    `trust_score: ${assessment.score}`,
    `verified: ${assessment.verified}`,
    'sections_extracted:',
    `  breaking_changes: ${assessment.sectionsExtracted.breaking_changes}`,
    `  api_patterns: ${assessment.sectionsExtracted.api_patterns}`,
    `  common_pitfalls: ${assessment.sectionsExtracted.common_pitfalls}`,
    `  migration_notes: ${assessment.sectionsExtracted.migration_notes}`,
  ];
}
