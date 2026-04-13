/**
 * Gateway Pattern Implementation
 *
 * Reduces 51 MCP tools to 6 gateway tools + curated standalone tools,
 * saving ~5,000 tokens per API call on tool description overhead.
 *
 * Benchmark Context: 759x speedup, 51.7% token reduction, p < 0.001, Cohen's d = 3.46
 *
 * Phase 12: Added memory_ghost for "Super Intelligent Brain" features
 * Phase 13: Added memory_verify for pre-commit quality gate
 */

import type { CodeImpactEngine } from '../../core/engine.js';
import type {
  ToolDefinition,
  MemoryQueryInput,
  MemoryRecordInput,
  MemoryReviewInput,
  MemoryStatusInput,
  MemoryVerifyInput,
} from './types.js';
import { handleMemoryQuery } from './memory-query.js';
import { handleMemoryRecord } from './memory-record.js';
import { handleMemoryReview } from './memory-review.js';
import { handleMemoryStatus } from './memory-status.js';
import { handleMemoryGhost, type MemoryGhostInput, type MemoryGhostResponse } from './memory-ghost.js';
import { handleMemoryVerify, type MemoryVerifyResponse } from './memory-verify.js';
import { handleMemoryEvolve, type MemoryEvolveInput, type MemoryEvolveResponse } from './memory-evolve.js';

// ============================================================================
// Gateway Tool Names
// ============================================================================

export const GATEWAY_TOOLS = [
  'memory_query',
  'memory_record',
  'memory_review',
  'memory_status',
  'memory_ghost',
  'memory_verify',
  'memory_evolve',
] as const;

export type GatewayToolName = typeof GATEWAY_TOOLS[number];

export function isGatewayTool(name: string): name is GatewayToolName {
  return GATEWAY_TOOLS.includes(name as GatewayToolName);
}

// ============================================================================
// Gateway Tool Definitions
// ============================================================================

