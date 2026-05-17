/**
 * Tests for the Diagnosis Decision Table.
 * 15 canonical fixtures + priority ordering + no-match fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { diagnoseWithTable, type DiagnosisContext } from '../../src/core/agents/diagnosis-table.js';

// ============================================================================
// 15 Canonical Test Fixtures
// ============================================================================

interface CanonicalFixture {
  name: string;
  error: string;
  file?: string;
  agent?: string;
  fix?: string;
  expected: {
    category: string;
    confidence: number;
  };
  /** If scope check needed, set this */
  isInScope?: (file: string, agent: string) => boolean;
}

const CANONICAL_FIXTURES: CanonicalFixture[] = [
  {
    name: '#1 async better-sqlite3',
    error: 'Cannot use await with better-sqlite3',
    expected: { category: 'wrong-assumption', confidence: 0.95 },
  },
  {
    name: '#2 ESM require error',
    error: 'ERR_REQUIRE_ESM: require() of ES Module',
    expected: { category: 'wrong-assumption', confidence: 0.90 },
  },
  {
    name: '#3 deprecated API',
    error: 'stripe.charges.create() deprecated and removed API',
    expected: { category: 'outdated-research', confidence: 0.80 },
  },
  {
    name: '#4 db.exec() undefined',
    error: 'db.exec() returned undefined instead of rows',
    expected: { category: 'wrong-assumption', confidence: 0.90 },
  },
  {
    name: '#5 module not found',
    error: "Cannot find module 'passport-oauth2'",
    expected: { category: 'outdated-research', confidence: 0.70 },
  },
  {
    name: '#6 no exported member',
    error: "Module has no exported member 'Router'",
    expected: { category: 'outdated-research', confidence: 0.70 },
  },
  {
    name: '#7 type assignment error',
    error: "Type 'string' is not assignable to type 'Token'",
    expected: { category: 'wrong-assumption', confidence: 0.60 },
  },
  {
    name: '#8 argument count mismatch',
    error: 'Expected 2 arguments but got 3 (TS2554)',
    expected: { category: 'wrong-assumption', confidence: 0.60 },
  },
  {
    name: '#9 scope error',
    error: 'Permission denied',
    file: 'src/billing/pay.ts',
    agent: 'auth-agent',
    isInScope: (file: string, _agent: string) => {
      // auth-agent only covers src/auth/
      return file.startsWith('src/auth/');
    },
    expected: { category: 'scope-error', confidence: 0.80 },
  },
  {
    name: '#10 test failure',
    error: 'FAIL src/auth/login.test.ts > should validate',
    expected: { category: 'missing-test', confidence: 0.50 },
  },
  {
    name: '#11 TypeError runtime',
    error: "TypeError: Cannot read property 'id' of undefined",
    expected: { category: 'external-change', confidence: 0.40 },
  },
  {
    name: '#12 ECONNREFUSED',
    error: 'ECONNREFUSED 127.0.0.1:6379',
    expected: { category: 'external-change', confidence: 0.40 },
  },
  {
    name: '#13 null property access',
    error: "Cannot read properties of null (reading 'map')",
    expected: { category: 'wrong-assumption', confidence: 0.50 },
  },
  {
    name: '#14 generic unclassified',
    error: 'Something went wrong with auth flow',
    expected: { category: 'missing-convention', confidence: 0.30 },
  },
  {
    name: '#15 error with fix applied',
    error: 'Type error X',
    fix: 'Use Y instead',
    expected: { category: 'wrong-assumption', confidence: 0.85 },
  },
];

describe('Diagnosis Decision Table', () => {
  describe('15 Canonical Fixtures', () => {
    let correctCount = 0;

    for (const fixture of CANONICAL_FIXTURES) {
      it(`should classify ${fixture.name}`, () => {
        const ctx: DiagnosisContext = {
          errorMessage: fixture.error,
          errorFile: fixture.file,
          agentName: fixture.agent,
          fixApplied: fixture.fix,
          isInScope: fixture.isInScope,
        };

        const result = diagnoseWithTable(ctx);
        assert.ok(result, `Should produce a diagnosis for: ${fixture.error}`);

        const categoryMatch = result.category === fixture.expected.category;
        const confidenceMatch = Math.abs(result.confidence - fixture.expected.confidence) <= 0.1;

        if (categoryMatch && confidenceMatch) {
          correctCount++;
        }

        assert.strictEqual(
          result.category,
          fixture.expected.category,
          `Category mismatch for ${fixture.name}: got ${result.category}, expected ${fixture.expected.category}`,
        );
        assert.ok(
          Math.abs(result.confidence - fixture.expected.confidence) <= 0.1,
          `Confidence mismatch for ${fixture.name}: got ${result.confidence}, expected ${fixture.expected.confidence} (±0.1)`,
        );
      });
    }
  });

  describe('Acceptance Threshold', () => {
    it('should achieve ≥80% match rate (12/15)', () => {
      let correct = 0;
      for (const fixture of CANONICAL_FIXTURES) {
        const ctx: DiagnosisContext = {
          errorMessage: fixture.error,
          errorFile: fixture.file,
          agentName: fixture.agent,
          fixApplied: fixture.fix,
          isInScope: fixture.isInScope,
        };
        const result = diagnoseWithTable(ctx);
        if (result &&
            result.category === fixture.expected.category &&
            Math.abs(result.confidence - fixture.expected.confidence) <= 0.1) {
          correct++;
        }
      }
      const rate = correct / CANONICAL_FIXTURES.length;
      assert.ok(
        rate >= 0.8,
        `Match rate ${correct}/${CANONICAL_FIXTURES.length} (${(rate * 100).toFixed(0)}%) is below 80% threshold`,
      );
    });
  });

  describe('Edge Cases', () => {
    it('should return null for empty error message', () => {
      const result = diagnoseWithTable({ errorMessage: '' });
      assert.strictEqual(result, null);
    });

    it('should always produce a result for any non-empty error (fallback rule)', () => {
      const result = diagnoseWithTable({ errorMessage: 'xyzzy completely unknown error' });
      assert.ok(result);
      assert.strictEqual(result.category, 'missing-convention');
    });

    it('should prefer higher-priority rules', () => {
      // "Cannot find module" should match outdated-research (rule 5), not missing-convention (rule 14)
      const result = diagnoseWithTable({ errorMessage: "Cannot find module 'react'" });
      assert.ok(result);
      assert.strictEqual(result.category, 'outdated-research');
    });

    it('should skip scope-check rule when isInScope returns true', () => {
      const result = diagnoseWithTable({
        errorMessage: 'Some error',
        errorFile: 'src/auth/login.ts',
        agentName: 'auth-agent',
        isInScope: () => true, // file IS in scope
      });
      assert.ok(result);
      // Should NOT be scope-error since file is in scope
      assert.notStrictEqual(result.category, 'scope-error');
    });

    it('should include targetFile in result', () => {
      const result = diagnoseWithTable({
        errorMessage: "Cannot find module 'react'",
        errorFile: 'src/app.tsx',
      });
      assert.ok(result);
      assert.strictEqual(result.targetFile, 'src/app.tsx');
    });
  });
});
