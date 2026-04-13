import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PlatformRuleSync } from '../../src/core/knowledge/platform-sync.js';
import { ensureKnowledgeWorkspace } from '../../src/core/knowledge/workspace.js';

const TEST_DIR = join(tmpdir(), 'codeimpact-test-platform-' + Date.now());

describe('PlatformRuleSync', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should create platform rule files with agentskills.io format example', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);
    const skillIndex = [
      'better-sqlite3-patterns: Synchronous database patterns for this project.',
      'gateway-pattern: MCP gateway pattern for tool routing.',
    ];

    const results = sync.syncAll(paths, skillIndex);

    assert.ok(results.length === 6, 'Should sync 6 platform files');
    assert.ok(results.some((r) => r.updated), 'At least one should be updated');

    const cursorrules = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(cursorrules.includes('agentskills.io SKILL.md'), 'Should mention agentskills.io format');
    assert.ok(cursorrules.includes('better-sqlite3-patterns'), 'Should list skills');
    assert.ok(cursorrules.includes('gateway-pattern'), 'Should list skills');
    assert.ok(cursorrules.includes('mcp_codeimpact_memory_evolve'), 'Should use cursor tool names');
    assert.ok(cursorrules.includes('create_skill'), 'Should have creation protocol');
    assert.ok(cursorrules.includes('improve_skill'), 'Should have improvement protocol');
    assert.ok(cursorrules.includes('list_signals'), 'Should reference list_signals');
  });

  it('should use correct tool names for each platform', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);

    sync.syncAll(paths, ['test-skill: Test.']);

    const cursor = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(cursor.includes('mcp_codeimpact_memory_query'), 'Cursor format');

    const claude = readFileSync(join(TEST_DIR, 'CLAUDE.md'), 'utf-8');
    assert.ok(claude.includes('mcp__codeimpact__memory_query'), 'Claude format');

    const codex = readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf-8');
    assert.ok(codex.includes('codeimpact memory-query'), 'Codex format');
  });

  it('should show empty state message when no skills exist', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);

    sync.syncAll(paths, []);

    const content = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(content.includes('No skills yet'), 'Should show empty state');
  });

  it('should preserve existing content outside managed markers', () => {
    const cursorPath = join(TEST_DIR, '.cursorrules');
    writeFileSync(cursorPath, '# My Custom Rules\n\nDo not remove this.\n');

    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);
    sync.syncAll(paths, ['test: Test skill.']);

    const content = readFileSync(cursorPath, 'utf-8');
    assert.ok(content.includes('My Custom Rules'), 'Should preserve custom rules');
    assert.ok(content.includes('Do not remove this'), 'Should preserve custom content');
    assert.ok(content.includes('codeimpact:knowledge:start'), 'Should have managed section');
  });

  it('should replace managed section on subsequent syncs', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);

    sync.syncAll(paths, ['skill-a: First skill.']);
    sync.syncAll(paths, ['skill-b: Second skill.']);

    const content = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(!content.includes('skill-a'), 'Old skill should be gone');
    assert.ok(content.includes('skill-b'), 'New skill should be present');
  });

  it('should support dryRun mode', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);

    const results = sync.syncAll(paths, ['test: Test.'], { dryRun: true });

    assert.ok(results.every((r) => r.mode === 'created'), 'Should report created');
    assert.ok(!existsSync(join(TEST_DIR, 'AGENTS.md')), 'Should not write AGENTS.md in dryRun');
  });

  it('should include evolution guidance when provided', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);

    sync.syncAll(paths, ['test: Test.'], {
      evolutionGuidance: ['sqlite-patterns: negative score impact (avg -8)'],
    });

    const content = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(content.includes('Skills Needing Attention'), 'Should have attention section');
    assert.ok(content.includes('negative score impact'), 'Should include guidance');
  });

  it('should include quality rules for skill creation', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);
    sync.syncAll(paths, []);

    const content = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(content.includes('Under 5000 tokens'), 'Should have token limit guideline');
    assert.ok(content.includes('Be specific'), 'Should have specificity guideline');
    assert.ok(content.includes('Pitfalls with symptoms'), 'Should have pitfall guideline');
  });

  it('should not reference scaffolds anywhere', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    const sync = new PlatformRuleSync(TEST_DIR);
    sync.syncAll(paths, ['test: Test.']);

    const content = readFileSync(join(TEST_DIR, '.cursorrules'), 'utf-8');
    assert.ok(!content.includes('scaffold'), 'Should not mention scaffolds');
    assert.ok(!content.includes('list_scaffolds'), 'Should not reference list_scaffolds');
  });
});
