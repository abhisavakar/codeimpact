/**
 * Tests for the Migration Engine — knowledge/ → .code-impact/ migration.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateKnowledge } from '../../src/core/agents/migration.js';

const TEST_DIR = join(tmpdir(), `codeimpact-migration-test-${Date.now()}`);

describe('Migration Engine', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should skip when knowledge/ does not exist', () => {
    const result = migrateKnowledge({ projectPath: TEST_DIR });
    assert.ok(result.success);
    assert.strictEqual(result.migrated.length, 0);
    assert.strictEqual(result.skipped.length, 1);
    assert.ok(result.skipped[0]!.reason.includes('does not exist'));
  });

  it('should migrate technology skills', () => {
    // Create knowledge/skills/technology/express/SKILL.md
    const skillDir = join(TEST_DIR, 'knowledge', 'skills', 'technology', 'express');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Express Patterns\n\n## Rules\n- Use Router()');

    const result = migrateKnowledge({ projectPath: TEST_DIR });
    assert.ok(result.success);
    assert.strictEqual(result.migrated.length, 1);
    assert.strictEqual(result.migrated[0]!.type, 'technology');

    // Verify target file exists
    const targetPath = join(TEST_DIR, '.code-impact', 'project', 'express-SKILL.md');
    assert.ok(existsSync(targetPath));
  });

  it('should migrate feature skills', () => {
    const skillDir = join(TEST_DIR, 'knowledge', 'skills', 'feature', 'auth');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Auth Feature\n\n## Rules\n- Validate tokens');

    const result = migrateKnowledge({ projectPath: TEST_DIR });
    assert.strictEqual(result.migrated.length, 1);
    assert.strictEqual(result.migrated[0]!.type, 'feature');

    const targetPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'SKILL.md');
    assert.ok(existsSync(targetPath));
  });

  it('should perform dry-run without writing', () => {
    const skillDir = join(TEST_DIR, 'knowledge', 'skills', 'technology', 'express');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Express');

    const result = migrateKnowledge({ projectPath: TEST_DIR, dryRun: true });
    assert.strictEqual(result.migrated.length, 1);
    // Should NOT create .code-impact directory
    assert.ok(!existsSync(join(TEST_DIR, '.code-impact')));
  });

  it('should create backup when requested', () => {
    const skillDir = join(TEST_DIR, 'knowledge', 'skills', 'technology', 'express');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Express');

    const result = migrateKnowledge({ projectPath: TEST_DIR, backup: true });
    assert.ok(result.backupDir);
    assert.ok(existsSync(result.backupDir));
  });

  it('should detect conflicts and skip existing targets', () => {
    // Create source
    const skillDir = join(TEST_DIR, 'knowledge', 'skills', 'technology', 'express');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Express Legacy\n\n## Rules\n- Old rule');

    // Create target that already exists
    const targetDir = join(TEST_DIR, '.code-impact', 'project');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'express-SKILL.md'), '# Express Existing\n\n## Rules\n- New rule');
    // Also create config.yaml and index.json for workspace
    writeFileSync(join(TEST_DIR, '.code-impact', 'config.yaml'), 'version: 1\noutput_dir: .code-impact\nbranch: code-impact/skills\nauto_research: true\nresearch_cadence_hours: 168\nresearch_max_tokens_per_tech: 4000\nauto_pr: true\nmonorepo: auto\nfeature_detection:\n  min_files: 3\n  min_cohesion: 0.4\n  max_features: 20\n  respect_codeowners: true\n  respect_package_boundaries: true\nignore_patterns:\n  - "node_modules/**"\nmarkers:\n  start: "<!-- code-impact:auto-start -->"\n  end: "<!-- code-impact:auto-end -->"');

    const result = migrateKnowledge({ projectPath: TEST_DIR });
    assert.strictEqual(result.conflicts.length, 1);
  });

  it('should leave originals untouched', () => {
    const skillDir = join(TEST_DIR, 'knowledge', 'skills', 'technology', 'express');
    mkdirSync(skillDir, { recursive: true });
    const originalContent = '# Express Patterns\n\n## Rules\n- Use Router()';
    writeFileSync(join(skillDir, 'SKILL.md'), originalContent);

    migrateKnowledge({ projectPath: TEST_DIR });

    const afterContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
    assert.strictEqual(afterContent, originalContent);
  });
});
