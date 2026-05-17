/**
 * Agent Generator — renders AGENT.md files for the super agent and feature agents.
 * Also generates the top-level AGENTS.md shim for Claude Code, Cursor, and Codex.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AgentConfig, AgentDefinition, DetectedFeature, AgentScope, LessonEntry } from './types.js';
import { getAgentWorkspacePaths, updateMarkedSection, readAgentConfig } from './workspace.js';

// ============================================================================
// Public API
// ============================================================================

export interface AgentGeneratorResult {
  filesWritten: string[];
  filesSkipped: string[];
  agents: AgentDefinition[];
}

export function generateAgentFiles(
  projectPath: string,
  features: DetectedFeature[],
): AgentGeneratorResult {
  const config = readAgentConfig(projectPath);
  const paths = getAgentWorkspacePaths(projectPath);
  const result: AgentGeneratorResult = { filesWritten: [], filesSkipped: [], agents: [] };

  // Generate project/AGENT.md (super agent / coordinator)
  const superAgent = buildSuperAgentDefinition(features);
  const superAgentPath = join(paths.projectDir, 'AGENT.md');
  mkdirSync(paths.projectDir, { recursive: true });
  writeAgentMd(superAgentPath, superAgent, config, result);
  result.agents.push(superAgent);

  // Generate feature agents
  for (const feature of features) {
    const agent = buildFeatureAgentDefinition(feature);
    const featureDir = join(paths.featuresDir, feature.name);
    mkdirSync(featureDir, { recursive: true });
    const agentPath = join(featureDir, 'AGENT.md');
    writeAgentMd(agentPath, agent, config, result);
    result.agents.push(agent);
  }

  return result;
}

export function generateAgentsShim(
  projectPath: string,
  agents: AgentDefinition[],
): { path: string; written: boolean } {
  const config = readAgentConfig(projectPath);
  const agentsPath = join(projectPath, 'AGENTS.md');
  const content = renderAgentsShim(agents, config);

  if (existsSync(agentsPath)) {
    const existing = readFileSync(agentsPath, 'utf-8');
    const updated = updateMarkedSection(existing, content, config.markers);
    if (updated !== existing) {
      writeFileSync(agentsPath, updated);
      return { path: agentsPath, written: true };
    }
    return { path: agentsPath, written: false };
  }

  writeFileSync(agentsPath, `${config.markers.start}\n${content}\n${config.markers.end}\n`);
  return { path: agentsPath, written: true };
}

// ============================================================================
// Agent Definition Builders
// ============================================================================

function buildSuperAgentDefinition(features: DetectedFeature[]): AgentDefinition {
  return {
    name: 'project-coordinator',
    type: 'super-agent',
    description: 'Meta-agent that owns feature detection, sub-agent creation, research orchestration, and system improvement.',
    version: '1.0',
    scope: {
      includedPaths: ['**'],
      excludedPaths: ['node_modules/**', 'dist/**', '.git/**'],
    },
    allowedTools: [
      'memory_query', 'memory_review', 'memory_evolve', 'memory_status',
      'memory_verify', 'memory_ghost', 'memory_blast_radius',
      'listAgents', 'getAgent', 'validateAction', 'recordOutcome',
      'proposeImprovement', 'getResearch', 'listSkills', 'getSkill',
    ],
    successCriteria: [
      'All feature agents have ≥1 successful outcome in last 7 days',
      'Research files are ≤7 days stale',
      'No agent has >30% failure rate over 10+ outcomes',
    ],
    lessonsLearned: [],
  };
}

function buildFeatureAgentDefinition(feature: DetectedFeature): AgentDefinition {
  return {
    name: `${feature.name}-agent`,
    type: 'feature-agent',
    description: `Manages ${feature.name} code. Consult before any change to ${feature.name} files.`,
    version: '1.0',
    metadata: {
      feature: feature.name,
      created_by: 'code-impact',
    },
    scope: {
      includedPaths: [...feature.paths, ...feature.testFiles],
      excludedPaths: feature.paths.map(p => p.replace('/**', '/__mocks__/**')),
    },
    allowedTools: [
      'memory_query', 'memory_review', 'memory_verify',
    ],
    successCriteria: [
      `All ${feature.name} tests pass after changes`,
      'No security warnings from memory_verify',
    ],
    lessonsLearned: [],
  };
}

// ============================================================================
// AGENT.md Renderer
// ============================================================================

function writeAgentMd(
  filePath: string,
  agent: AgentDefinition,
  config: AgentConfig,
  result: AgentGeneratorResult,
): void {
  // If file exists, only update lessons-learned section
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    if (existing.includes(config.markers.start)) {
      const lessonsContent = renderLessonsSection(agent.lessonsLearned);
      const updated = updateMarkedSection(existing, lessonsContent, config.markers);
      if (updated !== existing) {
        writeFileSync(filePath, updated);
        result.filesWritten.push(filePath);
      } else {
        result.filesSkipped.push(filePath);
      }
    } else {
      result.filesSkipped.push(filePath);
    }
    return;
  }

  // New file — render full AGENT.md
  const content = renderFullAgentMd(agent, config);
  writeFileSync(filePath, content);
  result.filesWritten.push(filePath);
}

function renderFullAgentMd(agent: AgentDefinition, config: AgentConfig): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`name: ${agent.name}`);
  lines.push(`type: ${agent.type}`);
  lines.push(`description: ${agent.description}`);
  lines.push(`version: ${agent.version}`);
  if (agent.metadata) {
    lines.push('metadata:');
    for (const [key, val] of Object.entries(agent.metadata)) {
      lines.push(`  ${key}: ${val}`);
    }
  }
  lines.push('---');
  lines.push('');

  // Title
  const title = agent.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  lines.push(`# ${title}`);
  lines.push('');

  // Role (super agent only)
  if (agent.type === 'super-agent') {
    lines.push('## Role');
    lines.push('You are the system coordinator. You manage sub-agents, orchestrate research, and improve the knowledge system over time.');
    lines.push('');
  }

  // Scope
  lines.push('## Scope');
  lines.push(`- **Included paths**: ${agent.scope.includedPaths.join(', ')}`);
  if (agent.scope.excludedPaths.length > 0) {
    lines.push(`- **Excluded paths**: ${agent.scope.excludedPaths.join(', ')}`);
  }
  lines.push('');

  // Allowed Tools
  lines.push('## Allowed Tools');
  for (const tool of agent.allowedTools) {
    lines.push(`- ${tool}`);
  }
  lines.push('');

  // Success Criteria
  lines.push('## Success Criteria');
  for (const criterion of agent.successCriteria) {
    lines.push(`- ${criterion}`);
  }
  lines.push('');

  // Sub-Agent Management Rules (super agent only)
  if (agent.type === 'super-agent') {
    lines.push('## Sub-Agent Management Rules');
    lines.push('- A feature must have ≥3 source files to warrant a dedicated agent');
    lines.push('- Agent scope must be non-overlapping (no file belongs to two feature agents)');
    lines.push('- Merge agents when two features are always changed together (>80% co-change rate)');
    lines.push('- Split agents when a feature grows beyond 30 files');
    lines.push('');
  }

  // Lessons Learned (marker-managed)
  lines.push(config.markers.start);
  lines.push('## Lessons Learned');
  if (agent.lessonsLearned.length > 0) {
    for (const lesson of agent.lessonsLearned) {
      const confirmed = lesson.confirmed ? '' : ' [unconfirmed]';
      lines.push(`- ${lesson.date}: ${lesson.content}${confirmed}`);
    }
  } else {
    lines.push('[No lessons recorded yet]');
  }
  lines.push(config.markers.end);
  lines.push('');

  return lines.join('\n');
}

function renderLessonsSection(lessons: LessonEntry[]): string {
  const lines = ['## Lessons Learned'];
  if (lessons.length > 0) {
    for (const lesson of lessons) {
      const confirmed = lesson.confirmed ? '' : ' [unconfirmed]';
      lines.push(`- ${lesson.date}: ${lesson.content}${confirmed}`);
    }
  } else {
    lines.push('[No lessons recorded yet]');
  }
  return lines.join('\n');
}

// ============================================================================
// AGENTS.md Shim Renderer
// ============================================================================

function renderAgentsShim(agents: AgentDefinition[], config: AgentConfig): string {
  const lines: string[] = [];

  lines.push('# CodeImpact Agent System');
  lines.push('');
  lines.push('This repository uses CodeImpact\'s multi-agent system for intelligent code management.');
  lines.push('');

  lines.push('## Available Agents');
  lines.push('');
  lines.push('| Agent | Type | Scope | Description |');
  lines.push('|-------|------|-------|-------------|');
  for (const agent of agents) {
    const scope = agent.scope.includedPaths.slice(0, 2).join(', ');
    lines.push(`| ${agent.name} | ${agent.type} | ${scope} | ${agent.description} |`);
  }
  lines.push('');

  lines.push('## How to Use');
  lines.push('');
  lines.push('### Query an Agent');
  lines.push('```');
  lines.push('Use mcp__codeimpact__memory_agents with action="get_agent" and name="<agent-name>"');
  lines.push('```');
  lines.push('');

  lines.push('### Validate Scope');
  lines.push('Before modifying files, check if the action is within agent scope:');
  lines.push('```');
  lines.push('Use mcp__codeimpact__memory_agents with action="validate_action"');
  lines.push('```');
  lines.push('');

  lines.push('### Record Outcomes');
  lines.push('After completing a task, record the result for learning:');
  lines.push('```');
  lines.push('Use mcp__codeimpact__memory_agents with action="record_outcome"');
  lines.push('```');
  lines.push('');

  lines.push('## Directory Structure');
  lines.push('```');
  lines.push(`.code-impact/`);
  lines.push(`├── config.yaml          # Configuration`);
  lines.push(`├── index.json           # Manifest`);
  lines.push(`├── project/             # Project-wide knowledge`);
  lines.push(`│   ├── SKILL.md`);
  lines.push(`│   ├── CONVENTIONS.md`);
  lines.push(`│   ├── ARCHITECTURE.md`);
  lines.push(`│   └── AGENT.md         # Super agent (coordinator)`);
  lines.push(`├── research/            # Distilled tech documentation`);
  lines.push(`└── features/            # Feature-specific knowledge`);
  lines.push(`    └── {name}/`);
  lines.push(`        ├── SKILL.md`);
  lines.push(`        └── AGENT.md`);
  lines.push('```');
  lines.push('');

  // Feature agent details
  const featureAgents = agents.filter(a => a.type === 'feature-agent');
  if (featureAgents.length > 0) {
    lines.push('## Feature Agents');
    lines.push('');
    for (const agent of featureAgents) {
      lines.push(`### ${agent.name}`);
      lines.push(`- **Scope**: ${agent.scope.includedPaths.join(', ')}`);
      lines.push(`- **Tools**: ${agent.allowedTools.join(', ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Agent Definition Parser (for reading existing AGENT.md files)
// ============================================================================

export function parseAgentMd(content: string): AgentDefinition | null {
  try {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const fm = frontmatterMatch[1] || '';
    const getValue = (key: string): string => {
      const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return match && match[1] ? match[1].trim() : '';
    };

    const name = getValue('name');
    const type = getValue('type') as AgentDefinition['type'];
    const description = getValue('description');
    const version = getValue('version');

    if (!name || !type) return null;

    // Parse scope from body
    const scopeMatch = content.match(/## Scope\n([\s\S]*?)(?=\n##|\n---)/);
    const scope: AgentScope = { includedPaths: [], excludedPaths: [] };
    if (scopeMatch && scopeMatch[1]) {
      const scopeLines = scopeMatch[1].split('\n');
      for (const line of scopeLines) {
        const inclMatch = line.match(/\*\*Included paths?\*\*:\s*(.+)/);
        if (inclMatch && inclMatch[1]) {
          scope.includedPaths = inclMatch[1].split(',').map(s => s.trim());
        }
        const exclMatch = line.match(/\*\*Excluded paths?\*\*:\s*(.+)/);
        if (exclMatch && exclMatch[1]) {
          scope.excludedPaths = exclMatch[1].split(',').map(s => s.trim());
        }
      }
    }

    // Parse allowed tools
    const toolsMatch = content.match(/## Allowed Tools\n([\s\S]*?)(?=\n##|\n---)/);
    const allowedTools: string[] = [];
    if (toolsMatch && toolsMatch[1]) {
      const toolLines = toolsMatch[1].split('\n');
      for (const line of toolLines) {
        const toolMatch = line.match(/^- (.+)/);
        if (toolMatch && toolMatch[1]) allowedTools.push(toolMatch[1].trim());
      }
    }

    // Parse success criteria
    const criteriaMatch = content.match(/## Success Criteria\n([\s\S]*?)(?=\n##|\n---)/);
    const successCriteria: string[] = [];
    if (criteriaMatch && criteriaMatch[1]) {
      const criteriaLines = criteriaMatch[1].split('\n');
      for (const line of criteriaLines) {
        const critMatch = line.match(/^- (.+)/);
        if (critMatch && critMatch[1]) successCriteria.push(critMatch[1].trim());
      }
    }

    // Parse lessons learned
    const lessonsMatch = content.match(/## Lessons Learned\n([\s\S]*?)(?=\n##|\n---|\n<!--)/);
    const lessonsLearned: LessonEntry[] = [];
    if (lessonsMatch && lessonsMatch[1]) {
      const lessonLines = lessonsMatch[1].split('\n');
      for (const line of lessonLines) {
        const lessonMatch = line.match(/^- (\d{4}-\d{2}-\d{2}): (.+?)(\s*\[unconfirmed\])?$/);
        if (lessonMatch && lessonMatch[1] && lessonMatch[2]) {
          lessonsLearned.push({
            date: lessonMatch[1],
            content: lessonMatch[2],
            confirmed: !lessonMatch[3],
          });
        }
      }
    }

    return {
      name,
      type,
      description,
      version,
      scope,
      allowedTools,
      successCriteria,
      lessonsLearned,
    };
  } catch {
    return null;
  }
}
