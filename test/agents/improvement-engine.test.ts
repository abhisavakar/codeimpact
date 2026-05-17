import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { learnFromOutcome, runImprovementEngine, promoteLessons, decayOldLessons } from '../../src/core/agents/improvement-engine.js';
import { createOutcomeTable, recordOutcome, queryOutcomes } from '../../src/core/agents/outcome-storage.js';
import { initAgentWorkspace, readAgentConfig, readAgentIndex, DEFAULT_CONFIG } from '../../src/core/agents/workspace.js';
import type { OutcomeRecord } from '../../src/core/agents/types.js';

const TEST_DIR = join(tmpdir(), `codeimpact-improve-test-${Date.now()}`);
let db: Database.Database;

describe('Self-Improving Engine', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    initAgentWorkspace(TEST_DIR);
    db = new Database(':memory:');
    createOutcomeTable(db);

    // Create feature agent files for testing
    const featuresDir = join(TEST_DIR, '.code-impact', 'features', 'auth');
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(join(featuresDir, 'AGENT.md'), [
      '---',
      'name: auth-agent',
      'type: feature-agent',
      '---',
      '',
      '# Auth Agent',
      '',
      '## Scope',
      '- **Included paths**: src/auth/**',
      '',
      '<!-- code-impact:auto-start -->',
      '## Lessons Learned',
      '[No lessons recorded yet]',
      '<!-- code-impact:auto-end -->',
    ].join('\n'));

    writeFileSync(join(featuresDir, 'SKILL.md'), [
      '---',
      'name: auth-feature',
      '---',
      '',
      '# Auth Feature',
      '',
      '<!-- code-impact:auto-start -->',
      '## Key Facts',
      '- Uses JWT tokens',
      '',
      '## Rules',
      '- Always validate tokens',
      '<!-- code-impact:auto-end -->',
    ].join('\n'));

    // Create project agent
    const projectDir = join(TEST_DIR, '.code-impact', 'project');
    writeFileSync(join(projectDir, 'AGENT.md'), [
      '---',
      'name: project-coordinator',
      '---',
      '',
      '# Project Coordinator',
      '',
      '<!-- code-impact:auto-start -->',
      '## Lessons Learned',
      '[No lessons recorded yet]',
      '<!-- code-impact:auto-end -->',
    ].join('\n'));

    writeFileSync(join(projectDir, 'SKILL.md'), [
      '---',
      'name: project-skill',
      '---',
      '',
      '# Project Skill',
      '',
      '<!-- code-impact:auto-start -->',
      '## Rules',
      '- Follow ESM conventions',
      '<!-- code-impact:auto-end -->',
    ].join('\n'));
  });

  afterEach(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('learnFromOutcome — immediate learning', () => {
    it('should handle successful outcomes by confirming lessons', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix token validation',
        result: 'success',
        relatedSkills: ['auth-feature'],
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.strictEqual(result.learned, true);
      assert.strictEqual(result.action, 'no-action');
    });

    it('should diagnose import errors as outdated-research', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'add passport strategy',
        result: 'failure',
        errorMessage: "Cannot find module 'passport-oauth2'",
        errorFile: 'src/auth/oauth.ts',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.ok(result.diagnosis);
      assert.strictEqual(result.diagnosis.category, 'outdated-research');
    });

    it('should diagnose type errors as wrong-assumption', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'update token handler',
        result: 'failure',
        errorMessage: "Property 'verify' does not exist on type 'JWT'",
        errorFile: 'src/auth/token.ts',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.ok(result.diagnosis);
      assert.strictEqual(result.diagnosis.category, 'wrong-assumption');
    });

    it('should patch skill immediately when fix is provided', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix jwt verification',
        result: 'failure',
        errorMessage: "Property 'decode' does not exist on type 'JwtService'",
        errorFile: 'src/auth/jwt.ts',
        fixApplied: 'Use jwt.verify() instead of jwt.decode() for signature validation',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.strictEqual(result.action, 'skill-patched');

      // Verify the SKILL.md was actually patched
      const skillContent = readFileSync(join(TEST_DIR, '.code-impact', 'features', 'auth', 'SKILL.md'), 'utf-8');
      assert.ok(skillContent.includes('Pitfalls'));
      assert.ok(skillContent.includes('does not exist on type'));
    });

    it('should wait for recurrence when no clear evidence', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix login bug',
        result: 'failure',
        errorMessage: 'Connection timeout during auth flow',
        errorFile: 'src/auth/login.ts',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.strictEqual(result.action, 'waiting-for-recurrence');
    });

    it('should trigger re-research for outdated tech', () => {
      // Create research dir
      const researchDir = join(TEST_DIR, '.code-impact', 'research');
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(join(researchDir, 'passport@0.7.md'), '# Passport docs');

      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'add google auth',
        result: 'failure',
        errorMessage: "Cannot find module 'passport-google-oauth20'",
        errorFile: 'src/auth/google.ts',
        relatedResearch: ['research/passport@0.7.md'],
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.strictEqual(result.action, 're-research-triggered');

      // Verify index was flagged
      const index = readAgentIndex(TEST_DIR);
      assert.strictEqual(index.lastResearch['passport'], '1970-01-01T00:00:00Z');
    });

    it('should detect scope errors', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix billing issue',
        result: 'failure',
        errorMessage: 'Permission denied modifying billing module',
        errorFile: 'src/billing/stripe.ts', // Outside auth scope
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.ok(result.diagnosis);
      assert.strictEqual(result.diagnosis.category, 'scope-error');
    });
  });

  describe('runImprovementEngine — batch processing', () => {
    it('should process multiple undiagnosed failures', () => {
      // Record several failures
      recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix token',
        result: 'failure',
        errorMessage: "Type 'string' is not assignable to type 'Token'",
        errorFile: 'src/auth/token.ts',
        fixApplied: 'Cast string to Token type',
      });
      recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix middleware',
        result: 'failure',
        errorMessage: "Type 'string' is not assignable to type 'Middleware'",
        errorFile: 'src/auth/middleware.ts',
        fixApplied: 'Import correct type',
      });

      const result = runImprovementEngine(db, TEST_DIR);
      assert.ok(result.diagnosed >= 1);
    });

    it('should respect rate limits (max 3 per agent per day)', () => {
      // Record 5 failures with clear evidence
      for (let i = 0; i < 5; i++) {
        recordOutcome(db, {
          agent: 'auth-agent',
          task: `task ${i}`,
          result: 'failure',
          errorMessage: `Error ${i}: property X${i} does not exist on type Y`,
          errorFile: `src/auth/file${i}.ts`,
          fixApplied: `Fix ${i}`,
        });
      }

      const result = runImprovementEngine(db, TEST_DIR);
      // Some should be rate-limited
      assert.ok(result.diagnosed >= 3);
    });

    it('should return empty result when no failures', () => {
      const result = runImprovementEngine(db, TEST_DIR);
      assert.strictEqual(result.diagnosed, 0);
      assert.strictEqual(result.lessonsAdded, 0);
    });
  });

  describe('promoteLessons — quarantine to rules', () => {
    it('should not promote lessons with fewer than 3 confirmations', () => {
      // Add a lesson manually
      const agentPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'AGENT.md');
      const content = readFileSync(agentPath, 'utf-8');
      const updated = content.replace('[No lessons recorded yet]',
        '- 2026-05-10: Always check token expiry before using payload (outcome: abc12345)');
      writeFileSync(agentPath, updated);

      const promoted = promoteLessons(db, TEST_DIR);
      assert.strictEqual(promoted, 0); // Not enough confirmations
    });

    it('should promote lesson to Rules after 3 confirmed similar outcomes', () => {
      // Use type errors (wrong-assumption, no fixApplied) → targets feature AGENT.md
      // Need 4 similar failures: first 2 wait for recurrence, 3rd writes lesson, all get diagnosed
      const errors = [
        "Type 'string' is not assignable to type 'SessionToken' in auth handler",
        "Type 'string' is not assignable to type 'SessionToken' in login flow",
        "Type 'string' is not assignable to type 'SessionToken' in middleware",
        "Type 'string' is not assignable to type 'SessionToken' in validation",
      ];

      for (let i = 0; i < errors.length; i++) {
        const outcome = recordOutcome(db, {
          agent: 'auth-agent',
          task: `fix token type error ${i}`,
          result: 'failure',
          errorMessage: errors[i],
          errorFile: 'src/auth/token.ts',
        });
        learnFromOutcome(db, TEST_DIR, outcome);
      }

      // Verify that a lesson was written to feature AGENT.md
      const agentPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'AGENT.md');
      const agentContent = readFileSync(agentPath, 'utf-8');
      assert.ok(
        agentContent.includes('Type error') || agentContent.includes('not assignable'),
        'AGENT.md should contain a lesson about the type error',
      );

      // Now run promoteLessons — should find 3+ confirmations and promote
      const promoted = promoteLessons(db, TEST_DIR);
      assert.ok(promoted >= 1, `Expected at least 1 promotion but got ${promoted}`);

      // Verify the SKILL.md got the promoted rule
      const skillPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'SKILL.md');
      const skillContent = readFileSync(skillPath, 'utf-8');
      assert.ok(skillContent.includes('## Rules'), 'SKILL.md should have Rules section');

      // Verify the lesson is marked as promoted in AGENT.md
      const finalAgent = readFileSync(agentPath, 'utf-8');
      assert.ok(finalAgent.includes('[promoted]'), 'Lesson should be marked as [promoted]');
    });
  });

  describe('decayOldLessons', () => {
    it('should mark old lessons as unconfirmed', () => {
      const agentPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'AGENT.md');
      const content = readFileSync(agentPath, 'utf-8');
      // Add an old lesson (simulating 100 days ago)
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const updated = content.replace('[No lessons recorded yet]',
        `- ${oldDate}: Old lesson about token validation (outcome: xyz78901)`);
      writeFileSync(agentPath, updated);

      const decayed = decayOldLessons(TEST_DIR, 90);
      assert.strictEqual(decayed, 1);

      // Verify the content was updated
      const result = readFileSync(agentPath, 'utf-8');
      assert.ok(result.includes('[unconfirmed]'));
    });

    it('should not decay recent lessons', () => {
      const agentPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'AGENT.md');
      const content = readFileSync(agentPath, 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      const updated = content.replace('[No lessons recorded yet]',
        `- ${today}: Recent lesson about validation (outcome: rec12345)`);
      writeFileSync(agentPath, updated);

      const decayed = decayOldLessons(TEST_DIR, 90);
      assert.strictEqual(decayed, 0);
    });

    it('should not re-decay already marked lessons', () => {
      const agentPath = join(TEST_DIR, '.code-impact', 'features', 'auth', 'AGENT.md');
      const content = readFileSync(agentPath, 'utf-8');
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const updated = content.replace('[No lessons recorded yet]',
        `- ${oldDate}: Already marked lesson (outcome: xyz) [unconfirmed]`);
      writeFileSync(agentPath, updated);

      const decayed = decayOldLessons(TEST_DIR, 90);
      assert.strictEqual(decayed, 0); // Already marked
    });
  });

  describe('Known mistake patterns', () => {
    it('should detect ESM/require mismatch', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'add dependency',
        result: 'failure',
        errorMessage: 'ERR_REQUIRE_ESM: require() of ES Module not supported',
        errorFile: 'src/auth/utils.ts',
        fixApplied: 'Use import instead of require',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.ok(result.diagnosis);
      assert.strictEqual(result.diagnosis.category, 'wrong-assumption');
      assert.ok(result.diagnosis.confidence >= 0.9);
    });

    it('should detect better-sqlite3 async misuse', () => {
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'query sessions',
        result: 'failure',
        errorMessage: 'TypeError: async function used with better-sqlite3 - await db.prepare() returned unexpected result',
        errorFile: 'src/auth/sessions.ts',
        fixApplied: 'Remove async/await from db calls',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      assert.ok(result.diagnosis);
      assert.ok(result.diagnosis.confidence >= 0.9);
    });
  });

  describe('Error fingerprinting', () => {
    it('should add lesson after 2 similar failures', () => {
      // Record first similar failure
      recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix session A',
        result: 'failure',
        errorMessage: 'ECONNREFUSED when connecting to Redis at 127.0.0.1:6379',
        errorFile: 'src/auth/session.ts',
      });

      // Record second similar failure (fingerprint should match)
      recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix session B',
        result: 'failure',
        errorMessage: 'ECONNREFUSED when connecting to Redis at localhost:6379',
        errorFile: 'src/auth/session.ts',
      });

      // Third occurrence should trigger learning
      const outcome = recordOutcome(db, {
        agent: 'auth-agent',
        task: 'fix session C',
        result: 'failure',
        errorMessage: 'ECONNREFUSED when connecting to Redis at 127.0.0.1:6379',
        errorFile: 'src/auth/session.ts',
      });

      const result = learnFromOutcome(db, TEST_DIR, outcome);
      // Should now have enough recurrences
      assert.ok(result.diagnosis);
      assert.strictEqual(result.diagnosis.category, 'external-change');
    });
  });
});
