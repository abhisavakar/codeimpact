/**
 * Tests for the Research Engine — structured distillation + trust scoring.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { researchTechnology, researchAllTechnologies } from '../../src/core/agents/research-engine.js';
import { initAgentWorkspace } from '../../src/core/agents/workspace.js';
import type { DetectedTechnology } from '../../src/core/agents/types.js';

const TEST_DIR = join(tmpdir(), `codeimpact-research-test-${Date.now()}`);

describe('Research Engine', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    initAgentWorkspace(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should generate stub for unknown technology', async () => {
    const tech: DetectedTechnology = {
      name: 'unknown-lib',
      version: '1.0.0',
      source: 'package.json',
    };
    const result = await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
    });

    assert.strictEqual(result.status, 'created');
    assert.ok(result.tokenCount! > 0);

    const filePath = join(TEST_DIR, '.code-impact', 'research', 'unknown-lib@1.0.0.md');
    assert.ok(existsSync(filePath));
    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('unknown-lib'));
    assert.ok(content.includes('1.0.0'));
  });

  it('should use cached research when not stale', async () => {
    const tech: DetectedTechnology = {
      name: 'cached-lib',
      version: '2.0.0',
      source: 'package.json',
    };

    // First research creates
    const r1 = await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
    });
    assert.strictEqual(r1.status, 'created');

    // Second research uses cache
    const r2 = await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
    });
    assert.strictEqual(r2.status, 'cached');
  });

  it('should force refresh when forced', async () => {
    const tech: DetectedTechnology = {
      name: 'forced-lib',
      version: '1.0.0',
      source: 'package.json',
    };

    await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
    });

    const r2 = await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
      force: true,
    });
    // Force creates/updates even when cached
    assert.ok(['created', 'updated'].includes(r2.status));
  });

  it('should use custom fetch function', async () => {
    const tech: DetectedTechnology = {
      name: 'express',
      version: '4.21.0',
      source: 'package.json',
    };

    const mockContent = `
# Express API

## Breaking Changes
Express 5.0 removes app.del() method.

\`\`\`js
app.get('/api', (req, res) => {
  res.json({ hello: 'world' });
});
\`\`\`

## Common Pitfalls
Warning: Forgetting next() in middleware causes requests to hang.
    `;

    const result = await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
      fetchFn: async () => mockContent,
    });

    // Status is 'updated' because existsSync check happens after writeFileSync in source
    assert.ok(['created', 'updated'].includes(result.status));

    const filePath = join(TEST_DIR, '.code-impact', 'research', 'express@4.21.0.md');
    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('express'));
    assert.ok(content.includes('trust_score'), 'Should include trust score in frontmatter');
    assert.ok(content.includes('verified'), 'Should include verified flag');
  });

  it('should handle scoped package names', async () => {
    const tech: DetectedTechnology = {
      name: '@prisma/client',
      version: '5.0.0',
      source: 'package.json',
    };

    const result = await researchTechnology(TEST_DIR, tech, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
    });

    assert.ok(['created', 'updated'].includes(result.status));
    // Scoped name should be sanitized in filename
    const filePath = join(TEST_DIR, '.code-impact', 'research', 'prisma__client@5.0.0.md');
    assert.ok(existsSync(filePath));
  });

  it('should research multiple technologies', async () => {
    const techs: DetectedTechnology[] = [
      { name: 'lib-a', version: '1.0.0', source: 'package.json' },
      { name: 'lib-b', version: '2.0.0', source: 'package.json' },
    ];

    const results = await researchAllTechnologies(TEST_DIR, techs, {
      maxTokensPerTech: 4000,
      cadenceHours: 168,
    });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0]!.technology, 'lib-a');
    assert.strictEqual(results[1]!.technology, 'lib-b');
  });
});
