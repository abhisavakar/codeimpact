/**
 * Self-Improving Engine — diagnoses failures, learns from mistakes, promotes lessons,
 * patches skills, triggers re-research, and continuously improves agent quality.
 *
 * Key capabilities:
 * 1. Immediate learning: learnFromOutcome() runs right after each outcome recording
 * 2. Batch improvement: runImprovementEngine() processes undiagnosed failures
 * 3. Lesson promotion: promoteLessons() moves confirmed patterns from quarantine to rules
 * 4. Error fingerprinting: groups similar errors to detect recurring patterns
 * 5. Skill patching: automatically fixes wrong assumptions in SKILL.md files
 * 6. Re-research triggering: flags stale tech docs when API errors are detected
 * 7. Decay: marks old unconfirmed lessons as stale
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import type {
  OutcomeRecord,
  DiagnosisResult,
  DiagnosisCategory,
  LessonEntry,
  AgentConfig,
  ProposedImprovement,
} from './types.js';
import { queryOutcomes, markDiagnosed, recordOutcome } from './outcome-storage.js';
import { getAgentWorkspacePaths, readAgentConfig, readAgentIndex, writeAgentIndex, updateMarkedSection } from './workspace.js';
import { diagnoseWithTable, type DiagnosisContext } from './diagnosis-table.js';

// ============================================================================
// Public API — Main Entry Points
// ============================================================================

export interface ImprovementResult {
  diagnosed: number;
  lessonsAdded: number;
  lessonsPromoted: number;
  skipped: number;
  reResearchTriggered: string[];
  skillsPatched: string[];
  details: Array<{
    outcomeId: string;
    category: DiagnosisCategory;
    action: string;
    targetFile?: string;
  }>;
}

export interface LearnResult {
  learned: boolean;
  diagnosis?: DiagnosisResult;
  action: 'lesson-added' | 'waiting-for-recurrence' | 're-research-triggered' | 'skill-patched' | 'no-action';
  detail?: string;
}

/**
 * Immediate learning — called right after recording an outcome.
 * Provides instant feedback loop: diagnose → act (if evidence is strong enough).
 */
export function learnFromOutcome(
  db: Database.Database,
  projectPath: string,
  outcome: OutcomeRecord,
): LearnResult {
  if (outcome.result === 'success') {
    // Success outcomes confirm existing lessons — mark as validated
    confirmRelatedLessons(projectPath, outcome);
    return { learned: true, action: 'no-action', detail: 'Success confirms existing knowledge' };
  }

  if (outcome.result !== 'failure') {
    return { learned: false, action: 'no-action' };
  }

  const config = readAgentConfig(projectPath);
  const diagnosis = diagnoseFailure(outcome, db, projectPath);

  if (!diagnosis) {
    return { learned: false, action: 'no-action', detail: 'Could not classify error' };
  }

  // Check rate limit BEFORE marking diagnosed (so current outcome doesn't count)
  const rateLimited = isRateLimited(db, outcome.agent);

  // Mark diagnosed (always, for tracking)
  markDiagnosed(db, outcome.id, diagnosis);

  // Act based on diagnosis (category-specific, not rate-limited)
  switch (diagnosis.category) {
    case 'outdated-research': {
      // Trigger re-research — flag in index
      const techs = identifyAffectedTechnologies(outcome, projectPath);
      if (techs.length > 0) {
        flagForReResearch(projectPath, techs);
        return {
          learned: true,
          diagnosis,
          action: 're-research-triggered',
          detail: `Flagged for re-research: ${techs.join(', ')}`,
        };
      }
      break;
    }

    case 'wrong-assumption': {
      // If fixApplied is provided, we have strong evidence — patch skill immediately
      if (outcome.fixApplied) {
        const patched = patchSkillWithFix(projectPath, outcome, diagnosis, config);
        if (patched) {
          return {
            learned: true,
            diagnosis,
            action: 'skill-patched',
            detail: `Patched: ${patched}`,
          };
        }
      }
      break;
    }

    default:
      break;
  }

  // Standard lesson flow with evidence check (rate-limited)
  if (rateLimited) {
    return { learned: false, diagnosis, action: 'no-action', detail: 'Rate limited (3/day max)' };
  }

  const hasClearEvidence = !!outcome.fixApplied;
  if (!hasClearEvidence) {
    const similarCount = countSimilarFailures(db, outcome.agent, diagnosis.category, outcome.errorMessage || '');
    if (similarCount < 2) {
      return {
        learned: false,
        diagnosis,
        action: 'waiting-for-recurrence',
        detail: `Similar failures: ${similarCount}/2 needed`,
      };
    }
  }

  // Write lesson
  const written = writeLesson(projectPath, outcome, diagnosis, config);
  if (written) {
    return {
      learned: true,
      diagnosis,
      action: 'lesson-added',
      detail: `Lesson added to ${written}`,
    };
  }

  return { learned: false, diagnosis, action: 'no-action' };
}

