import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { renderSkillMd, getSkillPath, writeSkillMd, type SkillMdInput } from '../../src/core/knowledge/skill-generator.js';

const TEST_DIR = join(tmpdir(), 'codeimpact-test-skillgen-' + Date.now());

describe('renderSkillMd', () => {
  it('should produce valid YAML frontmatter + markdown body', () => {
    const input: SkillMdInput = {
      name: 'express-patterns',
      description: 'Express.js routing patterns for this project.',
      scope: 'technology',
      body: '# Express Patterns\n\n## Rules\n- Use router.get() not app.get().',
    };

    const output = renderSkillMd(input);

    assert.ok(output.startsWith('---\n'), 'Should start with frontmatter delimiter');
    assert.ok(output.includes('name: express-patterns'), 'Should contain name');
    assert.ok(output.includes('description: Express.js routing patterns'), 'Should contain description');
    assert.ok(output.includes('version: 1.0'), 'Should have default version');
    assert.ok(output.includes('# Express Patterns'), 'Should contain body');
    assert.ok(output.includes('- Use router.get() not app.get()'), 'Should contain rules');

    const fmEnd = output.indexOf('---', 3);
    assert.ok(fmEnd > 0, 'Should have closing frontmatter delimiter');
  });

  it('should include metadata block when provided', () => {
    const input: SkillMdInput = {
      name: 'sqlite-patterns',
      description: 'Database patterns.',
      scope: 'technology',
      metadata: { project: 'codeimpact', created_by: 'ai' },
      body: '# SQLite',
    };

    const output = renderSkillMd(input);

    assert.ok(output.includes('metadata:'), 'Should have metadata block');
    assert.ok(output.includes('  project: codeimpact'), 'Should have project metadata');
    assert.ok(output.includes('  created_by: ai'), 'Should have created_by metadata');
  });

  it('should use custom version when provided', () => {
    const input: SkillMdInput = {
      name: 'test-skill',
      description: 'Test.',
      version: '2.5',
      scope: 'core',
      body: '# Test',
    };

    const output = renderSkillMd(input);
    assert.ok(output.includes('version: 2.5'));
  });

  it('should omit metadata block when no metadata', () => {
    const input: SkillMdInput = {
      name: 'minimal',
      description: 'Minimal skill.',
      scope: 'feature',
      body: '# Minimal',
    };

    const output = renderSkillMd(input);
    assert.ok(!output.includes('metadata:'), 'Should not have metadata block');
  });
});

describe('getSkillPath', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should place technology skills in technology/ directory', () => {
    const path = getSkillPath(TEST_DIR, 'express-patterns', 'technology');
    assert.ok(path.includes('technology'), 'Path should contain technology');
    assert.ok(path.endsWith('SKILL.md'), 'Path should end with SKILL.md');
    assert.ok(path.includes('express-patterns'), 'Path should contain slugified name');
  });

  it('should place core skills in core/ directory', () => {
    const path = getSkillPath(TEST_DIR, 'Code Review', 'core');
    assert.ok(path.includes('core'), 'Path should contain core');
    assert.ok(path.includes('code-review'), 'Should slugify name');
  });

  it('should place feature skills in features/ directory', () => {
    const path = getSkillPath(TEST_DIR, 'gateway-pattern', 'feature');
    assert.ok(path.includes('features'), 'Path should contain features');
  });

  it('should place risk skills in risk/ directory', () => {
    const path = getSkillPath(TEST_DIR, 'high-risk-files', 'risk');
    assert.ok(path.includes('risk'), 'Path should contain risk');
  });
});

describe('writeSkillMd', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should write a SKILL.md file to the correct location', () => {
    const input: SkillMdInput = {
      name: 'test-write-skill',
      description: 'Testing write functionality.',
      scope: 'technology',
      metadata: { created_by: 'ai' },
      body: '# Test Write\n\n## Rules\n- Test rule one.\n- Test rule two.',
    };

    const path = writeSkillMd(TEST_DIR, input);

    assert.ok(existsSync(path), 'File should exist on disk');
    assert.ok(path.endsWith('SKILL.md'), 'Should be SKILL.md');

    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('name: test-write-skill'));
    assert.ok(content.includes('# Test Write'));
    assert.ok(content.includes('- Test rule one.'));
  });

  it('should create nested directories as needed', () => {
    const input: SkillMdInput = {
      name: 'deeply-nested',
      description: 'Test nesting.',
      scope: 'feature',
      body: '# Nested',
    };

    const path = writeSkillMd(TEST_DIR, input);
    assert.ok(existsSync(path));
  });
});
