/**
 * Eval runner — runs all scenarios and reports results.
 * Usage: node --import tsx --test test/eval/run.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runScenario } from './harness.js';
import { ALL_SCENARIOS } from './scenarios.js';

describe('Evaluation Harness', () => {
  for (const scenario of ALL_SCENARIOS) {
    it(scenario.name, async () => {
      const result = await runScenario(scenario);
      if (!result.passed) {
        const failedAssertions = result.assertions
          .filter(a => !a.passed)
          .map(a => `  ${a.name}: ${a.error}`)
          .join('\n');
        const msg = result.error
          ? `Scenario error: ${result.error}`
          : `Failed assertions:\n${failedAssertions}`;
        assert.fail(`${scenario.name} failed (${result.duration}ms):\n${msg}`);
      }
    });
  }
});
