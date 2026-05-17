import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectFeatures } from '../../src/core/agents/feature-detector.js';
import type { FeatureDetectionConfig } from '../../src/core/agents/types.js';

const TEST_DIR = join(tmpdir(), `codeimpact-feat-test-${Date.now()}`);

const defaultConfig: FeatureDetectionConfig = {
  min_files: 3,
  min_cohesion: 0.4,
  max_features: 20,
  respect_codeowners: true,
  respect_package_boundaries: true,
};

describe('Feature Detector', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('detectFeatures', () => {
    it('should detect features from path heuristics', () => {
      const indexedFiles = [
        'src/auth/login.ts',
        'src/auth/register.ts',
        'src/auth/middleware.ts',
        'src/auth/types.ts',
        'src/billing/stripe.ts',
        'src/billing/plans.ts',
        'src/billing/webhook.ts',
      ];

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: defaultConfig,
        importGraph: new Map(),
        indexedFiles,
      });

      assert.ok(features.length >= 2);
      const auth = features.find(f => f.name === 'auth');
      assert.ok(auth);
      assert.ok(auth.fileCount >= 4);

      const billing = features.find(f => f.name === 'billing');
      assert.ok(billing);
      assert.ok(billing.fileCount >= 3);
    });

    it('should respect min_files threshold', () => {
      const indexedFiles = [
        'src/auth/login.ts',
        'src/auth/register.ts',
        // Only 2 files — below threshold
      ];

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: { ...defaultConfig, min_files: 3 },
        importGraph: new Map(),
        indexedFiles,
      });

      const auth = features.find(f => f.name === 'auth');
      assert.strictEqual(auth, undefined);
    });

    it('should skip utility directories', () => {
      const indexedFiles = [
        'src/utils/helpers.ts',
        'src/utils/format.ts',
        'src/utils/validate.ts',
        'src/utils/parse.ts',
      ];

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: defaultConfig,
        importGraph: new Map(),
        indexedFiles,
      });

      const utils = features.find(f => f.name === 'utils');
      assert.strictEqual(utils, undefined);
    });

    it('should detect features from CODEOWNERS', () => {
      mkdirSync(join(TEST_DIR, '.github'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.github', 'CODEOWNERS'), [
        'src/payments/** @team-billing',
        'src/notifications/** @team-comms',
      ].join('\n'));

      const indexedFiles = [
        'src/payments/stripe.ts',
        'src/payments/refund.ts',
        'src/payments/webhook.ts',
        'src/payments/types.ts',
      ];

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: defaultConfig,
        importGraph: new Map(),
        indexedFiles,
      });

      const payments = features.find(f => f.paths.some(p => p.includes('payments')));
      assert.ok(payments);
      assert.ok(payments.owner?.includes('@team-billing'));
    });

    it('should cap at max_features', () => {
      const indexedFiles: string[] = [];
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 5; j++) {
          indexedFiles.push(`src/feature${i}/file${j}.ts`);
        }
      }

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: { ...defaultConfig, max_features: 5 },
        importGraph: new Map(),
        indexedFiles,
      });

      assert.ok(features.length <= 5);
    });

    it('should associate test files with features', () => {
      const indexedFiles = [
        'src/auth/login.ts',
        'src/auth/register.ts',
        'src/auth/middleware.ts',
        'tests/auth.test.ts',
        'tests/auth.spec.ts',
      ];

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: defaultConfig,
        importGraph: new Map(),
        indexedFiles,
      });

      const auth = features.find(f => f.name === 'auth');
      assert.ok(auth);
      assert.ok(auth.testFiles.length > 0);
    });

    it('should use import cohesion when available', () => {
      const indexedFiles = [
        'src/api/routes.ts',
        'src/api/middleware.ts',
        'src/api/handlers.ts',
        'src/api/validators.ts',
      ];

      // High internal cohesion: all files import from each other
      const importGraph = new Map([
        ['src/api/routes.ts', ['src/api/handlers.ts', 'src/api/middleware.ts']],
        ['src/api/handlers.ts', ['src/api/validators.ts']],
        ['src/api/middleware.ts', ['src/api/validators.ts']],
        ['src/api/validators.ts', []],
      ]);

      const features = detectFeatures({
        projectPath: TEST_DIR,
        config: { ...defaultConfig, min_cohesion: 0.3 },
        importGraph,
        indexedFiles,
      });

      const api = features.find(f => f.name === 'api');
      assert.ok(api);
      assert.ok(api.cohesionScore > 0.3);
    });
  });
});
