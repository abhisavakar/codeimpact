import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectTechnologies, detectMonorepo } from '../../src/core/agents/tech-detector.js';

const TEST_DIR = join(tmpdir(), `codeimpact-tech-test-${Date.now()}`);

describe('Technology Detector', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('detectTechnologies', () => {
    it('should detect from package.json', () => {
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.21.0', react: '~18.2.0' },
        devDependencies: { typescript: '^5.7.0' },
      }));

      const techs = detectTechnologies(TEST_DIR);
      assert.ok(techs.length >= 3);
      const express = techs.find(t => t.name === 'express');
      assert.ok(express);
      assert.strictEqual(express.source, 'package.json');
      assert.strictEqual(express.version, '4.21.0'); // stripped ^
    });

    it('should detect from package-lock.json with exact versions', () => {
      writeFileSync(join(TEST_DIR, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/express': { version: '4.21.2' },
          'node_modules/react': { version: '18.2.0' },
          'node_modules/react/node_modules/loose-envify': { version: '1.4.0' },
        },
      }));
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.21.0', react: '^18.2.0' },
      }));

      const techs = detectTechnologies(TEST_DIR);
      const express = techs.find(t => t.name === 'express');
      assert.ok(express);
      assert.strictEqual(express.version, '4.21.2'); // exact from lockfile
      assert.strictEqual(express.source, 'package-lock.json');

      // Should not include nested deps
      const envify = techs.find(t => t.name === 'loose-envify');
      assert.strictEqual(envify, undefined);
    });

    it('should detect from config files', () => {
      writeFileSync(join(TEST_DIR, 'tsconfig.json'), '{}');
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ dependencies: {} }));

      const techs = detectTechnologies(TEST_DIR);
      const ts = techs.find(t => t.name === 'typescript');
      assert.ok(ts);
      assert.strictEqual(ts.source, 'tsconfig.json');
    });

    it('should handle missing files gracefully', () => {
      const techs = detectTechnologies(TEST_DIR);
      assert.ok(Array.isArray(techs));
      assert.strictEqual(techs.length, 0);
    });

    it('should prioritize lockfile over manifest', () => {
      writeFileSync(join(TEST_DIR, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/express': { version: '4.21.2' },
        },
      }));
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.18.0' },
      }));

      const techs = detectTechnologies(TEST_DIR);
      const express = techs.find(t => t.name === 'express');
      assert.ok(express);
      assert.strictEqual(express.version, '4.21.2'); // lockfile wins
    });
  });

  describe('detectMonorepo', () => {
    it('should detect pnpm workspace', () => {
      writeFileSync(join(TEST_DIR, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n  - "apps/*"');
      const mono = detectMonorepo(TEST_DIR);
      assert.ok(mono);
      assert.strictEqual(mono.type, 'pnpm');
      assert.deepStrictEqual(mono.packages, ['packages/*', 'apps/*']);
    });

    it('should detect npm workspaces', () => {
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
        workspaces: ['packages/*'],
      }));
      const mono = detectMonorepo(TEST_DIR);
      assert.ok(mono);
      assert.strictEqual(mono.type, 'npm-workspaces');
    });

    it('should detect turborepo', () => {
      writeFileSync(join(TEST_DIR, 'turbo.json'), '{}');
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
        workspaces: ['apps/*', 'packages/*'],
      }));
      const mono = detectMonorepo(TEST_DIR);
      assert.ok(mono);
      assert.strictEqual(mono.type, 'turborepo');
    });

    it('should return null for non-monorepo', () => {
      writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'single-package',
        dependencies: {},
      }));
      const mono = detectMonorepo(TEST_DIR);
      assert.strictEqual(mono, null);
    });
  });
});
