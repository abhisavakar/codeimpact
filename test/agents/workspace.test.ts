import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initAgentWorkspace,
  readAgentConfig,
  writeAgentConfig,
  readAgentIndex,
  writeAgentIndex,
  agentWorkspaceExists,
  updateMarkedSection,
  extractManualContent,
  DEFAULT_CONFIG,
} from '../../src/core/agents/workspace.js';
import type { AgentConfig } from '../../src/core/agents/types.js';

const TEST_DIR = join(tmpdir(), `codeimpact-test-${Date.now()}`);

describe('Agent Workspace', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('initAgentWorkspace', () => {
    it('should create all required directories', () => {
      const paths = initAgentWorkspace(TEST_DIR);
      assert.ok(existsSync(paths.root));
      assert.ok(existsSync(paths.projectDir));
      assert.ok(existsSync(paths.researchDir));
      assert.ok(existsSync(paths.featuresDir));
    });

    it('should create config.yaml with defaults', () => {
      const paths = initAgentWorkspace(TEST_DIR);
      assert.ok(existsSync(paths.configPath));
      const content = readFileSync(paths.configPath, 'utf-8');
      assert.ok(content.includes('version: 1'));
      assert.ok(content.includes('branch: code-impact/skills'));
    });

    it('should create index.json', () => {
      const paths = initAgentWorkspace(TEST_DIR);
      assert.ok(existsSync(paths.indexPath));
      const index = JSON.parse(readFileSync(paths.indexPath, 'utf-8'));
      assert.strictEqual(index.version, '3.0.0');
    });

    it('should be idempotent', () => {
      initAgentWorkspace(TEST_DIR);
      initAgentWorkspace(TEST_DIR); // second call should not throw
      assert.ok(agentWorkspaceExists(TEST_DIR));
    });
  });

  describe('readAgentConfig / writeAgentConfig', () => {
    it('should return defaults when no config exists', () => {
      const config = readAgentConfig(TEST_DIR);
      assert.strictEqual(config.version, 1);
      assert.strictEqual(config.branch, 'code-impact/skills');
      assert.strictEqual(config.auto_research, true);
    });

    it('should write and read back config correctly', () => {
      const config: AgentConfig = {
        ...DEFAULT_CONFIG,
        branch: 'custom/branch',
        auto_research: false,
      };
      initAgentWorkspace(TEST_DIR);
      writeAgentConfig(TEST_DIR, config);
      const readBack = readAgentConfig(TEST_DIR);
      assert.strictEqual(readBack.branch, 'custom/branch');
      assert.strictEqual(readBack.auto_research, false);
    });
  });

  describe('readAgentIndex / writeAgentIndex', () => {
    it('should return empty index when none exists', () => {
      const index = readAgentIndex(TEST_DIR);
      assert.strictEqual(index.version, '3.0.0');
      assert.deepStrictEqual(index.technologies, []);
      assert.deepStrictEqual(index.features, []);
    });

    it('should persist index changes', () => {
      initAgentWorkspace(TEST_DIR);
      const index = readAgentIndex(TEST_DIR);
      index.technologies.push({
        name: 'express',
        version: '4.21.0',
        source: 'package-lock.json',
      });
      writeAgentIndex(TEST_DIR, index);

      const readBack = readAgentIndex(TEST_DIR);
      assert.strictEqual(readBack.technologies.length, 1);
      assert.strictEqual(readBack.technologies[0]!.name, 'express');
    });
  });

  describe('updateMarkedSection', () => {
    const markers = DEFAULT_CONFIG.markers;

    it('should wrap content in markers for empty file', () => {
      const result = updateMarkedSection('', 'new content', markers);
      assert.ok(result.includes(markers.start));
      assert.ok(result.includes('new content'));
      assert.ok(result.includes(markers.end));
    });

    it('should replace existing marked section', () => {
      const existing = `# Title\n\n${markers.start}\nold content\n${markers.end}\n\n## Footer`;
      const result = updateMarkedSection(existing, 'new content', markers);
      assert.ok(result.includes('new content'));
      assert.ok(!result.includes('old content'));
      assert.ok(result.includes('# Title'));
      assert.ok(result.includes('## Footer'));
    });

    it('should preserve content outside markers', () => {
      const existing = `# Manual Header\n\n${markers.start}\nauto\n${markers.end}\n\n## Manual Footer`;
      const result = updateMarkedSection(existing, 'updated auto', markers);
      assert.ok(result.includes('# Manual Header'));
      assert.ok(result.includes('## Manual Footer'));
      assert.ok(result.includes('updated auto'));
    });

    it('should append markers if none exist', () => {
      const existing = '# Existing content\n\nSome text';
      const result = updateMarkedSection(existing, 'auto section', markers);
      assert.ok(result.includes('# Existing content'));
      assert.ok(result.includes('auto section'));
      assert.ok(result.includes(markers.start));
    });
  });

  describe('extractManualContent', () => {
    const markers = DEFAULT_CONFIG.markers;

    it('should extract before/after marker content', () => {
      const content = `Before\n\n${markers.start}\nauto\n${markers.end}\n\nAfter`;
      const { before, after } = extractManualContent(content, markers);
      assert.strictEqual(before, 'Before');
      assert.strictEqual(after, 'After');
    });

    it('should return full content as before if no markers', () => {
      const content = 'Full manual content';
      const { before, after } = extractManualContent(content, markers);
      assert.strictEqual(before, 'Full manual content');
      assert.strictEqual(after, '');
    });
  });
});
