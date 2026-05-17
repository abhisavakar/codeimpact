/**
 * Custom assertion helpers for the evaluation harness.
 * Each function throws on failure with a descriptive message.
 */

import assert from 'node:assert';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { DEFAULT_CONFIG } from '../../src/core/agents/workspace.js';

// ============================================================================
// File Existence
// ============================================================================

export function assertFileExists(filePath: string, message?: string): void {
  assert.ok(
    existsSync(filePath),
    message || `Expected file to exist: ${filePath}`,
  );
}

export function assertFileNotExists(filePath: string, message?: string): void {
  assert.ok(
    !existsSync(filePath),
    message || `Expected file NOT to exist: ${filePath}`,
  );
}

// ============================================================================
// Workspace Structure
// ============================================================================

export function assertWorkspaceComplete(projectPath: string): void {
  const root = join(projectPath, '.code-impact');
  assertFileExists(root, '.code-impact/ directory should exist');
  assertFileExists(join(root, 'config.yaml'), 'config.yaml should exist');
  assertFileExists(join(root, 'index.json'), 'index.json should exist');
  assertFileExists(join(root, 'project'), 'project/ directory should exist');
  assertFileExists(join(root, 'research'), 'research/ directory should exist');
  assertFileExists(join(root, 'features'), 'features/ directory should exist');
}

export function assertProjectFilesExist(projectPath: string): void {
  const root = join(projectPath, '.code-impact');
  assertFileExists(join(root, 'project', 'SKILL.md'), 'project/SKILL.md should exist');
  assertFileExists(join(root, 'project', 'CONVENTIONS.md'), 'project/CONVENTIONS.md should exist');
  assertFileExists(join(root, 'project', 'ARCHITECTURE.md'), 'project/ARCHITECTURE.md should exist');
  assertFileExists(join(root, 'project', 'AGENT.md'), 'project/AGENT.md should exist');
}

export function assertFeatureFilesExist(projectPath: string, featureName: string): void {
  const featureDir = join(projectPath, '.code-impact', 'features', featureName);
  assertFileExists(featureDir, `features/${featureName}/ should exist`);
  assertFileExists(join(featureDir, 'SKILL.md'), `features/${featureName}/SKILL.md should exist`);
  assertFileExists(join(featureDir, 'AGENT.md'), `features/${featureName}/AGENT.md should exist`);
}

// ============================================================================
// Marker Preservation
// ============================================================================

export function assertMarkersPresent(filePath: string, markers = DEFAULT_CONFIG.markers): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  assert.ok(
    content.includes(markers.start),
    `File ${filePath} should contain start marker "${markers.start}"`,
  );
  assert.ok(
    content.includes(markers.end),
    `File ${filePath} should contain end marker "${markers.end}"`,
  );
}

export function assertManualContentPreserved(filePath: string, expectedText: string): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  assert.ok(
    content.includes(expectedText),
    `File ${filePath} should preserve manual content: "${expectedText.slice(0, 50)}..."`,
  );
}

// ============================================================================
// Content Quality
// ============================================================================

export function assertNonEmptySection(filePath: string, sectionHeading: string): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  const headingIdx = content.indexOf(sectionHeading);
  assert.ok(headingIdx >= 0, `File ${filePath} should contain section "${sectionHeading}"`);

  // Check that there's non-placeholder content after the heading
  const afterHeading = content.slice(headingIdx + sectionHeading.length, headingIdx + sectionHeading.length + 200);
  const hasContent = afterHeading.trim().length > 0 &&
    !afterHeading.trim().startsWith('<!-- Add') &&
    !afterHeading.trim().startsWith('[No ');
  assert.ok(hasContent, `Section "${sectionHeading}" in ${filePath} should have real content, not placeholders`);
}

export function assertNoPlaceholders(filePath: string): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  const placeholders = [
    '<!-- Add feature-specific rules here -->',
    '<!-- Add known pitfalls here -->',
  ];
  for (const placeholder of placeholders) {
    assert.ok(
      !content.includes(placeholder),
      `File ${filePath} should not contain placeholder: "${placeholder}"`,
    );
  }
}

// ============================================================================
// Token Budget
// ============================================================================

export function assertTokenBudget(filePath: string, maxTokens: number): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  const estimatedTokens = Math.ceil(content.length / 4);
  assert.ok(
    estimatedTokens <= maxTokens,
    `File ${filePath} exceeds token budget: ${estimatedTokens} tokens > ${maxTokens} max`,
  );
}

// ============================================================================
// Idempotency
// ============================================================================

export function assertIdempotent(filePath: string, previousContent: string): void {
  assertFileExists(filePath);
  const currentContent = readFileSync(filePath, 'utf-8');
  assert.strictEqual(
    currentContent,
    previousContent,
    `File ${filePath} changed between runs (not idempotent)`,
  );
}

// ============================================================================
// Index Validation
// ============================================================================

export function assertIndexValid(projectPath: string): void {
  const indexPath = join(projectPath, '.code-impact', 'index.json');
  assertFileExists(indexPath);
  const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  assert.ok(index.version, 'index.json should have version');
  assert.ok(index.generatedAt, 'index.json should have generatedAt');
  assert.ok(Array.isArray(index.technologies), 'index.json should have technologies array');
  assert.ok(Array.isArray(index.features), 'index.json should have features array');
}

export function assertFeatureCount(projectPath: string, min: number, max?: number): void {
  const indexPath = join(projectPath, '.code-impact', 'index.json');
  assertFileExists(indexPath);
  const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  const count = index.features.length;
  assert.ok(count >= min, `Expected ≥${min} features, got ${count}`);
  if (max !== undefined) {
    assert.ok(count <= max, `Expected ≤${max} features, got ${count}`);
  }
}

export function assertTechnologyDetected(projectPath: string, techName: string): void {
  const indexPath = join(projectPath, '.code-impact', 'index.json');
  assertFileExists(indexPath);
  const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  const found = index.technologies.some((t: { name: string }) => t.name === techName);
  assert.ok(found, `Technology "${techName}" should be detected in index.json`);
}

// ============================================================================
// Content Contains
// ============================================================================

export function assertFileContains(filePath: string, text: string): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  assert.ok(
    content.includes(text),
    `File ${filePath} should contain: "${text.slice(0, 80)}..."`,
  );
}

export function assertFileNotContains(filePath: string, text: string): void {
  assertFileExists(filePath);
  const content = readFileSync(filePath, 'utf-8');
  assert.ok(
    !content.includes(text),
    `File ${filePath} should NOT contain: "${text.slice(0, 80)}"`,
  );
}

// ============================================================================
// Research Files
// ============================================================================

export function assertResearchExists(projectPath: string, techName: string): void {
  const researchDir = join(projectPath, '.code-impact', 'research');
  assertFileExists(researchDir, 'research/ directory should exist');
  const files = require('fs').readdirSync(researchDir) as string[];
  const found = files.some((f: string) => f.startsWith(techName + '@') || f.startsWith(techName.replace(/^@/, '').replace(/\//g, '__') + '@'));
  assert.ok(found, `Research file for "${techName}" should exist in research/`);
}
