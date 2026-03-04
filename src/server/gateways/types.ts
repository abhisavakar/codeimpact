/**
 * Gateway Pattern Types
 *
 * Reduces 51 MCP tools to 4 gateway tools + 6 standalone,
 * saving ~5,000 tokens per API call on tool description overhead.
 */

// ============================================================================
// Memory Query Gateway Types
// ============================================================================

export type MemoryQueryAction =
  | 'context'      // get_context
  | 'search'       // search_codebase
  | 'file'         // get_file_context
  | 'summary'      // get_file_summary
  | 'symbol'       // get_symbol
  | 'dependencies' // get_dependencies
  | 'predict'      // get_predicted_files
  | 'confidence'   // get_confidence
  | 'sources'      // list_sources
  | 'existing';    // suggest_existing

export interface MemoryQueryInput {
  /** The search query or question */
  query: string;
  /** File path for file-specific operations */
  file?: string;
  /** Symbol name for symbol lookups */
  symbol?: string;
  /** Code snippet for confidence/source analysis */
  code?: string;
  /** Maximum number of results to return */
  max_results?: number;
  /** Include confidence scores in results */
  include_confidence?: boolean;
  /** Explicit action to perform (auto-detected if not provided) */
  action?: MemoryQueryAction;
  /** Symbol kind filter for symbol lookups */
  symbol_kind?: 'function' | 'class' | 'interface' | 'type' | 'method' | 'enum';
  /** Maximum tokens for context retrieval */
  max_tokens?: number;
}

export interface MemoryQueryResponse {
  /** Sources used to generate response */
  sources_used: string[];
  /** Aggregated context from multiple tools */
  context?: {
    content: string;
    sources: string[];
    token_count: number;
    decisions?: Array<{
      id: string;
      title: string;
      description: string;
      created_at: string;
    }>;
  };
  /** Search results */
  search_results?: Array<{
    file: string;
    preview: string;
    relevance: number;
    line_start?: number;
    line_end?: number;
  }>;
  /** File content */
  file_content?: {
    path: string;
    content: string;
    language: string;
    lines: number;
  };
  /** File summary */
  file_summary?: {
    path: string;
    summary: string;
  };
  /** Symbol results */
  symbols?: Array<{
    name: string;
    kind: string;
    file: string;
    line_start: number;
    line_end: number;
    signature?: string;
    exported: boolean;
  }>;
  /** Dependency information */
  dependencies?: {
    file: string;
    imports: Array<{ file: string; symbols: string[] }>;
    imported_by: Array<{ file: string; symbols: string[] }>;
    symbols: Array<{ name: string; kind: string; line: number; exported: boolean }>;
  };
  /** Predicted files */
  predicted_files?: {
    files: string[];
    pre_fetched: number;
  };
  /** Confidence assessment */
  confidence?: {
    level: string;
    score: number;
    reasoning: string;
    indicator: string;
  };
  /** Source attribution */
  source_attribution?: {
    codebase_matches: number;
    decision_matches: number;
    pattern_matches: number;
    used_general_knowledge: boolean;
  };
  /** Existing function suggestions */
  existing_functions?: Array<{
    name: string;
    file: string;
    line: number;
    signature: string;
    similarity: number;
  }>;
  /** Indicates if a fallback strategy was used */
  fallback_used?: boolean;
  /** Reason for using fallback */
  fallback_reason?: string;
}

// ============================================================================
// Memory Record Gateway Types
// ============================================================================

export type MemoryRecordType =
  | 'decision'   // record_decision, record_decision_with_author
  | 'pattern'    // learn_pattern
  | 'feedback'   // mark_context_useful
  | 'feature'    // set_feature_context
  | 'critical'   // mark_critical
  | 'example';   // add_pattern_example

export interface MemoryRecordInput {
  /** Content or description of what to record */
  content: string;
  /** Title for decisions */
  title?: string;
  /** Code snippet for patterns */
  code?: string;
  /** Pattern name for patterns */
  pattern_name?: string;
  /** Related files */
  files?: string[];
  /** Tags for categorization */
  tags?: string[];
  /** Author attribution */
  author?: string;
  /** Record type (auto-detected if not provided) */
  type?: MemoryRecordType;
  /** Explicit action to perform */
  action?: MemoryRecordType;
  /** Was the context useful (for feedback) */
  was_useful?: boolean;
  /** Original query (for feedback) */
  query?: string;
  /** Decision status */
  status?: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  /** Pattern category */
  category?: string;
  /** Pattern ID (for adding examples) */
  pattern_id?: string;
  /** Is this an anti-pattern example */
  is_anti_pattern?: boolean;
  /** Explanation for pattern examples */
  explanation?: string;
  /** Critical content type */
  critical_type?: 'decision' | 'requirement' | 'instruction' | 'custom';
  /** Reason for marking as critical */
  reason?: string;
}