/**
 * Batch improvement — run periodically to process undiagnosed failures.
 */
export function runImprovementEngine(
  db: Database.Database,
  projectPath: string,
): ImprovementResult {
  const config = readAgentConfig(projectPath);
  const result: ImprovementResult = {
    diagnosed: 0,
    lessonsAdded: 0,
    lessonsPromoted: 0,
    skipped: 0,
    reResearchTriggered: [],
    skillsPatched: [],
    details: [],
  };

  // Get undiagnosed failures
  const failures = queryOutcomes(db, { result: 'failure', diagnosed: false, limit: 20 });

  if (failures.length === 0) {
    // Even with no new failures, run promotion
    result.lessonsPromoted = promoteLessons(db, projectPath);
    return result;
  }

  // Rate limit tracking: max 3 lessons per agent per day
  const lessonsToday = new Map<string, number>();

  for (const failure of failures) {
    // Diagnose
    const diagnosis = diagnoseFailure(failure, db, projectPath);
    if (!diagnosis) {
      result.skipped++;
      continue;
    }

    // Mark as diagnosed
    markDiagnosed(db, failure.id, diagnosis);
    result.diagnosed++;

    // Handle re-research triggers
    if (diagnosis.category === 'outdated-research') {
      const techs = identifyAffectedTechnologies(failure, projectPath);
      if (techs.length > 0) {
        flagForReResearch(projectPath, techs);
        result.reResearchTriggered.push(...techs);
        result.details.push({
          outcomeId: failure.id,
          category: diagnosis.category,
          action: 're-research-flagged',
          targetFile: techs.join(', '),
        });
      }
      continue;
    }

    // Check rate limit
    const agentLessons = lessonsToday.get(failure.agent) || 0;
    if (agentLessons >= 3) {
      result.skipped++;
      result.details.push({
        outcomeId: failure.id,
        category: diagnosis.category,
        action: 'rate-limited',
      });
      continue;
    }

    // Check ≥2 occurrences requirement (or clear evidence)
    const hasClearEvidence = failure.fixApplied !== undefined;
    if (!hasClearEvidence) {
      const similarCount = countSimilarFailures(db, failure.agent, diagnosis.category, failure.errorMessage || '');
      if (similarCount < 2) {
        result.skipped++;
        result.details.push({
          outcomeId: failure.id,
          category: diagnosis.category,
          action: 'waiting-for-recurrence',
        });
        continue;
      }
    }

    // For wrong-assumption with fix, patch skill directly
    if (diagnosis.category === 'wrong-assumption' && failure.fixApplied) {
      const patched = patchSkillWithFix(projectPath, failure, diagnosis, config);
      if (patched) {
        result.skillsPatched.push(patched);
        result.details.push({
          outcomeId: failure.id,
          category: diagnosis.category,
          action: 'skill-patched',
          targetFile: patched,
        });
        continue;
      }
    }

    // Write lesson
    const written = writeLesson(projectPath, failure, diagnosis, config);
    if (written) {
      lessonsToday.set(failure.agent, agentLessons + 1);
      result.lessonsAdded++;
      result.details.push({
        outcomeId: failure.id,
        category: diagnosis.category,
        action: 'lesson-added',
        targetFile: written,
      });
    }
  }

  // Run promotion after processing
  result.lessonsPromoted = promoteLessons(db, projectPath);

  return result;
}

/**
 * Promote confirmed lessons from "Lessons Learned" quarantine to "Rules" section.
 * A lesson is promoted when the same pattern has ≥3 confirmed occurrences.
 */
