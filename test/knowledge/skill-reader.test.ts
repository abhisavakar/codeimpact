import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillReader } from '../../src/core/knowledge/skill-reader.js';

const TEST_DIR = join(tmpdir(), 'codeimpact-test-reader-' + Date.now());

const SAMPLE_SKILL = `---
name: better-sqlite3-patterns
description: Synchronous database patterns. Use when working with database queries.
version: 1.0
metadata:
  scope: technology
  created_by: ai
  project: codeimpact
---

# better-sqlite3 Patterns

## When to Use
When modifying database queries, adding tables, or working with files that import from src/storage/database.ts.

## Key Facts
- Database: .codeimpact/codeimpact.db (SQLite, WAL mode)
- API: better-sqlite3 (synchronous, NOT async)

## Rules
- ALL database access goes through database.ts — never import better-sqlite3 directly.
- Use db.prepare().all() for SELECT, db.prepare().run() for INSERT/UPDATE/DELETE.

## Pitfalls
- db.exec() returns nothing. If you use it for SELECT, you get undefined.
- better-sqlite3 is synchronous. Do NOT wrap in async/await.

## Verification
- npx tsc --noEmit passes with no type errors on database code.
`;

const SAMPLE_SKILL_2 = `---
name: gateway-pattern
description: MCP gateway pattern for tool routing.
version: 1.0
---

# Gateway Pattern

## Rules
- Each gateway handles one MCP tool.
- Use a switch statement on the action parameter.
`;

function setupSkills() {
  const skillsRoot = join(TEST_DIR, 'knowledge', 'skills');

  const techDir = join(skillsRoot, 'technology', 'better-sqlite3-patterns');
  mkdirSync(techDir, { recursive: true });
  writeFileSync(join(techDir, 'SKILL.md'), SAMPLE_SKILL);

  const featureDir = join(skillsRoot, 'features', 'gateway-pattern');
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, 'SKILL.md'), SAMPLE_SKILL_2);
}

describe('SkillReader', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    setupSkills();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('readLevel0', () => {
    it('should return all skills with name and description only', () => {
      const reader = new SkillReader(TEST_DIR);
      const skills = reader.readLevel0();

      assert.equal(skills.length, 2, 'Should find 2 skills');

      const names = skills.map((s) => s.name).sort();
      assert.deepEqual(names, ['better-sqlite3-patterns', 'gateway-pattern']);

      const sqlite = skills.find((s) => s.name === 'better-sqlite3-patterns')!;
      assert.ok(sqlite.description.includes('Synchronous database patterns'));
      assert.equal(sqlite.version, '1.0');
      assert.ok(sqlite.filePath.endsWith('SKILL.md'));
    });

    it('should extract scope from directory name', () => {
      const reader = new SkillReader(TEST_DIR);
      const skills = reader.readLevel0();

      const sqlite = skills.find((s) => s.name === 'better-sqlite3-patterns')!;
      assert.equal(sqlite.scope, 'technology');

      const gateway = skills.find((s) => s.name === 'gateway-pattern')!;
      assert.equal(gateway.scope, 'feature');
    });

    it('should return empty array when no skills exist', () => {
      const emptyDir = join(TEST_DIR, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      const reader = new SkillReader(emptyDir);
      const skills = reader.readLevel0();
      assert.equal(skills.length, 0);
    });
  });

  describe('readLevel1', () => {
    it('should return full skill content including body and metadata', () => {
      const reader = new SkillReader(TEST_DIR);
      const skill = reader.readLevel1('better-sqlite3-patterns');

      assert.ok(skill, 'Should find the skill');
      assert.equal(skill!.name, 'better-sqlite3-patterns');
      assert.ok(skill!.body.includes('# better-sqlite3 Patterns'));
      assert.ok(skill!.body.includes('## Rules'));
      assert.ok(skill!.body.includes('db.prepare().all()'));
      assert.equal(skill!.metadata['scope'], 'technology');
      assert.equal(skill!.metadata['created_by'], 'ai');
      assert.equal(skill!.metadata['project'], 'codeimpact');
    });

    it('should return null for non-existent skill', () => {
      const reader = new SkillReader(TEST_DIR);
      const skill = reader.readLevel1('nonexistent-skill');
      assert.equal(skill, null);
    });

    it('should find by slug-matching', () => {
      const reader = new SkillReader(TEST_DIR);
      const skill = reader.readLevel1('Gateway Pattern');
      assert.ok(skill, 'Should find by slug match');
      assert.equal(skill!.name, 'gateway-pattern');
    });
  });

  describe('readAllSkills (SkillSnippet compat)', () => {
    it('should return SkillSnippet format for backward compatibility', () => {
      const reader = new SkillReader(TEST_DIR);
      const snippets = reader.readAllSkills();

      assert.ok(snippets.length >= 2, 'Should find at least 2 skills');

      for (const s of snippets) {
        assert.ok(s.id, 'Should have id');
        assert.ok(s.scope, 'Should have scope');
        assert.ok(s.content, 'Should have content');
        assert.ok(s.content.includes('---'), 'Content should include frontmatter');
      }
    });
  });

  describe('getSkillConstraints', () => {
    it('should extract rules from ## Rules sections', () => {
      const reader = new SkillReader(TEST_DIR);
      const constraints = reader.getSkillConstraints();

      assert.ok(constraints.length > 0, 'Should find constraints');
      const dbConstraint = constraints.find((c) => c.includes('database.ts'));
      assert.ok(dbConstraint, 'Should find the database.ts constraint');
    });
  });

  describe('getSkillVerifications', () => {
    it('should extract checks from ## Verification sections', () => {
      const reader = new SkillReader(TEST_DIR);
      const checks = reader.getSkillVerifications();

      assert.ok(checks.length > 0, 'Should find verification checks');
      const tscCheck = checks.find((c) => c.includes('tsc'));
      assert.ok(tscCheck, 'Should find the tsc check');
    });
  });

  describe('getSkillIndex', () => {
    it('should return name + description for progressive disclosure', () => {
      const reader = new SkillReader(TEST_DIR);
      const index = reader.getSkillIndex();

      assert.equal(index.length, 2);

      const sqlite = index.find((i) => i.id === 'better-sqlite3-patterns')!;
      assert.ok(sqlite, 'Should have sqlite skill');
      assert.ok(sqlite.summary.includes('Synchronous database'));
      assert.equal(sqlite.scope, 'technology');
    });
  });

  describe('findSkillsForFile', () => {
    it('should find skills that mention a file path', () => {
      const reader = new SkillReader(TEST_DIR);
      const skills = reader.findSkillsForFile('src/storage/database.ts');

      assert.ok(skills.length > 0, 'Should find at least one skill');
      assert.ok(skills.some((s) => s.id === 'better-sqlite3-patterns'));
    });

    it('should return empty for unmentioned files', () => {
      const reader = new SkillReader(TEST_DIR);
      const skills = reader.findSkillsForFile('src/totally-unknown-file.ts');
      assert.equal(skills.length, 0);
    });
  });

  describe('readSkillsByScope', () => {
    it('should filter by scope', () => {
      const reader = new SkillReader(TEST_DIR);

      const techSkills = reader.readSkillsByScope('technology');
      assert.ok(techSkills.length >= 1);
      assert.ok(techSkills.some((s) => s.id === 'better-sqlite3-patterns'));

      const featureSkills = reader.readSkillsByScope('feature');
      assert.ok(featureSkills.length >= 1);
      assert.ok(featureSkills.some((s) => s.id === 'gateway-pattern'));
    });
  });
});
