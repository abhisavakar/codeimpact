import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getKnowledgePaths,
  ensureKnowledgeWorkspace,
  createEmptyManifest,
  readManifest,
  writeManifest,
  toProjectRelative,
} from '../../src/core/knowledge/workspace.js';

const TEST_DIR = join(tmpdir(), 'codeimpact-test-workspace-' + Date.now());

describe('getKnowledgePaths', () => {
  it('should return correct path structure', () => {
    const paths = getKnowledgePaths('/some/project');

    assert.equal(paths.root, join('/some/project', 'knowledge'));
    assert.equal(paths.skillsRoot, join('/some/project', 'knowledge', 'skills'));
    assert.equal(paths.docsRoot, join('/some/project', 'knowledge', 'docs'));
    assert.ok(paths.indexPath.endsWith('index.json'));
  });

  it('should not include old scope-specific skill directories', () => {
    const paths = getKnowledgePaths('/project');

    assert.ok(!('coreSkillsRoot' in paths), 'Should not have coreSkillsRoot');
    assert.ok(!('techSkillsRoot' in paths), 'Should not have techSkillsRoot');
    assert.ok(!('featureSkillsRoot' in paths), 'Should not have featureSkillsRoot');
    assert.ok(!('riskSkillsRoot' in paths), 'Should not have riskSkillsRoot');
  });
});

describe('ensureKnowledgeWorkspace', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should create all required directories', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);

    assert.ok(existsSync(paths.root), 'knowledge/ should exist');
    assert.ok(existsSync(paths.skillsRoot), 'knowledge/skills/ should exist');
    assert.ok(existsSync(paths.docsRoot), 'knowledge/docs/ should exist');
    assert.ok(existsSync(paths.architectureDocsRoot), 'docs/architecture/ should exist');
    assert.ok(existsSync(paths.featureDocsRoot), 'docs/features/ should exist');
    assert.ok(existsSync(paths.integrationDocsRoot), 'docs/integrations/ should exist');
    assert.ok(existsSync(paths.changelogDocsRoot), 'docs/changelog/ should exist');
  });

  it('should be idempotent', () => {
    ensureKnowledgeWorkspace(TEST_DIR);
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    assert.ok(existsSync(paths.root));
  });
});

describe('createEmptyManifest', () => {
  it('should create manifest with version 2.0.0', () => {
    const manifest = createEmptyManifest('/project');

    assert.equal(manifest.version, '2.0.0');
    assert.equal(manifest.skills.length, 0);
    assert.equal(manifest.docs.length, 0);
    assert.equal(manifest.providers.length, 0);
    assert.ok(manifest.generatedAt);
  });

  it('should have no contentSource field in skills', () => {
    const manifest = createEmptyManifest('/project');
    const skillEntry = { name: 'test', description: 'desc', scope: 'core', file: 'x', updatedAt: '' };
    manifest.skills.push(skillEntry);

    assert.ok(!('contentSource' in skillEntry), 'Should not have contentSource');
    assert.ok(!('id' in skillEntry), 'Should not have old id field');
  });
});

describe('readManifest / writeManifest', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should create a new manifest if none exists', () => {
    const manifest = readManifest(TEST_DIR);

    assert.equal(manifest.version, '2.0.0');
    assert.equal(manifest.skills.length, 0);

    const paths = getKnowledgePaths(TEST_DIR);
    assert.ok(existsSync(paths.indexPath), 'Should write index.json');
  });

  it('should round-trip manifest correctly', () => {
    const manifest = createEmptyManifest(TEST_DIR);
    manifest.skills.push({
      name: 'test-skill',
      description: 'A test skill.',
      scope: 'technology',
      file: 'knowledge/skills/technology/test-skill/SKILL.md',
      updatedAt: '2026-01-01',
    });

    writeManifest(TEST_DIR, manifest);
    const loaded = readManifest(TEST_DIR);

    assert.equal(loaded.skills.length, 1);
    assert.equal(loaded.skills[0]!.name, 'test-skill');
    assert.equal(loaded.skills[0]!.description, 'A test skill.');
    assert.equal(loaded.skills[0]!.scope, 'technology');
  });

  it('should recover from corrupted manifest', () => {
    const paths = ensureKnowledgeWorkspace(TEST_DIR);
    writeFileSync(paths.indexPath, 'NOT VALID JSON!!!');

    const manifest = readManifest(TEST_DIR);
    assert.equal(manifest.version, '2.0.0');
    assert.equal(manifest.skills.length, 0);
  });
});

describe('toProjectRelative', () => {
  it('should produce forward-slash relative paths', () => {
    const result = toProjectRelative('/project', '/project/knowledge/skills/core/test/SKILL.md');
    assert.equal(result, 'knowledge/skills/core/test/SKILL.md');
  });
});
