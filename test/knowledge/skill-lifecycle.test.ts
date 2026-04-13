import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeSkillMd, type SkillMdInput } from '../../src/core/knowledge/skill-generator.js';
import { SkillReader } from '../../src/core/knowledge/skill-reader.js';
import { readManifest, writeManifest, toProjectRelative } from '../../src/core/knowledge/workspace.js';

const TEST_DIR = join(tmpdir(), 'codeimpact-test-lifecycle-' + Date.now());

describe('Skill Lifecycle (end-to-end)', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should create a skill, read it back at Level 0 and Level 1, and find it in index', () => {
    const input: SkillMdInput = {
      name: 'express-middleware',
      description: 'Express middleware patterns. Use when adding new middleware or modifying the request pipeline.',
      version: '1.0',
      scope: 'technology',
      metadata: {
        project: 'myapp',
        created_by: 'ai',
        scope: 'technology',
      },
      body: `# Express Middleware Patterns

## When to Use
When adding, modifying, or debugging Express middleware in src/server/.

## Key Facts
- Middleware runs in order of app.use() registration.
- Error handlers must have 4 parameters: (err, req, res, next).

## Rules
- Always call next() unless sending a response.
- Place auth middleware before route handlers.
- Use express.json() before any body-parsing routes.

## Pitfalls
- Forgetting next() causes requests to hang with no error.
- Putting error handler before routes means it never catches anything.
- Using async middleware without try/catch leads to unhandled rejections.

## Verification
- npm test passes with all middleware tests.
- No hanging requests in integration tests.`,
    };

    const skillPath = writeSkillMd(TEST_DIR, input);
    assert.ok(existsSync(skillPath), 'Skill file should exist');

    const manifest = readManifest(TEST_DIR);
    manifest.skills.push({
      name: input.name,
      description: input.description,
      scope: input.scope,
      file: toProjectRelative(TEST_DIR, skillPath),
      updatedAt: new Date().toISOString(),
    });
    writeManifest(TEST_DIR, manifest);

    const reader = new SkillReader(TEST_DIR);

    const level0 = reader.readLevel0();
    assert.equal(level0.length, 1, 'Should find 1 skill');
    assert.equal(level0[0]!.name, 'express-middleware');
    assert.ok(level0[0]!.description.includes('Express middleware patterns'));

    const level1 = reader.readLevel1('express-middleware');
    assert.ok(level1, 'Level 1 should return the skill');
    assert.ok(level1!.body.includes('# Express Middleware Patterns'));
    assert.ok(level1!.body.includes('Forgetting next()'));
    assert.equal(level1!.metadata['created_by'], 'ai');
    assert.equal(level1!.metadata['project'], 'myapp');

    const index = reader.getSkillIndex();
    assert.equal(index.length, 1);
    assert.equal(index[0]!.id, 'express-middleware');
    assert.ok(index[0]!.summary.includes('Express middleware'));
  });

  it('should handle multiple skills across different scopes', () => {
    const skills: SkillMdInput[] = [
      {
        name: 'auth-patterns',
        description: 'Authentication patterns.',
        scope: 'feature',
        body: '# Auth\n\n## Rules\n- Use JWT tokens.',
      },
      {
        name: 'sqlite-patterns',
        description: 'Database patterns.',
        scope: 'technology',
        body: '# SQLite\n\n## Rules\n- Use prepared statements.',
      },
      {
        name: 'high-risk-engine',
        description: 'Engine file is high-risk.',
        scope: 'risk',
        body: '# Engine Risk\n\n## Rules\n- Get review before changing.',
      },
      {
        name: 'code-review',
        description: 'Code review checklist.',
        scope: 'core',
        body: '# Code Review\n\n## Rules\n- Run tests before PR.',
      },
    ];

    for (const s of skills) {
      writeSkillMd(TEST_DIR, s);
    }

    const reader = new SkillReader(TEST_DIR);
    const all = reader.readLevel0();
    assert.equal(all.length, 4, 'Should find all 4 skills');

    const scopes = new Set(all.map((s) => s.scope));
    assert.ok(scopes.has('feature') || scopes.has('features'));
    assert.ok(scopes.has('technology'));
    assert.ok(scopes.has('risk'));
    assert.ok(scopes.has('core'));
  });

  it('should find skills relevant to a file path', () => {
    writeSkillMd(TEST_DIR, {
      name: 'api-routes',
      description: 'API routing patterns.',
      scope: 'feature',
      body: '# API Routes\n\n## When to Use\nWhen working with src/server/routes/api.ts.\n\n## Rules\n- Use express Router.',
    });

    writeSkillMd(TEST_DIR, {
      name: 'db-patterns',
      description: 'Database patterns.',
      scope: 'technology',
      body: '# DB\n\n## When to Use\nWhen working with src/storage/database.ts.',
    });

    const reader = new SkillReader(TEST_DIR);

    const apiSkills = reader.findSkillsForFile('src/server/routes/api.ts');
    assert.ok(apiSkills.length >= 1, 'Should find API skill');
    assert.ok(apiSkills.some((s) => s.id === 'api-routes'));

    const dbSkills = reader.findSkillsForFile('src/storage/database.ts');
    assert.ok(dbSkills.length >= 1, 'Should find DB skill');
    assert.ok(dbSkills.some((s) => s.id === 'db-patterns'));

    const noSkills = reader.findSkillsForFile('src/unknown/file.ts');
    assert.equal(noSkills.length, 0);
  });

  it('should extract constraints and verifications from SKILL.md format', () => {
    writeSkillMd(TEST_DIR, {
      name: 'test-extraction',
      description: 'Test constraint extraction.',
      scope: 'core',
      body: `# Test Extraction

## Rules
- Never commit secrets to git.
- Always run lint before push.

## Verification
- npm run lint passes.
- No .env files in staged changes.`,
    });

    const reader = new SkillReader(TEST_DIR);

    const constraints = reader.getSkillConstraints();
    assert.ok(constraints.length >= 2, 'Should find at least 2 constraints');
    assert.ok(constraints.some((c) => c.includes('Never commit secrets')));
    assert.ok(constraints.some((c) => c.includes('Always run lint')));

    const verifications = reader.getSkillVerifications();
    assert.ok(verifications.length >= 2, 'Should find at least 2 verifications');
    assert.ok(verifications.some((v) => v.includes('npm run lint')));
    assert.ok(verifications.some((v) => v.includes('.env files')));
  });
});