export interface MemoryRecordResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** Type of record created */
  type: MemoryRecordType;
  /** ID of created record */
  id?: string;
  /** Human-readable message */
  message: string;
  /** Conflict warnings (for decisions) */
  warnings?: Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  /** Created record details */
  record?: Record<string, unknown>;
}

// ============================================================================
// Memory Review Gateway Types
// ============================================================================

export type MemoryReviewAction =
  | 'full'       // Run all checks
  | 'pattern'    // validate_pattern only
  | 'conflicts'  // check_conflicts only
  | 'tests'      // check_tests only
  | 'confidence' // get_confidence only
  | 'bugs'       // find_similar_bugs only
  | 'coverage';  // get_test_coverage only

export interface MemoryReviewInput {
  /** Code to review */
  code: string;
  /** File being changed (for test checks) */
  file?: string;
  /** What this code is for (context) */
  intent?: string;
  /** Include test impact analysis */
  include_tests?: boolean;
  /** Include pattern validation */
  include_patterns?: boolean;
  /** Error message (for bug search) */
  error?: string;
  /** Explicit action to perform */
  action?: MemoryReviewAction;
}

export interface MemoryReviewResponse {
  /** Overall verdict */
  verdict: 'approve' | 'warning' | 'reject';
  /** Unified risk score (0-100) */
  risk_score: number;
  /** Sources used for review */
  sources_used: string[];
  /** Pattern validation results */
  patterns?: {
    valid: boolean;
    score: number;
    matched_pattern?: string;
    violations: Array<{
      rule: string;
      message: string;
      severity: string;
      suggestion?: string;
    }>;
  };
  /** Conflict detection results */
  conflicts?: {
    has_conflicts: boolean;
    conflicts: Array<{
      decision_id: string;
      decision_title: string;
      conflict_description: string;
      severity: string;
    }>;
  };
  /** Existing alternatives found */
  existing_alternatives?: Array<{
    name: string;
    file: string;
    line: number;
    signature: string;
    similarity: number;
  }>;
  /** Test impact analysis */
  test_impact?: {
    safe: boolean;
    coverage_percent: number;
    would_fail: Array<{
      test_name: string;
      test_file: string;
      reason: string;
      suggested_fix?: string;
    }>;
    suggested_updates?: Array<{
      file: string;
      test_name: string;
      before: string;
      after: string;
      reason: string;
    }>;
  };
  /** Confidence assessment */
  confidence?: {
    level: string;
    score: number;
    reasoning: string;
  };
  /** Similar bugs from history */
  similar_bugs?: Array<{
    error: string;
    similarity: number;
    fix?: string;
    file?: string;
  }>;
  /** Test coverage details */
  coverage?: {
    file: string;
    total_tests: number;
    coverage_percent: number;
    uncovered_functions: string[];
  };
}

// ============================================================================
// Memory Status Gateway Types
// ============================================================================

export type MemoryStatusScope =
  | 'project'       // get_project_summary
  | 'architecture'  // get_architecture
  | 'changes'       // what_changed, what_happened
  | 'docs'          // validate_docs
  | 'health'        // get_context_health
  | 'patterns'      // list_patterns
  | 'tests'         // test statistics
  | 'all';          // everything

export type MemoryStatusAction =
  | 'summary'       // get_project_summary
  | 'happened'      // what_happened
  | 'changed'       // what_changed
  | 'architecture'  // get_architecture
  | 'changelog'     // get_changelog
  | 'health'        // get_context_health
  | 'patterns'      // list_patterns
  | 'stats'         // get_architecture_stats
  | 'undocumented'  // find_undocumented
  | 'critical'      // get_critical_context
  | 'learning';     // get_learning_stats

export interface MemoryStatusInput {
  /** Scope of status to retrieve */
  scope?: MemoryStatusScope;
  /** Time period for change queries */
  since?: string;
  /** File or directory filter */
  file?: string;
  /** Author filter */
  author?: string;
  /** Explicit action to perform */
  action?: MemoryStatusAction;
  /** Include health history */
  include_history?: boolean;
  /** Pattern category filter */
  category?: string;
  /** Changelog grouping */
  group_by?: 'day' | 'week';
  /** Include decisions in changelog */
  include_decisions?: boolean;
}

