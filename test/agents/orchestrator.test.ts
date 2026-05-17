import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { agentsInit, agentsGenerate, agentsStatus } from '../../src/core/agents/orchestrator.js';
import { readAgentConfig, writeAgentConfig } from '../../src/core/agents/workspace.js';

const TEST_DIR = join(tmpdir(), `codeimpact-orch-test-${Date.now()}`);

describe('Agent Orchestrator', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Create a minimal project structure
    mkdirSync(join(TEST_DIR, 'src/auth'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/api'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/db'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/auth/login.ts'), 'export function login() {}');
    writeFileSync(join(TEST_DIR, 'src/auth/register.ts'), 'export function register() {}');
    writeFileSync(join(TEST_DIR, 'src/auth/middleware.ts'), 'export function authMiddleware() {}');
    writeFileSync(join(TEST_DIR, 'src/api/routes.ts'), 'export const routes = [];');
    writeFileSync(join(TEST_DIR, 'src/api/handlers.ts'), 'export function handle() {}');
    writeFileSync(join(TEST_DIR, 'src/api/middleware.ts'), 'export function apiMiddleware() {}');
    writeFileSync(join(TEST_DIR, 'src/db/client.ts'), 'export const db = {};');
    writeFileSync(join(TEST_DIR, 'src/db/models.ts'), 'export const models = {};');
    writeFileSync(join(TEST_DIR, 'src/db/migrations.ts'), 'export const migrations = {};');
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: { express: '^4.21.0', prisma: '^5.0.0' },
      devDependencies: { typescript: '^5.7.0', vitest: '^2.1.0' },
    }));
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('agentsInit', () => {
    it('should initialize workspace correctly', () => {
      const result = agentsInit(TEST_DIR);
      assert.strictEqual(result.success, true);
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'config.yaml')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'index.json')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'project')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'research')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'features')));
    });
  });

  describe('agentsGenerate', () => {
    it('should detect technologies from package.json', async () => {
      const result = await agentsGenerate({
        projectPath: TEST_DIR,
      });
      assert.strictEqual(result.success, true);
      assert.ok(result.technologies >= 3); // express, prisma, typescript, vitest
    });

    it('should detect features from directory structure', async () => {
      const result = await agentsGenerate({
        projectPath: TEST_DIR,
      });
      assert.ok(result.features >= 2); // auth, api, db
    });

    it('should generate project-level files', async () => {
      await agentsGenerate({ projectPath: TEST_DIR });
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'project', 'SKILL.md')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'project', 'CONVENTIONS.md')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'project', 'ARCHITECTURE.md')));
      assert.ok(existsSync(join(TEST_DIR, '.code-impact', 'project', 'AGENT.md')));
    });

    it('should generate feature-level files', async () => {
      await agentsGenerate({ projectPath: TEST_DIR });
      const featuresDir = join(TEST_DIR, '.code-impact', 'features');
      assert.ok(existsSync(featuresDir));
      // Should have at least auth feature
      const authSkill = join(featuresDir, 'auth', 'SKILL.md');
      const authAgent = join(featuresDir, 'auth', 'AGENT.md');
      assert.ok(existsSync(authSkill));
      assert.ok(existsSync(authAgent));
    });

    it('should generate AGENTS.md shim', async () => {
      await agentsGenerate({ projectPath: TEST_DIR });
      const agentsPath = join(TEST_DIR, 'AGENTS.md');
      assert.ok(existsSync(agentsPath));
      const content = readFileSync(agentsPath, 'utf-8');
      assert.ok(content.includes('CodeImpact Agent System'));
      assert.ok(content.includes('project-coordinator'));
    });

    it('should not research when auto_research is false', async () => {
      agentsInit(TEST_DIR);
      const config = readAgentConfig(TEST_DIR);
      config.auto_research = false;
      writeAgentConfig(TEST_DIR, config);

      const result = await agentsGenerate({ projectPath: TEST_DIR });
      assert.strictEqual(result.researchResults, undefined);
    });

    it('should preserve manual content on regeneration', async () => {
      // First generation
      await agentsGenerate({ projectPath: TEST_DIR });

      // Add manual content to a feature SKILL
      const featuresDir = join(TEST_DIR, '.code-impact', 'features');
      const authSkillPath = join(featuresDir, 'auth', 'SKILL.md');
      if (existsSync(authSkillPath)) {
        const content = readFileSync(authSkillPath, 'utf-8');
        const updated = content + '\n## My Manual Section\nThis should be preserved\n';
        writeFileSync(authSkillPath, updated);
      }

      // Second generation
      await agentsGenerate({ projectPath: TEST_DIR });

      // Manual content should still be there
      if (existsSync(authSkillPath)) {
        const content = readFileSync(authSkillPath, 'utf-8');
        assert.ok(content.includes('My Manual Section'));
        assert.ok(content.includes('This should be preserved'));
      }
    });
  });

  describe('agentsStatus', () => {
    it('should report uninitialized state', () => {
      const status = agentsStatus(TEST_DIR);
      assert.strictEqual(status.initialized, false);
    });

    it('should report initialized state after init', () => {
      agentsInit(TEST_DIR);
      const status = agentsStatus(TEST_DIR);
      assert.strictEqual(status.initialized, true);
    });

    it('should report correct counts after generate', async () => {
      await agentsGenerate({ projectPath: TEST_DIR });
      const status = agentsStatus(TEST_DIR);
      assert.strictEqual(status.initialized, true);
      assert.ok(status.technologies >= 3);
      assert.ok(status.features >= 2);
    });
  });
});