export const gatewayDefinitions: ToolDefinition[] = [
  {
    name: 'memory_query',
    description: 'PREFERRED over Grep/Glob/Read for codebase questions. Use this FIRST when you need to: understand how something works ("how does auth work?", "where is X used?"), find related code/decisions/patterns, get file content with context (pass file path as query), look up function/class definitions (pass symbol name), or check if code follows project patterns (pass code snippet). Returns semantic search results ranked by relevance. 759x faster than grep with 50% fewer tokens. Auto-routes based on input type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or question'
        },
        file: {
          type: 'string',
          description: 'File path for file-specific operations'
        },
        symbol: {
          type: 'string',
          description: 'Symbol name for symbol lookups'
        },
        code: {
          type: 'string',
          description: 'Code snippet for confidence/source analysis'
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 10)'
        },
        include_confidence: {
          type: 'boolean',
          description: 'Include confidence scores in results'
        },
        action: {
          type: 'string',
          enum: ['context', 'search', 'file', 'summary', 'symbol', 'dependencies', 'predict', 'confidence', 'sources', 'existing'],
          description: 'Explicit action (auto-detected if not provided)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_record',
    description: 'Save important information to project memory. Use when: making architectural decisions (title + content auto-saves as decision), learning a code pattern (code + pattern_name auto-saves as pattern), user provides requirements (content + critical_type="requirement"), or starting work on a feature (content="feature name" tracks files touched). Decisions are checked for conflicts. Patterns are used in future code reviews. Critical items survive context compaction.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content or description of what to record'
        },
        title: {
          type: 'string',
          description: 'Title for decisions or patterns'
        },
        code: {
          type: 'string',
          description: 'Code snippet for patterns'
        },
        pattern_name: {
          type: 'string',
          description: 'Name for patterns'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related files'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization'
        },
        author: {
          type: 'string',
          description: 'Author attribution'
        },
        type: {
          type: 'string',
          enum: ['decision', 'pattern', 'feedback', 'feature', 'critical', 'example'],
          description: 'Record type (auto-detected if not provided)'
        },
        was_useful: {
          type: 'boolean',
          description: 'For feedback: whether context was useful'
        },
        pattern_id: {
          type: 'string',
          description: 'For examples: pattern ID to add to'
        },
        is_anti_pattern: {
          type: 'boolean',
          description: 'For examples: mark as anti-pattern'
        },
        critical_type: {
          type: 'string',
          enum: ['decision', 'requirement', 'instruction', 'custom'],
          description: 'For critical content: type of critical content'
        },
        reason: {
          type: 'string',
          description: 'Reason for marking as critical'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'memory_review',
    description: 'ALWAYS use before writing/suggesting code changes. Reviews against: project patterns (are you following conventions?), past decisions (does this conflict with architecture choices?), similar past bugs (has this error happened before?), and test coverage (will tests break?). Returns risk_score (0-100) and verdict (approve/warning/reject). Use verdict to decide whether to proceed. Include "intent" for better existing-function suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code to review'
        },
        file: {
          type: 'string',
          description: 'File being changed (enables test checks)'
        },
        intent: {
          type: 'string',
          description: 'What this code is for (improves suggestions)'
        },
        include_tests: {
          type: 'boolean',
          description: 'Include test impact analysis (default: true if file provided)'
        },
        include_patterns: {
          type: 'boolean',
          description: 'Include pattern validation (default: true)'
        },
        error: {
          type: 'string',
          description: 'Error message for bug search'
        },
        action: {
          type: 'string',
          enum: ['full', 'pattern', 'conflicts', 'tests', 'confidence', 'bugs', 'coverage'],
          description: 'Specific check to run (default: full review)'
        }
      },
      required: ['code']
    }
  },
  {
    name: 'memory_status',
    description: 'Use at SESSION START or when context feels stale. Returns: scope="project" for languages/file count/recent decisions/key directories, scope="architecture" for layer diagram/data flow/key components, scope="changes" + since="today" for what changed recently, scope="health" for context utilization/drift detection/compaction suggestions. Default (no args) gives project summary. Add since="this week" for recent activity.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['project', 'architecture', 'changes', 'docs', 'health', 'patterns', 'tests', 'all'],
          description: 'Scope of status to retrieve (default: project)'
        },
        since: {
          type: 'string',
          description: 'Time period for changes: "yesterday", "today", "this week", "this month", or date'
        },
        file: {
          type: 'string',
          description: 'File or directory to filter by'
        },
        author: {
          type: 'string',
          description: 'Author to filter changes by'
        },
        action: {
          type: 'string',
          enum: ['summary', 'happened', 'changed', 'architecture', 'changelog', 'health', 'patterns', 'stats', 'undocumented', 'critical', 'learning'],
          description: 'Specific status to retrieve'
        },
        include_history: {
          type: 'boolean',
          description: 'Include health history'
        },
        category: {
          type: 'string',
          description: 'Pattern category filter'
        }
      }
    }
  },
  {
    name: 'memory_ghost',
    description: 'The "Super Intelligent Brain" - provides proactive intelligence. Use mode="conflicts" before writing code to check for decision conflicts. Use mode="dejavu" to find "You solved this before" moments. Use mode="resurrect" at session start to get "Welcome back! Last time you were working on X". Use mode="full" (default) for complete ghost insight. Returns conflict warnings, déjà vu matches, and session resurrection data.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['full', 'conflicts', 'dejavu', 'resurrect'],
          description: 'What to check (default: full)'
        },
        code: {
          type: 'string',
          description: 'Code to check for conflicts/déjà vu'
        },
        file: {
          type: 'string',
          description: 'Current file being worked on'
        },
        query: {
          type: 'string',
          description: 'Query for déjà vu search'
        },
        feature_name: {
          type: 'string',
          description: 'Feature name for resurrection'
        },
        max_results: {
          type: 'number',
          description: 'Maximum déjà vu results (default: 5)'
        }
      }
    }
  },
  {
    name: 'memory_verify',
    description: 'Pre-commit quality gate for AI-generated code. Catches hallucinations, security issues, and integration problems BEFORE they land. Run before committing AI suggestions. Checks: imports (do they exist?), security (OWASP Top 10), dependencies (installed?), patterns (project conventions), tests (will they break?). Returns verdict (pass/warning/fail), score (0-100), and actionable suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code to verify'
        },
        file: {
          type: 'string',
          description: 'Target file path (enables import resolution and test checks)'
        },
        checks: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['imports', 'security', 'dependencies', 'patterns', 'tests', 'all']
          },
          description: 'Specific checks to run (default: all)'
        },
        intent: {
          type: 'string',
          description: 'What this code is for (improves suggestions)'
        }
      },
      required: ['code']
    }
  },
  {
    name: 'memory_evolve',
    description: 'AI-driven knowledge building using agentskills.io SKILL.md format. action="create_skill" to write a new SKILL.md (provide name, description, scope, content as the full markdown body). action="improve_skill" to patch or append to an existing skill (provide skill_id + old_text/new_text for patches, or section + content to append). action="create_doc" to write documentation. action="report_outcome" for task feedback. action="list_signals" to see uncovered technologies, high-risk files, and knowledge gaps. action="get_evolution_status" for usage stats.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_skill', 'improve_skill', 'create_doc', 'report_outcome', 'list_signals', 'get_evolution_status'],
          description: 'What to do'
        },
        name: {
          type: 'string',
          description: 'Skill name (slug-friendly, e.g. "better-sqlite3-patterns") for create_skill'
        },
        description: {
          type: 'string',
          description: 'One-line description of when to use this skill (for create_skill)'
        },
        scope: {
          type: 'string',
          enum: ['core', 'technology', 'feature', 'risk'],
          description: 'Skill scope for create_skill (default: feature)'
        },
        content: {
          type: 'string',
          description: 'Full SKILL.md markdown body for create_skill, content to append for improve_skill, or full markdown for create_doc'
        },
        skill_id: {
          type: 'string',
          description: 'Skill name to improve or query (for improve_skill, get_evolution_status)'
        },
        section: {
          type: 'string',
          description: 'Section to append to (for improve_skill): rules, pitfalls, verification, steps, when_to_use, key_facts'
        },
        old_text: {
          type: 'string',
          description: 'Text to find and replace in the skill (for improve_skill patch mode)'
        },
        new_text: {
          type: 'string',
          description: 'Replacement text (for improve_skill patch mode)'
        },
        reason: {
          type: 'string',
          description: 'Why this change is needed'
        },
        outcome: {
          type: 'string',
          enum: ['success', 'failure', 'partial'],
          description: 'Task outcome for report_outcome'
        },
        skills_used: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skill names that were relevant for report_outcome'
        },
        file: {
          type: 'string',
          description: 'Source file path (for create_doc or report_outcome)'
        },
        feature_name: {
          type: 'string',
          description: 'Feature name (for create_doc)'
        },
        doc_type: {
          type: 'string',
          enum: ['component', 'feature', 'architecture'],
          description: 'Documentation type for create_doc (default: feature)'
        },
        task_description: {
          type: 'string',
          description: 'Brief task description for outcome context'
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata key-value pairs for create_skill frontmatter'
        }
      },
      required: ['action']
    }
  }
];