export function promoteLessons(db: Database.Database, projectPath: string): number {
  const config = readAgentConfig(projectPath);
  const paths = getAgentWorkspacePaths(projectPath);
  let promoted = 0;

  const agentFiles = findAgentFiles(paths);
  const skillFiles = findSkillFiles(paths);

  for (const filePath of agentFiles) {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.includes('## Lessons Learned')) continue;

    // Extract lessons between markers
    const lessonsMatch = content.match(/## Lessons Learned\n([\s\S]*?)(?=\n##|\n<!-- |$)/);
    if (!lessonsMatch || !lessonsMatch[1]) continue;

    const lessonLines = lessonsMatch[1].split('\n').filter(l => l.startsWith('- '));

    for (const lesson of lessonLines) {
      // Skip already promoted or unconfirmed
      if (lesson.includes('[promoted]') || lesson.includes('[unconfirmed]')) continue;

      // Extract the core content
      const lessonContent = lesson.replace(/^- \d{4}-\d{2}-\d{2}: /, '').replace(/\(outcome: \w+\)$/, '').trim();

      // Count confirmations: how many similar diagnosed outcomes reference this pattern
      const fingerprint = computeErrorFingerprint(lessonContent);
      const confirmations = countConfirmations(db, fingerprint);

      if (confirmations >= 3) {
        // Promote: add to rules section of the corresponding SKILL.md
        const featureName = extractFeatureFromPath(filePath);
        const skillPath = featureName
          ? join(paths.featuresDir, featureName, 'SKILL.md')
          : join(paths.projectDir, 'SKILL.md');

        if (existsSync(skillPath)) {
          const ruleAdded = addRuleToSkill(skillPath, lessonContent, config);
          if (ruleAdded) {
            // Mark lesson as promoted in AGENT.md
            const updatedContent = content.replace(lesson, `${lesson} [promoted]`);
            writeFileSync(filePath, updatedContent);
            promoted++;
          }
        }
      }
    }
  }

  return promoted;
}

// ============================================================================
// Diagnosis Pipeline
// ============================================================================

function diagnoseFailure(
  failure: OutcomeRecord,
  db: Database.Database,
  projectPath: string,
): DiagnosisResult | null {
  const error = failure.errorMessage || '';
  const file = failure.errorFile || '';

  // Build scope checker for decision table
  const isInScope = (filePath: string, agentName: string): boolean => {
    const paths = getAgentWorkspacePaths(projectPath);
    const name = agentName.replace(/-agent$/, '');
    const agentPath = join(paths.featuresDir, name, 'AGENT.md');
    if (!existsSync(agentPath)) return true;
    const agentContent = readFileSync(agentPath, 'utf-8');
    return fileMatchesAgentScope(filePath, agentContent);
  };

  // Use the declarative decision table for diagnosis
  const ctx: DiagnosisContext = {
    errorMessage: error,
    errorFile: file,
    agentName: failure.agent,
    fixApplied: failure.fixApplied,
    isInScope,
  };

  return diagnoseWithTable(ctx);
}

// ============================================================================
// Error Classification Helpers
// ============================================================================

function isImportError(error: string): boolean {
  const patterns = [
    /cannot find module/i,
    /module not found/i,
    /no exported member/i,
    /does not provide an export/i,
    /is not exported from/i,
    /import.*not found/i,
    /ERR_MODULE_NOT_FOUND/i,
    /cannot resolve/i,
    /unable to resolve.*specifier/i,
  ];
  return patterns.some(p => p.test(error));
}

function isTypeError(error: string): boolean {
  const patterns = [
    /type.*is not assignable to/i,
    /property.*does not exist on type/i,
    /argument of type.*is not assignable/i,
    /expected \d+ arguments.*got \d+/i,
    /TS\d{4}/,
    /cannot invoke an object which is possibly/i,
    /has no compatible call signatures/i,
  ];
  return patterns.some(p => p.test(error));
}

function isTestFailure(error: string): boolean {
  const patterns = [
    /FAIL/,
    /test.*failed/i,
    /assertion.*failed/i,
    /expect.*received/i,
    /AssertionError/i,
    /expected.*to (be|equal|match|throw)/i,
  ];
  return patterns.some(p => p.test(error));
}

function isRuntimeError(error: string): boolean {
  const patterns = [
    /TypeError:/,
    /ReferenceError:/,
    /RangeError:/,
    /ECONNREFUSED/,
    /ENOENT/,
    /EPERM/,
    /ETIMEDOUT/,
    /EACCES/,
    /Cannot read properties of (null|undefined)/,
  ];
  return patterns.some(p => p.test(error));
}

