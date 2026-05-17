/**
 * Core type definitions for the Super Agent System.
 * Covers config, index manifest, detected technologies, features, and agent definitions.
 */

// ============================================================================
// Config Schema (config.yaml)
// ============================================================================

export interface AgentConfig {
  version: number;
  output_dir: string;
  branch: string;
  auto_research: boolean;
  research_cadence_hours: number;
  research_max_tokens_per_tech: number;
  auto_pr: boolean;
  monorepo: 'auto' | boolean;
  feature_detection: FeatureDetectionConfig;
  ignore_patterns: string[];
  markers: MarkerConfig;
}

export interface FeatureDetectionConfig {
  min_files: number;
  min_cohesion: number;
  max_features: number;
  respect_codeowners: boolean;
  respect_package_boundaries: boolean;
}

export interface MarkerConfig {
  start: string;
  end: string;
}

// ============================================================================
// Index Manifest (index.json)
// ============================================================================

export interface AgentIndex {
  version: string;
  generatedAt: string;
  projectPath: string;
  config: {
    branch: string;
    monorepo: boolean;
  };
  technologies: DetectedTechnology[];
  features: DetectedFeatureEntry[];
  project: ProjectFiles;
  lastResearch: Record<string, string>;
  outcomes: OutcomeSummary;
  reResearchQueue?: ReResearchEntry[];
  lifecycleProposals?: unknown[];
}

export interface ProjectFiles {
  skillFile: string;
  conventionsFile: string;
  architectureFile: string;
  agentFile: string;
}

export interface OutcomeSummary {
  total: number;
  successes: number;
  failures: number;
  lastDiagnosed?: string;
}

export interface ReResearchEntry {
  technology: string;
  reason: 'outcome' | 'cadence' | 'version-bump';
  priority: 'high' | 'medium' | 'low';
  timestamp?: string;
}

// ============================================================================
// Technology Detection
// ============================================================================

export interface DetectedTechnology {
  name: string;
  version: string;
  source: string;
  lockfileEntry?: string;
  researchFile?: string;
  importPaths?: string[];
}

// ============================================================================
// Feature Detection
// ============================================================================

export interface DetectedFeature {
  name: string;
  paths: string[];
  technologies: string[];
  testFiles: string[];
  cohesionScore: number;
  fileCount: number;
  owner?: string;
}

export interface DetectedFeatureEntry extends DetectedFeature {
  skillFile: string;
  agentFile: string;
}

// ============================================================================
// Agent Definitions
// ============================================================================

export type AgentType = 'super-agent' | 'feature-agent';

export interface AgentDefinition {
  name: string;
  type: AgentType;
  description: string;
  version: string;
  metadata?: Record<string, unknown>;
  scope: AgentScope;
  allowedTools: string[];
  successCriteria: string[];
  lessonsLearned: LessonEntry[];
}

export interface AgentScope {
  includedPaths: string[];
  excludedPaths: string[];
}

export interface LessonEntry {
  date: string;
  content: string;
  outcomeId?: string;
  confirmed: boolean;
}

// ============================================================================
// Outcome Recording
// ============================================================================

export interface OutcomeRecord {
  id: string;
  timestamp: string;
  agent: string;
  task: string;
  result: 'success' | 'failure' | 'partial';
  errorMessage?: string;
  errorFile?: string;
  diff?: string;
  fixApplied?: string;
  relatedSkills: string[];
  relatedResearch: string[];
  diagnosed: boolean;
  diagnosis?: DiagnosisResult;
}

export type DiagnosisCategory =
  | 'outdated-research'
  | 'missing-convention'
  | 'scope-error'
  | 'wrong-assumption'
  | 'missing-test'
  | 'external-change';

export interface DiagnosisResult {
  category: DiagnosisCategory;
  confidence: number;
  description: string;
  suggestedFix: string;
  targetFile?: string;
  targetSection?: string;
}

// ============================================================================
// Research
// ============================================================================

export interface ResearchFile {
  technology: string;
  version: string;
  sourceUrls: string[];
  installedFrom: string;
  lastFetched: string;
  nextRefresh: string;
  tokenCount: number;
  content: string;
}

export interface DocSource {
  packageNames: string[];
  docsUrl: string;
  apiRefUrl?: string;
  changelogUrl?: string;
  versionedUrlPattern?: string;
}

// ============================================================================
// Validate Action
// ============================================================================

export interface ValidateActionInput {
  agent: string;
  path: string;
  tool: string;
  action?: string;
}

export interface ValidateActionResult {
  allowed: boolean;
  reason?: string;
  suggestions?: string[];
}

// ============================================================================
// Propose Improvement
// ============================================================================

export interface ProposedImprovement {
  id: string;
  target: string;
  section: string;
  content: string;
  evidence: string;
  outcomeId?: string;
  status: 'pending' | 'applied' | 'rejected';
  createdAt: string;
}