// ============================================================================
// Standalone Tool Definitions (Require Explicit IDs/Actions)
// ============================================================================

export const standaloneDefinitions: ToolDefinition[] = [
  {
    name: 'switch_project',
    description: 'Switch active project context. Use when user mentions a different project by name. Get project_id from memory_status first.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project ID to switch to'
        }
      },
      required: ['project_id']
    }
  },
  {
    name: 'switch_feature_context',
    description: 'Resume tracking a previous feature. Use when user says "back to [feature]" or "continue [feature]". Get context_id from memory_status action=learning.',
    inputSchema: {
      type: 'object',
      properties: {
        context_id: {
          type: 'string',
          description: 'ID of the context to switch to (from list_recent_contexts)'
        }
      },
      required: ['context_id']
    }
  },
  {
    name: 'trigger_compaction',
    description: 'Reduce memory token usage when memory_status shows health="warning" or compaction_needed=true. Strategy: summarize (safe), selective (moderate), aggressive (maximum savings).',
    inputSchema: {
      type: 'object',
      properties: {
        strategy: {
          type: 'string',
          enum: ['summarize', 'selective', 'aggressive'],
          description: 'Compaction strategy: summarize (gentle), selective (moderate), aggressive (maximum reduction)'
        },
        preserve_recent: {
          type: 'number',
          description: 'Number of recent messages to preserve (default: 10)'
        },
        target_utilization: {
          type: 'number',
          description: 'Target utilization percentage (e.g., 50 for 50%)'
        }
      }
    }
  },
  {
    name: 'update_decision_status',
    description: 'Mark a decision as deprecated/superseded when architecture changes. Get decision_id from memory_query first. Use superseded_by to link to replacement decision.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: {
          type: 'string',
          description: 'ID of the decision to update'
        },
        status: {
          type: 'string',
          enum: ['proposed', 'accepted', 'deprecated', 'superseded'],
          description: 'New status for the decision'
        },
        superseded_by: {
          type: 'string',
          description: 'ID of the decision that supersedes this one (if status is superseded)'
        }
      },
      required: ['decision_id', 'status']
    }
  },
  {
    name: 'export_decisions_to_adr',
    description: 'Export decisions as Architecture Decision Records. Use when user asks for documentation or "ADRs". Creates docs/decisions/*.md files.',
    inputSchema: {
      type: 'object',
      properties: {
        output_dir: {
          type: 'string',
          description: 'Output directory for ADR files (default: docs/decisions)'
        },
        format: {
          type: 'string',
          enum: ['madr', 'nygard', 'simple'],
          description: 'ADR format to use (default: madr)'
        },
        include_index: {
          type: 'boolean',
          description: 'Generate README index file (default: true)'
        }
      }
    }
  },
  {
    name: 'discover_projects',
    description: 'Find git repositories on the system. Use when user wants to add/register a project to CodeImpact.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'knowledge_status',
    description: 'Get autonomous knowledge workspace status: skills/docs/providers counts and workspace location.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'knowledge_generate',
    description: 'Generate autonomous knowledge artifacts (skills/docs) and sync platform instruction files.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for generation'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview without writing files'
        }
      }
    }
  },
  {
    name: 'knowledge_sync_rules',
    description: 'Sync cross-platform rule/instruction files from the knowledge workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        dry_run: {
          type: 'boolean',
          description: 'Preview without writing files'
        }
      }
    }
  },
  {
    name: 'knowledge_research',
    description: 'Refresh provider research notes used by generated skills and docs.',
    inputSchema: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Provider topics to refresh'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview without writing files'
        }
      }
    }
  },
  {
    name: 'memory_blast_radius',
    description: 'BEFORE changing critical files, use this to understand impact. Returns: risk_score (0-100), affected files count, critical paths (auth, payment, security), test coverage, and recommendations (e.g., "Senior review required"). Use for: high-risk changes, unfamiliar code areas, files with many dependents. Helps answer: "Is it safe to change this file?"',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to the file to analyze'
        },
        max_depth: {
          type: 'number',
          description: 'Maximum dependency depth to analyze (1-10, default: 3)'
        }
      },
      required: ['file']
    }
  }
];