// ============================================================================
// Self-Improvement: Pattern Matching for Known Mistakes
// ============================================================================

interface MistakePattern {
  trigger: RegExp;
  category: DiagnosisCategory;
  description: string;
  suggestedFix: string;
  confidence: number;
}

const KNOWN_MISTAKE_PATTERNS: MistakePattern[] = [
  {
    trigger: /\.decode\(\).*without.*verify/i,
    category: 'wrong-assumption',
    description: 'Using decode without verify is a security issue',
    suggestedFix: 'Always use verify() before trusting decoded data',
    confidence: 0.9,
  },
  {
    trigger: /require\(.*\).*esm|ERR_REQUIRE_ESM/i,
    category: 'wrong-assumption',
    description: 'Using require() in ESM context',
    suggestedFix: 'Use import instead of require in ESM modules',
    confidence: 0.9,
  },
  {
    trigger: /async.*better-sqlite3|await.*db\.(prepare|exec|run)/i,
    category: 'wrong-assumption',
    description: 'better-sqlite3 is synchronous, not async',
    suggestedFix: 'Remove async/await from better-sqlite3 calls',
    confidence: 0.95,
  },
  {
    trigger: /db\.exec\(\).*undefined|exec.*returns nothing/i,
    category: 'wrong-assumption',
    description: 'db.exec() returns nothing, not query results',
    suggestedFix: 'Use db.prepare().all() for SELECT queries',
    confidence: 0.9,
  },
  {
    trigger: /deprecated.*api|api.*removed|api.*discontinued/i,
    category: 'outdated-research',
    description: 'Using deprecated or removed API',
    suggestedFix: 'Re-research for current API patterns',
    confidence: 0.8,
  },
];

function matchKnownMistakePattern(error: string, _projectPath: string): DiagnosisResult | null {
  for (const pattern of KNOWN_MISTAKE_PATTERNS) {
    if (pattern.trigger.test(error)) {
      return {
        category: pattern.category,
        confidence: pattern.confidence,
        description: pattern.description,
        suggestedFix: pattern.suggestedFix,
      };
    }
  }
  return null;
}

// ============================================================================
// Scope Checking
// ============================================================================

function fileMatchesAgentScope(filePath: string, agentMdContent: string): boolean {
  const scopeMatch = agentMdContent.match(/\*\*Included paths?\*\*:\s*(.+)/);
  if (!scopeMatch || !scopeMatch[1]) return true; // Can't determine scope, assume ok
  const patterns = scopeMatch[1].split(',').map(s => s.trim());

  for (const pattern of patterns) {
    if (pattern === '**') return true;
    const prefix = pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
    if (filePath.startsWith(prefix)) return true;
  }
  return false;
}

// ============================================================================
// Self-Improvement: Skill Patching
// ============================================================================

/**
 * Directly patch a SKILL.md when we have strong evidence (outcome + fix).
 * Adds the correct pattern to Pitfalls and updates Rules if needed.
 */