export interface MemoryStatusResponse {
  /** Sources used to generate status */
  sources_used: string[];
  /** Project summary */
  project?: {
    name: string;
    description?: string;
    languages: string[];
    total_files: number;
    total_lines: number;
    key_directories: string[];
    recent_decisions: Array<{
      id: string;
      title: string;
      created_at: string;
    }>;
  };
  /** Architecture overview */
  architecture?: {
    name: string;
    description: string;
    diagram?: string;
    layers: Array<{
      name: string;
      directory: string;
      files_count: number;
      purpose: string;
    }>;
    data_flow?: Array<{
      from: string;
      to: string;
      description: string;
    }>;
    key_components: Array<{
      name: string;
      file: string;
      purpose: string;
    }>;
  };
  /** Recent changes */
  changes?: {
    period: string;
    total_files: number;
    total_lines_added: number;
    total_lines_removed: number;
    by_author: Record<string, number>;
    recent: Array<{
      file: string;
      type: string;
      lines_added: number;
      lines_removed: number;
      author?: string;
      timestamp: string;
    }>;
  };
  /** Activity summary (what_happened) */
  activity?: {
    time_range: {
      since: string;
      until: string;
    };
    summary: string;
    changes_count: number;
    decisions_count: number;
    files_affected: string[];
  };
  /** Changelog */
  changelog?: Array<{
    date: string;
    summary: string;
    features: number;
    fixes: number;
    refactors: number;
  }>;
  /** Documentation health */
  docs?: {
    is_valid: boolean;
    score: number;
    outdated_count: number;
    undocumented_count: number;
    suggestions: Array<{
      file: string;
      suggestion: string;
      priority: string;
    }>;
  };
  /** Context health */
  health?: {
    health: string;
    tokens_used: number;
    tokens_limit: number;
    utilization: string;
    drift_detected: boolean;
    compaction_needed: boolean;
    suggestions: string[];
  };
  /** Pattern list */
  patterns?: {
    total: number;
    by_category: Record<string, number>;
    patterns: Array<{
      id: string;
      name: string;
      category: string;
      usage_count: number;
    }>;
  };
  /** Architecture stats */
  stats?: {
    patterns_total: number;
    functions_total: number;
    functions_exported: number;
  };
  /** Critical context */
  critical?: {
    total: number;
    by_type: Record<string, number>;
    items: Array<{
      id: string;
      type: string;
      content: string;
      reason?: string;
    }>;
  };
  /** Learning stats */
  learning?: {
    total_queries: number;
    total_file_views: number;
    top_files: Array<{ path: string; count: number }>;
    cache_size: number;
  };
  /** Undocumented items */
  undocumented?: {
    total: number;
    by_importance: Record<string, number>;
    items: Array<{
      file: string;
      symbol?: string;
      type: string;
      importance: string;
    }>;
  };
}

// ============================================================================
// Tool Definition Types
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Memory Verify Gateway Types
// ============================================================================

export type MemoryVerifyCheck = 'imports' | 'security' | 'dependencies' | 'patterns' | 'tests' | 'all';

export interface MemoryVerifyInput {
  /** Code to verify */
  code: string;
  /** Target file path (enables import resolution and test checks) */
  file?: string;
  /** Specific checks to run (default: all) */
  checks?: MemoryVerifyCheck[];
  /** Intent/purpose of the code (improves suggestions) */
  intent?: string;
}

export interface MemoryVerifyResponse {
  /** Overall verdict */
  verdict: 'pass' | 'warning' | 'fail';
  /** Quality score (0-100, higher is better) */
  score: number;
  /** Sources used for verification */
  sources_used: string[];
  /** Human-readable summary */
  summary: string;
  /** Import verification results */
  imports?: {
    valid: boolean;
    issues: Array<{
      import: string;
      type: 'missing_package' | 'missing_file' | 'invalid_export' | 'deprecated' | 'hallucinated';
      message: string;
      suggestion?: string;
    }>;
    warnings: Array<{
      import: string;
      type: 'outdated' | 'security' | 'deprecated_api';
      message: string;
      suggestion?: string;
    }>;
  };
  /** Security scan results */
  security?: {
    safe: boolean;
    score: number;
    issues: Array<{
      type: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      line?: number;
      code?: string;
      message: string;
      cwe?: string;
      suggestion?: string;
    }>;
  };
  /** Dependency check results */
  dependencies?: {
    valid: boolean;
    issues: Array<{
      package: string;
      type: 'not_installed' | 'version_mismatch' | 'deprecated' | 'vulnerable' | 'unlisted';
      message: string;
      suggestion?: string;
    }>;
  };
  /** Pattern validation results */
  patterns?: {
    valid: boolean;
    score: number;
    matched_pattern?: string;
    violations: Array<{
      rule: string;
      message: string;
      severity: string;
      suggestion?: string;
    }>;
  };
  /** Test impact results */
  test_impact?: {
    safe: boolean;
    coverage_percent: number;
    would_fail: Array<{
      test_name: string;
      test_file: string;
      reason: string;
      suggested_fix?: string;
    }>;
  };
  /** Decision conflict warnings */
  conflicts?: {
    has_conflicts: boolean;
    conflicts: Array<{
      decision_id: string;
      decision_title: string;
      warning: string;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  /** Actionable suggestions to fix issues */
  suggestions: string[];
}
