import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillAutoGenerator, type AutoGenerateInput } from '../../src/core/knowledge/skill-auto-generator.js';
import type { ProjectIntelligence } from '../../src/core/knowledge/intelligence-collector.js';
import type { ProviderResearchEntry } from '../../src/core/knowledge/provider-research.js';
import type { FeatureCluster } from '../../src/core/living-docs/feature-aggregator.js';
import { readManifest, writeManifest } from '../../src/core/knowledge/workspace.js';

const TEST_DIR = join(tmpdir(), 'codeimpact-test-autogen-' + Date.now());

function makeIntel(overrides?: Partial<ProjectIntelligence>): ProjectIntelligence {
  return {
    collectedAt: new Date().toISOString(),
    codebase: {
      fileCount: 100,
      totalLines: 5000,
      languages: ['TypeScript', 'JavaScript'],
      keyDirectories: ['src', 'test'],
      symbolCount: 500,
      description: 'Test project',
      architectureNotes: '',
    },
    architecture: {
      layers: [
        { name: 'core', directory: 'src/core', fileCount: 20, purpose: 'Business logic' },
        { name: 'api', directory: 'src/api', fileCount: 10, purpose: 'HTTP endpoints' },
      ],
      dataFlow: ['api → core → db'],
      keyComponents: [],
      patternCategories: {},
      topPatterns: [{ name: 'singleton', usageCount: 5 }],
      functionStats: { total: 200, exported: 80 },
    },
    dependencyHotspots: [],
    patterns: [],
    decisions: [],
    riskFiles: [
      { file: 'src/core/engine.ts', riskScore: 75, riskLevel: 'high', directDependents: 12, criticalPaths: ['auth'], recommendation: 'Review carefully' },
    ],
    deadCode: null,
    tests: { framework: 'node:test', testCount: 50, coverageGaps: [], uncoveredFunctions: [] },
    recentBugs: [],
    changeHotspots: [{ file: 'src/core/engine.ts', changeCount: 15 }],
    activeFeature: null,
    docHealth: null,
    detectedTechnologies: [
      { name: 'TypeScript', source: 'typescript', importPaths: ['src/core/engine.ts', 'src/core/parser.ts'] },
      { name: 'Express.js', source: 'express', importPaths: ['src/api/server.ts', 'src/api/routes.ts'] },
    ],
    ...overrides,
  };
}

function makeProviders(): ProviderResearchEntry[] {
  return [
    {
      provider: 'TypeScript',
      topic: 'typescript',
      fetchedAt: new Date().toISOString(),
      freshnessHours: 24,
      sourceUrl: 'https://www.typescriptlang.org/docs/',
      summary: 'Use strict mode, prefer interfaces.\n\nCommon pitfalls:\n- Using any instead of unknown\n- Missing strict null checks',
      retrievalMode: 'static',
    },
    {
      provider: 'Express.js',
      topic: 'express',
      fetchedAt: new Date().toISOString(),
      freshnessHours: 24,
      sourceUrl: 'https://expressjs.com/',
      summary: 'Use middleware composition.\n\nCommon pitfalls:\n- Missing error handling middleware\n- Not using helmet/cors',
      retrievalMode: 'static',
    },
  ];
}

function makeFeatures(): FeatureCluster[] {
  return [
    {
      name: 'Core engine',
      directory: 'src/core',
      files: ['src/core/engine.ts', 'src/core/parser.ts', 'src/core/analyzer.ts', 'src/core/index.ts'],
      purpose: 'Core business logic',
      sharedDependencies: ['better-sqlite3', 'path'],
      decisionTags: ['use-sqlite'],
    },
    {
      name: 'API layer',
      directory: 'src/api',
      files: ['src/api/server.ts', 'src/api/routes.ts', 'src/api/middleware.ts'],
      purpose: 'HTTP endpoints',
      sharedDependencies: ['express'],
      decisionTags: [],
    },
    {
      name: 'Tiny module',
      directory: 'src/tiny',
      files: ['src/tiny/a.ts', 'src/tiny/b.ts'],
      purpose: 'Small utility',
      sharedDependencies: [],
      decisionTags: [],
    },
  ];
}