// ============================================================================
// Combined Definitions (for backward compatibility)
// ============================================================================

export const allToolDefinitions: ToolDefinition[] = [
  ...gatewayDefinitions,
  ...standaloneDefinitions,
];

// ============================================================================
// Gateway Handler
// ============================================================================

/**
 * Handle a gateway tool call, routing to the appropriate internal tools
 */
export async function handleGatewayCall(
  engine: CodeImpactEngine,
  gatewayName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (gatewayName) {
    case 'memory_query':
      return handleMemoryQuery(engine, args as unknown as MemoryQueryInput);

    case 'memory_record':
      return handleMemoryRecord(engine, args as unknown as MemoryRecordInput);

    case 'memory_review':
      return handleMemoryReview(engine, args as unknown as MemoryReviewInput);

    case 'memory_status':
      return handleMemoryStatus(engine, args as unknown as MemoryStatusInput);

    case 'memory_ghost':
      return handleMemoryGhost(engine, args as unknown as MemoryGhostInput);

    case 'memory_verify':
      return handleMemoryVerify(engine, args as unknown as MemoryVerifyInput);

    case 'memory_evolve':
      return handleMemoryEvolve(engine, args as unknown as MemoryEvolveInput);

    default:
      throw new Error(`Unknown gateway: ${gatewayName}`);
  }
}

// Re-export types
export type {
  ToolDefinition,
  MemoryQueryInput,
  MemoryQueryResponse,
  MemoryRecordInput,
  MemoryRecordResponse,
  MemoryReviewInput,
  MemoryReviewResponse,
  MemoryStatusInput,
  MemoryStatusResponse,
  MemoryVerifyInput,
  MemoryVerifyResponse,
} from './types.js';

export type { MemoryGhostInput, MemoryGhostResponse } from './memory-ghost.js';
export type { MemoryVerifyResponse as VerifyResponse } from './memory-verify.js';
export type { MemoryEvolveInput, MemoryEvolveResponse } from './memory-evolve.js';
