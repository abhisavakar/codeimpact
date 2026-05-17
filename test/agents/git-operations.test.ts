/**
 * Tests for Git Operations — using MockGitExecutor for testability.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  MockGitExecutor,
  detectProvider,
  createGitHubProvider,
  createGitLabProvider,
  createBitbucketProvider,
  createGenericProvider,
} from '../../src/core/agents/remote-provider.js';
import { computeContentHash } from '../../src/core/agents/git-operations.js';

describe('Git Operations', () => {
  describe('computeContentHash', () => {
    it('should produce consistent hash for same content', () => {
      const h1 = computeContentHash('hello world');
      const h2 = computeContentHash('hello world');
      assert.strictEqual(h1, h2);
    });

    it('should produce different hash for different content', () => {
      const h1 = computeContentHash('hello');
      const h2 = computeContentHash('world');
      assert.notStrictEqual(h1, h2);
    });

    it('should return 8-char hex string', () => {
      const hash = computeContentHash('test');
      assert.strictEqual(hash.length, 8);
      assert.ok(/^[0-9a-f]{8}$/.test(hash));
    });
  });
});

describe('Remote Providers', () => {
  let mock: MockGitExecutor;

  beforeEach(() => {
    mock = new MockGitExecutor();
  });

  describe('MockGitExecutor', () => {
    it('should record calls', () => {
      mock.setResponse('status', 'clean');
      mock.exec('/project', 'status');
      assert.strictEqual(mock.calls.length, 1);
      assert.strictEqual(mock.calls[0]!.command, 'status');
    });

    it('should return configured responses', () => {
      mock.setResponse('rev-parse', 'abc123');
      const result = mock.exec('/project', 'rev-parse HEAD');
      assert.strictEqual(result, 'abc123');
    });

    it('should throw configured errors', () => {
      mock.setError('push', new Error('Permission denied'));
      assert.throws(() => mock.exec('/project', 'push origin main'));
    });

    it('should reset state', () => {
      mock.setResponse('status', 'ok');
      mock.exec('/p', 'status');
      mock.reset();
      assert.strictEqual(mock.calls.length, 0);
    });
  });

  describe('Provider Detection', () => {
    it('should detect GitHub from remote URL', () => {
      mock.setResponse('remote get-url origin', 'git@github.com:user/repo.git');
      const provider = detectProvider('/project', undefined, mock);
      assert.strictEqual(provider.name, 'github');
    });

    it('should detect GitLab from remote URL', () => {
      mock.setResponse('remote get-url origin', 'git@gitlab.com:user/repo.git');
      const provider = detectProvider('/project', undefined, mock);
      assert.strictEqual(provider.name, 'gitlab');
    });

    it('should detect Bitbucket from remote URL', () => {
      mock.setResponse('remote get-url origin', 'git@bitbucket.org:user/repo.git');
      const provider = detectProvider('/project', undefined, mock);
      assert.strictEqual(provider.name, 'bitbucket');
    });

    it('should fall back to generic', () => {
      mock.setResponse('remote get-url origin', 'git@self-hosted.example.com:repo.git');
      const provider = detectProvider('/project', undefined, mock);
      assert.strictEqual(provider.name, 'generic');
    });

    it('should honor explicit config', () => {
      const provider = detectProvider('/project', 'gitlab', mock);
      assert.strictEqual(provider.name, 'gitlab');
    });
  });

  describe('GitHub Provider', () => {
    it('should push via executor', () => {
      mock.setResponse('push', '');
      const provider = createGitHubProvider(mock);
      const result = provider.push('/project', 'code-impact/skills');
      assert.ok(result.success);
      assert.ok(mock.calls.some(c => c.command.includes('push')));
    });

    it('should handle push failure', () => {
      mock.setError('push', new Error('rejected'));
      const provider = createGitHubProvider(mock);
      const result = provider.push('/project', 'main');
      assert.ok(!result.success);
      assert.ok(result.message.includes('rejected'));
    });
  });

  describe('GitLab Provider', () => {
    it('should detect gitlab URLs', () => {
      mock.setResponse('remote get-url origin', 'https://gitlab.company.com/repo.git');
      const provider = createGitLabProvider(mock);
      assert.ok(provider.detect('/project'));
    });
  });

  describe('Generic Provider', () => {
    it('should always detect', () => {
      const provider = createGenericProvider(mock);
      assert.ok(provider.detect('/project'));
    });

    it('should reject PR creation', () => {
      const provider = createGenericProvider(mock);
      const result = provider.createPR({
        projectPath: '/p', title: 't', body: 'b', base: 'main', head: 'feat',
      });
      assert.ok(!result.success);
    });
  });
});