describe('SkillAutoGenerator', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should generate technology skills when providers match detected techs', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    const result = gen.generate({
      intel: makeIntel(),
      providers: makeProviders(),
      features: [],
    });

    assert.ok(result.skillsGenerated >= 2, `Expected >=2 tech skills, got ${result.skillsGenerated}`);
    assert.ok(result.paths.length >= 2);

    // Check TypeScript skill exists
    const tsSkill = result.paths.find(p => p.includes('typescript'));
    assert.ok(tsSkill, 'Should have TypeScript skill');
    assert.ok(existsSync(tsSkill));
    const tsContent = readFileSync(tsSkill, 'utf-8');
    assert.ok(tsContent.includes('auto_generated: true'), 'Should have auto_generated metadata');
    assert.ok(tsContent.includes('## Rules'), 'Should have Rules section');
    assert.ok(tsContent.includes('## Watch Out'), 'Should have Watch Out section');
  });

  it('should generate feature skills for clusters with 3+ files', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    const result = gen.generate({
      intel: makeIntel(),
      providers: [],
      features: makeFeatures(),
    });

    // Should generate for 'Core engine' (4 files) and 'API layer' (3 files) but NOT 'Tiny module' (2 files)
    const featurePaths = result.paths.filter(p => p.includes('features'));
    assert.ok(featurePaths.length >= 2, `Expected >=2 feature skills, got ${featurePaths.length}`);

    // Check that the tiny module was skipped
    const tinyPath = result.paths.find(p => p.includes('tiny'));
    assert.ok(!tinyPath, 'Should NOT have tiny module skill (< 3 files)');
  });

  it('should skip clusters with fewer than 3 files', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    const smallFeatures: FeatureCluster[] = [
      {
        name: 'Small feature',
        directory: 'src/small',
        files: ['src/small/a.ts', 'src/small/b.ts'],
        purpose: 'Too small',
        sharedDependencies: [],
        decisionTags: [],
      },
    ];

    const result = gen.generate({
      intel: makeIntel(),
      providers: [],
      features: smallFeatures,
    });

    const featurePaths = result.paths.filter(p => p.includes('features'));
    assert.equal(featurePaths.length, 0, 'Should not generate skill for cluster with < 3 files');
    assert.ok(result.skipped >= 1, 'Should count as skipped');
  });

  it('should generate project conventions skill', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    const result = gen.generate({
      intel: makeIntel(),
      providers: [],
      features: [],
    });

    const convPath = result.paths.find(p => p.includes('project-conventions'));
    assert.ok(convPath, 'Should have project conventions skill');
    assert.ok(existsSync(convPath));

    const content = readFileSync(convPath, 'utf-8');
    assert.ok(content.includes('auto_generated: true'), 'Should have auto_generated metadata');
    assert.ok(content.includes('TypeScript'), 'Should mention detected languages');
    assert.ok(content.includes('node:test'), 'Should mention test framework');
    assert.ok(content.includes('## Rules'), 'Should have Rules section');
    assert.ok(content.includes('## Watch Out'), 'Should have Watch Out section');
  });

  it('should have auto_generated: true in all skill frontmatter', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    const result = gen.generate({
      intel: makeIntel(),
      providers: makeProviders(),
      features: makeFeatures(),
    });

    for (const path of result.paths) {
      const content = readFileSync(path, 'utf-8');
      assert.ok(content.includes('auto_generated: true'), `Missing auto_generated in ${path}`);
    }
  });

  it('should be idempotent — second run creates 0 new skills', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    const input: AutoGenerateInput = {
      intel: makeIntel(),
      providers: makeProviders(),
      features: makeFeatures(),
    };

    const first = gen.generate(input);
    assert.ok(first.skillsGenerated > 0, 'First run should generate skills');

    // Second run with same file count — should skip due to growth check
    const second = gen.generate(input);
    assert.equal(second.skillsGenerated, 0, 'Second run should generate 0 new skills (idempotent)');
  });

  it('should not overwrite user-edited skills', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);

    // First: generate to create the skills
    gen.generate({
      intel: makeIntel(),
      providers: makeProviders(),
      features: makeFeatures(),
    });

    // Simulate user editing a skill: remove auto_generated marker
    const manifest = readManifest(TEST_DIR);
    // Force re-generation by removing autoGeneration tracking
    delete manifest.autoGeneration;
    writeManifest(TEST_DIR, manifest);

    // Find the conventions skill and edit it (remove auto_generated)
    const skillsDir = join(TEST_DIR, 'knowledge', 'skills', 'core', 'project-conventions', 'SKILL.md');
    if (existsSync(skillsDir)) {
      const content = readFileSync(skillsDir, 'utf-8');
      const edited = content.replace('auto_generated: true', 'manually_maintained: true');
      writeFileSync(skillsDir, edited);
    }

    // Re-generate — should not overwrite the user-edited skill
    const second = gen.generate({
      intel: makeIntel(),
      providers: makeProviders(),
      features: makeFeatures(),
    });

    if (existsSync(skillsDir)) {
      const finalContent = readFileSync(skillsDir, 'utf-8');
      assert.ok(finalContent.includes('manually_maintained: true'), 'Should preserve user edits');
      assert.ok(!finalContent.includes('auto_generated: true'), 'Should NOT overwrite with auto_generated');
    }
  });

  it('should write autoGeneration tracking to manifest', () => {
    const gen = new SkillAutoGenerator(TEST_DIR);
    gen.generate({
      intel: makeIntel(),
      providers: [],
      features: [],
    });

    const manifest = readManifest(TEST_DIR);
    assert.ok(manifest.autoGeneration, 'Manifest should have autoGeneration field');
    assert.ok(manifest.autoGeneration.lastRunAt, 'Should have lastRunAt');
    assert.equal(manifest.autoGeneration.fileCountAtRun, 100, 'Should record file count');
    assert.ok(manifest.autoGeneration.skillsGenerated >= 1, 'Should record skills generated');
  });

  it('should cap technology skills at 5', () => {
    const manyTechs = Array.from({ length: 8 }, (_, i) => ({
      name: `Tech${i}`,
      source: `tech${i}`,
      importPaths: ['src/a.ts', 'src/b.ts'],
    }));
    const manyProviders = Array.from({ length: 8 }, (_, i) => ({
      provider: `Tech${i}`,
      topic: `tech${i}`,
      fetchedAt: new Date().toISOString(),
      freshnessHours: 24,
      sourceUrl: 'https://example.com',
      summary: 'Some guidance.\n\nCommon pitfalls:\n- Pitfall one',
      retrievalMode: 'static' as const,
    }));

    const gen = new SkillAutoGenerator(TEST_DIR);
    const result = gen.generate({
      intel: makeIntel({ detectedTechnologies: manyTechs }),
      providers: manyProviders,
      features: [],
    });

    const techPaths = result.paths.filter(p => p.includes('technology'));
    // 5 tech + 1 conventions = up to 6 total, but tech capped at 5
    assert.ok(techPaths.length <= 5, `Tech skills should be capped at 5, got ${techPaths.length}`);
  });
});