function patchSkillWithFix(
  projectPath: string,
  outcome: OutcomeRecord,
  diagnosis: DiagnosisResult,
  config: AgentConfig,
): string | null {
  const paths = getAgentWorkspacePaths(projectPath);
  const agentName = outcome.agent.replace(/-agent$/, '');

  // Find the relevant SKILL.md
  const featureSkillPath = join(paths.featuresDir, agentName, 'SKILL.md');
  const targetPath = existsSync(featureSkillPath)
    ? featureSkillPath
    : join(paths.projectDir, 'SKILL.md');

  if (!existsSync(targetPath)) return null;

  const content = readFileSync(targetPath, 'utf-8');

  // Build pitfall entry from the diagnosis + fix
  const pitfallEntry = `- ${diagnosis.description.slice(0, 150)} → Fix: ${outcome.fixApplied!.slice(0, 100)}`;

  // Find the auto section and add to Pitfalls
  if (!content.includes(config.markers.start)) return null;

  const startIdx = content.indexOf(config.markers.start);
  const endIdx = content.indexOf(config.markers.end);
  if (startIdx < 0 || endIdx < 0) return null;

  const autoSection = content.slice(startIdx + config.markers.start.length, endIdx);

  // Add to Pitfalls section within auto-managed area
  let updatedSection: string;
  if (autoSection.includes('## Pitfalls')) {
    updatedSection = autoSection.replace(
      /(## Pitfalls\n)/,
      `$1${pitfallEntry}\n`,
    );
  } else {
    updatedSection = autoSection + `\n## Pitfalls\n${pitfallEntry}\n`;
  }

  const before = content.slice(0, startIdx + config.markers.start.length);
  const after = content.slice(endIdx);
  const updated = before + updatedSection + after;

  writeFileSync(targetPath, updated);
  return targetPath;
}

// ============================================================================
// Self-Improvement: Re-Research Triggering
// ============================================================================

/**
 * Identify which technologies are affected by an error.
 * Uses: related research, error message tech mentions, error file path.
 */
function identifyAffectedTechnologies(outcome: OutcomeRecord, projectPath: string): string[] {
  const techs: string[] = [];
  const paths = getAgentWorkspacePaths(projectPath);

  // From related research
  if (outcome.relatedResearch.length > 0) {
    for (const ref of outcome.relatedResearch) {
      // research/express@4.21.md → express
      const match = ref.match(/([^/]+)@/);
      if (match && match[1]) techs.push(match[1]);
    }
  }

  // From error message — look for package names
  if (outcome.errorMessage) {
    const error = outcome.errorMessage;
    // Check if error mentions specific packages
    const pkgMatch = error.match(/(?:from |require\(|import )['"]([^'"./][^'"]*)['"]/);
    if (pkgMatch && pkgMatch[1]) {
      const pkg = pkgMatch[1].startsWith('@') ? pkgMatch[1] : pkgMatch[1].split('/')[0]!;
      techs.push(pkg);
    }
  }

  // From research files that exist
  if (existsSync(paths.researchDir)) {
    try {
      const researchFiles = readdirSync(paths.researchDir);
      for (const file of researchFiles) {
        const techName = file.replace(/@.*\.md$/, '');
        if (outcome.errorMessage && outcome.errorMessage.toLowerCase().includes(techName.toLowerCase())) {
          techs.push(techName);
        }
      }
    } catch { /* ignore */ }
  }

  return [...new Set(techs)];
}

/**
 * Flag technologies for re-research in index.json.
 */
function flagForReResearch(projectPath: string, technologies: string[]): void {
  const index = readAgentIndex(projectPath);

  // Set lastResearch dates to epoch to force refresh
  for (const tech of technologies) {
    index.lastResearch[tech] = '1970-01-01T00:00:00Z';
  }

  writeAgentIndex(projectPath, index);
}

// ============================================================================
// Self-Improvement: Lesson Confirmation from Successes
// ============================================================================

/**
 * When an outcome is successful, check if it validates any existing lessons.
 * This strengthens lessons that were waiting for confirmation.
 */
function confirmRelatedLessons(projectPath: string, outcome: OutcomeRecord): void {
  if (outcome.relatedSkills.length === 0) return;

  const paths = getAgentWorkspacePaths(projectPath);
  const agentName = outcome.agent.replace(/-agent$/, '');
  const agentPath = join(paths.featuresDir, agentName, 'AGENT.md');

  if (!existsSync(agentPath)) return;

  const content = readFileSync(agentPath, 'utf-8');

  // Find lessons that mention same area as the successful task
  // Add [confirmed] tag to matching lessons
  const taskWords = outcome.task.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  let updated = content;
  let changed = false;

  for (const word of taskWords) {
    const lessonPattern = new RegExp(
      `^(- \\d{4}-\\d{2}-\\d{2}: .*${word}.*?)(?<!\\[confirmed\\])(?<!\\[promoted\\])(?<!\\[unconfirmed\\])$`,
      'gm',
    );
    const replacement = updated.replace(lessonPattern, '$1 [confirmed]');
    if (replacement !== updated) {
      updated = replacement;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(agentPath, updated);
  }
}

// ============================================================================
// Lesson Writing
// ============================================================================

function writeLesson(
  projectPath: string,
  failure: OutcomeRecord,
  diagnosis: DiagnosisResult,
  config: AgentConfig,
): string | null {
  const paths = getAgentWorkspacePaths(projectPath);
  const today = new Date().toISOString().split('T')[0];

  // Determine target file based on diagnosis category
  let targetPath: string;
  switch (diagnosis.category) {
    case 'outdated-research':
      // Don't write lessons for this — trigger re-research instead
      return null;

    case 'scope-error': {
      const agentName = failure.agent.replace(/-agent$/, '');
      targetPath = join(paths.featuresDir, agentName, 'AGENT.md');
      break;
    }

    case 'wrong-assumption':
    case 'missing-test': {
      const agentName = failure.agent.replace(/-agent$/, '');
      const featurePath = join(paths.featuresDir, agentName, 'AGENT.md');
      targetPath = existsSync(featurePath) ? featurePath : join(paths.projectDir, 'AGENT.md');
      break;
    }

    case 'missing-convention':
      targetPath = join(paths.projectDir, 'AGENT.md');
      break;

    case 'external-change':
    default:
      targetPath = join(paths.projectDir, 'AGENT.md');
      break;
  }

  if (!existsSync(targetPath)) return null;

  // Build lesson text with evidence
  const evidenceRef = failure.fixApplied
    ? ` Fix: ${failure.fixApplied.slice(0, 80)}`
    : '';
  const lessonText = `- ${today}: ${diagnosis.description.slice(0, 200)}${evidenceRef} (outcome: ${failure.id.slice(0, 8)})`;

  // Check for duplicate lessons
  const existing = readFileSync(targetPath, 'utf-8');
  const fingerprint = computeErrorFingerprint(diagnosis.description);
  if (existing.includes(fingerprint.slice(0, 30))) {
    // Already have a similar lesson, don't duplicate
    return null;
  }

  if (!existing.includes(config.markers.start)) return null;

  const startIdx = existing.indexOf(config.markers.start);
  const endIdx = existing.indexOf(config.markers.end);
  if (startIdx < 0 || endIdx < 0) return null;

  const autoSection = existing.slice(startIdx + config.markers.start.length, endIdx);

  // Append lesson
  let updatedSection: string;
  if (autoSection.includes('[No lessons recorded yet]')) {
    updatedSection = autoSection.replace('[No lessons recorded yet]', lessonText);
  } else {
    updatedSection = autoSection.trimEnd() + '\n' + lessonText;
  }

  const before = existing.slice(0, startIdx + config.markers.start.length);
  const after = existing.slice(endIdx);
  const updated = before + updatedSection + '\n' + after;

  writeFileSync(targetPath, updated);
  return targetPath;
}

// ============================================================================
// Self-Improvement: Rule Addition to Skills
// ============================================================================

/**
 * Add a promoted lesson as a rule to a SKILL.md file.
 */
function addRuleToSkill(skillPath: string, ruleContent: string, config: AgentConfig): boolean {
  const content = readFileSync(skillPath, 'utf-8');
  if (!content.includes(config.markers.start)) return false;

  const startIdx = content.indexOf(config.markers.start);
  const endIdx = content.indexOf(config.markers.end);
  if (startIdx < 0 || endIdx < 0) return false;

  const autoSection = content.slice(startIdx + config.markers.start.length, endIdx);
  const ruleEntry = `- ${ruleContent}`;

  // Check if rule already exists (dedup)
  if (autoSection.includes(ruleContent.slice(0, 50))) return false;

  let updatedSection: string;
  if (autoSection.includes('## Rules')) {
    updatedSection = autoSection.replace(
      /(## Rules\n)/,
      `$1${ruleEntry}\n`,
    );
  } else {
    updatedSection = autoSection + `\n## Rules\n${ruleEntry}\n`;
  }

  const before = content.slice(0, startIdx + config.markers.start.length);
  const after = content.slice(endIdx);
  const updated = before + updatedSection + after;

  writeFileSync(skillPath, updated);
  return true;
}

// ============================================================================
// Helpers — Fingerprinting & Counting
// ============================================================================

/**
 * Compute a fingerprint for an error message to group similar errors.
 * Strips variable parts (paths, numbers, quotes) to find the pattern.
 */
function computeErrorFingerprint(error: string): string {
  return error
    .toLowerCase()
    .replace(/['"][^'"]*['"]/g, '""')   // Normalize quoted strings
    .replace(/\b\d+\b/g, 'N')           // Normalize numbers
    .replace(/\/[^\s]+/g, '/PATH')      // Normalize paths
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .trim()
    .slice(0, 100);
}

function countSimilarFailures(
  db: Database.Database,
  agent: string,
  category: DiagnosisCategory,
  errorMessage: string,
): number {
  // Count similar failures in the last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const outcomes = queryOutcomes(db, { agent, result: 'failure', since, limit: 50 });

  let count = 0;
  const fingerprint = computeErrorFingerprint(errorMessage);

  for (const outcome of outcomes) {
    if (!outcome.errorMessage) continue;
    const otherFingerprint = computeErrorFingerprint(outcome.errorMessage);
    const similarity = computeFingerSimilarity(fingerprint, otherFingerprint);
    if (similarity > 0.5) count++;
  }

  return count;
}

function countConfirmations(db: Database.Database, fingerprint: string): number {
  // Count outcomes where the diagnosis matches this fingerprint
  const outcomes = queryOutcomes(db, { result: 'failure', limit: 100 });
  let count = 0;

  for (const outcome of outcomes) {
    if (!outcome.diagnosis) continue;
    const diagFingerprint = computeErrorFingerprint(outcome.diagnosis.description);
    if (computeFingerSimilarity(fingerprint, diagFingerprint) > 0.6) {
      count++;
    }
  }

  return count;
}

function computeFingerSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\W+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\W+/).filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  return (2 * intersection) / (wordsA.size + wordsB.size);
}

function isRateLimited(db: Database.Database, agent: string): boolean {
  const today = new Date().toISOString().split('T')[0]!;
  const outcomes = queryOutcomes(db, { agent, result: 'failure', since: today, limit: 10 });
  const diagnosedToday = outcomes.filter(o => o.diagnosed).length;
  return diagnosedToday >= 3;
}

// ============================================================================
// Decay — mark old unconfirmed lessons
// ============================================================================

export function decayOldLessons(projectPath: string, maxAgeDays: number = 90): number {
  const config = readAgentConfig(projectPath);
  const paths = getAgentWorkspacePaths(projectPath);
  let decayed = 0;

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

  // Process all AGENT.md files
  const agentFiles = findAgentFiles(paths);

  for (const filePath of agentFiles) {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.includes(config.markers.start)) continue;

    // Find lessons that are old and unconfirmed (and not already marked)
    const updated = content.replace(
      /^(- \d{4}-\d{2}-\d{2}: .+?)(?<!\[unconfirmed\])(?<!\[confirmed\])(?<!\[promoted\])$/gm,
      (match, lesson) => {
        const dateMatch = lesson.match(/^- (\d{4}-\d{2}-\d{2}):/);
        if (dateMatch && dateMatch[1] && dateMatch[1] < cutoff) {
          decayed++;
          return `${lesson} [unconfirmed]`;
        }
        return match;
      },
    );

    if (updated !== content) {
      writeFileSync(filePath, updated);
    }
  }

  return decayed;
}

// ============================================================================
// File Discovery Helpers
// ============================================================================

function findAgentFiles(paths: ReturnType<typeof getAgentWorkspacePaths>): string[] {
  const files: string[] = [];
  // Project AGENT.md
  const superAgent = join(paths.projectDir, 'AGENT.md');
  if (existsSync(superAgent)) files.push(superAgent);

  // Feature AGENT.md files
  if (existsSync(paths.featuresDir)) {
    try {
      const features = readdirSync(paths.featuresDir, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);

      for (const feature of features) {
        const agentPath = join(paths.featuresDir, feature, 'AGENT.md');
        if (existsSync(agentPath)) files.push(agentPath);
      }
    } catch { /* ignore */ }
  }

  return files;
}

function findSkillFiles(paths: ReturnType<typeof getAgentWorkspacePaths>): string[] {
  const files: string[] = [];
  // Project SKILL.md
  const projectSkill = join(paths.projectDir, 'SKILL.md');
  if (existsSync(projectSkill)) files.push(projectSkill);

  // Feature SKILL.md files
  if (existsSync(paths.featuresDir)) {
    try {
      const features = readdirSync(paths.featuresDir, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);

      for (const feature of features) {
        const skillPath = join(paths.featuresDir, feature, 'SKILL.md');
        if (existsSync(skillPath)) files.push(skillPath);
      }
    } catch { /* ignore */ }
  }

  return files;
}

function extractFeatureFromPath(filePath: string): string | null {
  const match = filePath.match(/features[/\\]([^/\\]+)[/\\]/);
  return match ? match[1]! : null;
}
