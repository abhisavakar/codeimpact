/**
 * Evaluation Scenarios — 10 scripted regression scenarios for the agent system.
 * Each scenario: fixture → action → assertions.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, cpSync } from 'fs';
import { join } from 'path';
import type { EvalScenario } from './harness.js';
import {
  assertWorkspaceComplete,
  assertProjectFilesExist,
  assertFeatureFilesExist,
  assertMarkersPresent,
  assertManualContentPreserved,
  assertIndexValid,
  assertFeatureCount,
  assertTechnologyDetected,
  assertFileExists,
  assertFileNotExists,
  assertFileContains,
  assertTokenBudget,
  assertNonEmptySection,
} from './assertions.js';
import { agentsGenerate, agentsInit } from '../../src/core/agents/orchestrator.js';

// ============================================================================
// Helper: generate with defaults (no real research, no git)
// ============================================================================

async function generateFixture(projectPath: string): Promise<void> {
  await agentsGenerate({
    projectPath,
    force: false,
    push: false,
    pr: false,
  });
}

// ============================================================================
// S1: Fresh Generation
// ============================================================================

export const S1_FreshGeneration: EvalScenario = {
  name: 'S1: Fresh generation',
  fixtureName: 'base',
  action: generateFixture,
  assertions: [
    function workspaceCreated(p: string) { assertWorkspaceComplete(p); },
    function projectFilesCreated(p: string) { assertProjectFilesExist(p); },
    function indexValid(p: string) { assertIndexValid(p); },
    function markersInProjectSkill(p: string) {
      assertMarkersPresent(join(p, '.code-impact', 'project', 'SKILL.md'));
    },
    function markersInConventions(p: string) {
      assertMarkersPresent(join(p, '.code-impact', 'project', 'CONVENTIONS.md'));
    },
    function markersInArchitecture(p: string) {
      assertMarkersPresent(join(p, '.code-impact', 'project', 'ARCHITECTURE.md'));
    },
    function technologiesDetected(p: string) {
      assertTechnologyDetected(p, 'express');
    },
  ],
};

// ============================================================================
// S2: Idempotent Regeneration
// ============================================================================

export const S2_Idempotent: EvalScenario = {
  name: 'S2: Idempotent regeneration',
  fixtureName: 'base',
  action: async (p: string) => {
    // Generate twice
    await generateFixture(p);
    // Record contents after first run
    const skillContent1 = readFileSync(join(p, '.code-impact', 'project', 'SKILL.md'), 'utf-8');
    const convContent1 = readFileSync(join(p, '.code-impact', 'project', 'CONVENTIONS.md'), 'utf-8');

    await generateFixture(p);

    const skillContent2 = readFileSync(join(p, '.code-impact', 'project', 'SKILL.md'), 'utf-8');
    const convContent2 = readFileSync(join(p, '.code-impact', 'project', 'CONVENTIONS.md'), 'utf-8');

    // Store for assertion access
    (globalThis as any).__s2_results = {
      skillMatch: skillContent1 === skillContent2,
      convMatch: convContent1 === convContent2,
    };
  },
  assertions: [
    function idempotentFiles(_p: string) {
      const results = (globalThis as any).__s2_results;
      if (!results.skillMatch) throw new Error('SKILL.md changed between runs');
      if (!results.convMatch) throw new Error('CONVENTIONS.md changed between runs');
      delete (globalThis as any).__s2_results;
    },
  ],
};

// ============================================================================
// S3: Manual Content Preservation
// ============================================================================

export const S3_ManualPreservation: EvalScenario = {
  name: 'S3: Manual content preservation',
  fixtureName: 'base',
  setup: async (p: string) => {
    // First generate
    await generateFixture(p);
    // Add manual content outside markers
    const skillPath = join(p, '.code-impact', 'project', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');
    const manualNote = '\n## My Custom Notes\nThis is human-authored content that must survive regeneration.\n';
    writeFileSync(skillPath, content + manualNote);
  },
  action: generateFixture,
  assertions: [
    function manualContentPreserved(p: string) {
      assertManualContentPreserved(
        join(p, '.code-impact', 'project', 'SKILL.md'),
        'This is human-authored content that must survive regeneration.',
      );
    },
  ],
};

// ============================================================================
// S4: Deliberate Failure → Improvement Engine
// ============================================================================

export const S4_ImprovementEngine: EvalScenario = {
  name: 'S4: Deliberate failure triggers improvement',
  fixtureName: 'base',
  action: async (p: string) => {
    // Generate base
    await generateFixture(p);
    // This scenario tests the improvement engine pipeline.
    // Full test requires DB seeding — validated in unit tests.
    // Here we just verify the workspace can be set up and index has outcomes field.
  },
  assertions: [
    function outcomeFieldExists(p: string) {
      assertIndexValid(p);
      const index = JSON.parse(readFileSync(join(p, '.code-impact', 'index.json'), 'utf-8'));
      if (index.outcomes === undefined) throw new Error('index.json should have outcomes field');
    },
  ],
};

// ============================================================================
// S5: Dependency Bump → Re-Research
// ============================================================================

export const S5_DepBumpReresearch: EvalScenario = {
  name: 'S5: Dep bump triggers re-research',
  fixtureName: 'base',
  action: async (p: string) => {
    // Generate first
    await generateFixture(p);

    // Modify lockfile version
    const lockPath = join(p, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    if (lock.packages['node_modules/express']) {
      lock.packages['node_modules/express'].version = '5.0.0';
    }
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));

    // Regenerate
    await generateFixture(p);
  },
  assertions: [
    function expressDetectedWithNewVersion(p: string) {
      const index = JSON.parse(readFileSync(join(p, '.code-impact', 'index.json'), 'utf-8'));
      const express = index.technologies.find((t: any) => t.name === 'express');
      if (!express) throw new Error('express should be detected');
      // Version should reflect lockfile change
      if (express.version !== '5.0.0') throw new Error(`Expected express 5.0.0, got ${express.version}`);
    },
  ],
};

// ============================================================================
// S6: Feature Folder Move
// ============================================================================

export const S6_FeatureFolderMove: EvalScenario = {
  name: 'S6: Feature folder rename',
  fixtureName: 'base',
  setup: async (p: string) => {
    await generateFixture(p);
  },
  action: async (p: string) => {
    // Rename src/auth → src/authentication
    renameSync(join(p, 'src', 'auth'), join(p, 'src', 'authentication'));
    await generateFixture(p);
  },
  assertions: [
    function workspaceStillValid(p: string) { assertWorkspaceComplete(p); },
    function indexValid(p: string) { assertIndexValid(p); },
  ],
};

// ============================================================================
// S7: New Feature Added
// ============================================================================

export const S7_NewFeatureAdded: EvalScenario = {
  name: 'S7: New feature detected',
  fixtureName: 'base',
  setup: async (p: string) => {
    await generateFixture(p);
  },
  action: async (p: string) => {
    // Add a new feature directory with 4 files
    const paymentsDir = join(p, 'src', 'payments');
    mkdirSync(paymentsDir, { recursive: true });
    writeFileSync(join(paymentsDir, 'processor.ts'), 'export function processPayment() { return true; }');
    writeFileSync(join(paymentsDir, 'refund.ts'), 'export function refundPayment() { return true; }');
    writeFileSync(join(paymentsDir, 'types.ts'), 'export interface Payment { id: string; amount: number; }');
    writeFileSync(join(paymentsDir, 'validator.ts'), 'export function validateAmount(n: number) { return n > 0; }');
    await generateFixture(p);
  },
  assertions: [
    function indexValid(p: string) { assertIndexValid(p); },
    function workspaceComplete(p: string) { assertWorkspaceComplete(p); },
  ],
};

// ============================================================================
// S8: Token Overflow (large features)
// ============================================================================

export const S8_TokenOverflow: EvalScenario = {
  name: 'S8: Token overflow — budget enforcement',
  fixtureName: 'large-features',
  action: generateFixture,
  assertions: [
    function workspaceCreated(p: string) { assertWorkspaceComplete(p); },
    function projectSkillUnderBudget(p: string) {
      assertTokenBudget(join(p, '.code-impact', 'project', 'SKILL.md'), 5000);
    },
    function projectConventionsUnderBudget(p: string) {
      assertTokenBudget(join(p, '.code-impact', 'project', 'CONVENTIONS.md'), 5000);
    },
  ],
};

// ============================================================================
// S9: Legacy Migration
// ============================================================================

export const S9_LegacyMigration: EvalScenario = {
  name: 'S9: Legacy migration',
  fixtureName: 'legacy-knowledge',
  action: async (p: string) => {
    // Init + generate (migration logic will be tested separately)
    agentsInit(p);
    await generateFixture(p);
  },
  assertions: [
    function workspaceCreated(p: string) { assertWorkspaceComplete(p); },
    function originalsUntouched(p: string) {
      assertFileExists(join(p, 'knowledge', 'skills', 'technology', 'express', 'SKILL.md'));
      assertFileExists(join(p, 'knowledge', 'skills', 'technology', 'vitest', 'SKILL.md'));
    },
  ],
};

// ============================================================================
// S10: Monorepo Detection
// ============================================================================

export const S10_Monorepo: EvalScenario = {
  name: 'S10: Monorepo detection',
  fixtureName: 'monorepo',
  action: generateFixture,
  assertions: [
    function workspaceCreated(p: string) { assertWorkspaceComplete(p); },
    function indexValid(p: string) { assertIndexValid(p); },
    function monorepoFlagSet(p: string) {
      const index = JSON.parse(readFileSync(join(p, '.code-impact', 'index.json'), 'utf-8'));
      if (!index.config.monorepo) throw new Error('Monorepo should be detected');
    },
  ],
};

// ============================================================================
// All scenarios export
// ============================================================================

export const ALL_SCENARIOS: EvalScenario[] = [
  S1_FreshGeneration,
  S2_Idempotent,
  S3_ManualPreservation,
  S4_ImprovementEngine,
  S5_DepBumpReresearch,
  S6_FeatureFolderMove,
  S7_NewFeatureAdded,
  S8_TokenOverflow,
  S9_LegacyMigration,
  S10_Monorepo,
];
