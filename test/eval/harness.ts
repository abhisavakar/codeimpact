/**
 * Evaluation Harness — creates isolated temp directories from fixtures,
 * executes agent system actions, and tears down cleanly.
 */

import { mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface EvalFixture {
  name: string;
  sourcePath: string;
  tempPath: string;
}

export interface EvalContext {
  fixture: EvalFixture;
  startTime: number;
}

export type EvalAction = (fixturePath: string) => Promise<void> | void;

export interface EvalScenario {
  name: string;
  fixtureName: string;
  setup?: EvalAction;
  action: EvalAction;
  assertions: Array<(fixturePath: string) => void>;
}

export interface EvalResult {
  scenario: string;
  passed: boolean;
  duration: number;
  error?: string;
  assertions: Array<{ name: string; passed: boolean; error?: string }>;
}

// ============================================================================
// Fixture Management
// ============================================================================

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

export function getFixturePath(name: string): string {
  const path = join(FIXTURES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${name} (expected at ${path})`);
  }
  return path;
}

export function createTempFixture(fixtureName: string, suffix?: string): EvalFixture {
  const sourcePath = getFixturePath(fixtureName);
  const safeSuffix = (suffix || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, '_');
  const tempName = `codeimpact-eval-${fixtureName}-${safeSuffix}`;
  const tempPath = join(tmpdir(), tempName);

  // Clean up if leftover from previous run
  if (existsSync(tempPath)) {
    rmSync(tempPath, { recursive: true, force: true });
  }

  // Copy fixture to temp
  mkdirSync(tempPath, { recursive: true });
  cpSync(sourcePath, tempPath, { recursive: true });

  return { name: fixtureName, sourcePath, tempPath };
}

export function destroyFixture(fixture: EvalFixture): void {
  if (existsSync(fixture.tempPath)) {
    rmSync(fixture.tempPath, { recursive: true, force: true });
  }
}

// ============================================================================
// Scenario Runner
// ============================================================================

export async function runScenario(scenario: EvalScenario): Promise<EvalResult> {
  const startTime = Date.now();
  const fixture = createTempFixture(scenario.fixtureName, scenario.name.replace(/\s+/g, '-'));
  const result: EvalResult = {
    scenario: scenario.name,
    passed: true,
    duration: 0,
    assertions: [],
  };

  try {
    // Run optional setup
    if (scenario.setup) {
      await scenario.setup(fixture.tempPath);
    }

    // Run the action under test
    await scenario.action(fixture.tempPath);

    // Run assertions
    for (const assertion of scenario.assertions) {
      try {
        assertion(fixture.tempPath);
        result.assertions.push({ name: assertion.name || 'anonymous', passed: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.assertions.push({ name: assertion.name || 'anonymous', passed: false, error: msg });
        result.passed = false;
      }
    }
  } catch (err) {
    result.passed = false;
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    result.duration = Date.now() - startTime;
    destroyFixture(fixture);
  }

  return result;
}

export async function runAllScenarios(scenarios: EvalScenario[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
  }
  return results;
}

// ============================================================================
// Result Reporting
// ============================================================================

export function reportResults(results: EvalResult[]): { passed: number; failed: number; total: number } {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  for (const result of results) {
    const icon = result.passed ? 'PASS' : 'FAIL';
    const status = `[${icon}] ${result.scenario} (${result.duration}ms)`;

    if (!result.passed) {
      console.error(status);
      if (result.error) {
        console.error(`  Error: ${result.error}`);
      }
      for (const a of result.assertions.filter(a => !a.passed)) {
        console.error(`  Assertion failed (${a.name}): ${a.error}`);
      }
    }
  }

  return { passed, failed, total };
}

// ============================================================================
// Utility: count files recursively
// ============================================================================

export function countFiles(dir: string, ext?: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (!ext || entry.name.endsWith(ext)) {
      count++;
    }
  }
  return count;
}
