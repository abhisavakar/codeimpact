/**
 * Agent System — barrel export.
 * Provides the complete super agent system for CodeImpact.
 */

// Types
export type {
  AgentConfig,
  AgentIndex,
  DetectedTechnology,
  DetectedFeature,
  DetectedFeatureEntry,
  AgentDefinition,
  AgentType,
  AgentScope,
  LessonEntry,
  OutcomeRecord,
  DiagnosisCategory,
  DiagnosisResult,
  ResearchFile,
  DocSource,
  ValidateActionInput,
  ValidateActionResult,
  ProposedImprovement,
  FeatureDetectionConfig,
  MarkerConfig,
  ProjectFiles,
  OutcomeSummary,
  ReResearchEntry,
} from './types.js';

// Workspace
export {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_CONFIG,
  getAgentWorkspacePaths,
  initAgentWorkspace,
  readAgentConfig,
  writeAgentConfig,
  readAgentIndex,
  writeAgentIndex,
  createEmptyIndex,
  agentWorkspaceExists,
  ensureFeatureDir,
  updateMarkedSection,
  extractManualContent,
} from './workspace.js';

// Technology Detection
export {
  detectTechnologies,
  detectMonorepo,
} from './tech-detector.js';
export type { MonorepoInfo, MonorepoType } from './tech-detector.js';

// Feature Detection
export { detectFeatures } from './feature-detector.js';
export type { FeatureDetectorInput } from './feature-detector.js';

// Research Engine
export {
  researchTechnology,
  researchAllTechnologies,
  getResearchContent,
} from './research-engine.js';
export type { ResearchOptions, ResearchResult } from './research-engine.js';

// Generator
export { generateProjectFiles, generateFeatureFiles } from './generator.js';
export type { GeneratorInput, GeneratorResult } from './generator.js';

// Agent Generator
export { generateAgentFiles, generateAgentsShim, parseAgentMd } from './agent-generator.js';
export type { AgentGeneratorResult } from './agent-generator.js';

// Outcome Storage
export { createOutcomeTable, recordOutcome, getOutcome, queryOutcomes, markDiagnosed, getOutcomeStats } from './outcome-storage.js';

// Improvement Engine
export { runImprovementEngine, learnFromOutcome, promoteLessons, decayOldLessons } from './improvement-engine.js';
export type { ImprovementResult, LearnResult } from './improvement-engine.js';

// Git Operations
export {
  isGitRepo,
  getCurrentBranch,
  ensureBranch,
  commitChanges,
  pushBranch,
  commitAndPush,
  hasChanges,
  getDiffSummary,
  getChangedFiles,
  computeContentHash,
} from './git-operations.js';
export type { GitResult, CommitOptions } from './git-operations.js';

// Orchestrator (main entry points)
export { agentsInit, agentsGenerate, agentsStatus } from './orchestrator.js';
export type { OrchestratorOptions, InitResult, GenerateResult, StatusResult } from './orchestrator.js';

// Diagnosis Decision Table
export { diagnoseWithTable, diagnoseOutcome, DIAGNOSIS_RULES } from './diagnosis-table.js';
export type { DiagnosisRule, DiagnosisContext } from './diagnosis-table.js';

// MarkerAwareWriter
export { writeMarkedFile, SECTION_PRIORITIES } from './marker-writer.js';
export type { MarkedSection, WriteOptions, WriteResult } from './marker-writer.js';

// Token Budget
export { enforceTokenBudget, estimateTokens, getBudgetForFileType, getSectionPriority, DEFAULT_BUDGETS } from './token-budget.js';
export type { BudgetConfig, TruncationResult } from './token-budget.js';

// Migration
export { migrateKnowledge } from './migration.js';
export type { MigrationOptions, MigrationResult } from './migration.js';

// Research Trust
export { assessTrust, renderTrustFrontmatter, DEFAULT_TRUST_CONFIG } from './research-trust.js';
export type { TrustAssessment, TrustSignal, TrustConfig } from './research-trust.js';

// Remote Provider
export {
  detectProvider,
  createGitHubProvider,
  createGitLabProvider,
  createBitbucketProvider,
  createGenericProvider,
  RealGitExecutor,
  MockGitExecutor,
} from './remote-provider.js';
export type { RemoteProvider, GitExecutor, ProviderName, PROptions, PRStatus } from './remote-provider.js';

// Co-Change Analyzer
export { analyzeCoChanges, findMergeCandidates } from './co-change-analyzer.js';
export type { CoChangeEntry, CoChangeMatrix, CoChangeConfig } from './co-change-analyzer.js';

// Lifecycle Management
export { analyzeLifecycle, storeProposals, DEFAULT_LIFECYCLE_CONFIG } from './lifecycle.js';
export type { LifecycleConfig, LifecycleProposal, LifecycleResult, ProposalType } from './lifecycle.js';

// Telemetry
export { createTelemetryTable, emitTelemetry, queryTelemetry, getDashboard } from './telemetry.js';
export type { TelemetryEvent, TelemetryCategory, DashboardStats } from './telemetry.js';
