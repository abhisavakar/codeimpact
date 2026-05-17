/**
 * MCP Gateway: memory_agents
 * Provides agent system tools: list/get skills, agents, research,
 * validate actions, record outcomes, and propose improvements.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { CodeImpactEngine } from '../../core/engine.js';
import {
  getAgentWorkspacePaths,
  agentWorkspaceExists,
  readAgentIndex,
} from '../../core/agents/workspace.js';
import { parseAgentMd } from '../../core/agents/agent-generator.js';
import { getResearchContent } from '../../core/agents/research-engine.js';
import { createOutcomeTable, recordOutcome, queryOutcomes, getOutcomeStats } from '../../core/agents/outcome-storage.js';
import { learnFromOutcome } from '../../core/agents/improvement-engine.js';
import { createTelemetryTable, queryTelemetry, getDashboard, type TelemetryCategory } from '../../core/agents/telemetry.js';
import type { AgentDefinition, ValidateActionResult, ProposedImprovement } from '../../core/agents/types.js';

// ============================================================================
// Input/Output Types
// ============================================================================

export interface MemoryAgentsInput {
  action:
    | 'list_skills'
    | 'list_agents'
    | 'get_skill'
    | 'get_agent'
    | 'get_research'
    | 'validate_action'
    | 'record_outcome'
    | 'propose_improvement'
    | 'get_telemetry'
    | 'get_dashboard';
  // list_skills
  scope?: 'project' | 'feature';
  feature?: string;
  // get_skill / get_agent
  name?: string;
  // get_research
  technology?: string;
  version?: string;
  // validate_action
  agent?: string;
  path?: string;
  tool?: string;
  // record_outcome
  task?: string;
  result?: 'success' | 'failure' | 'partial';
  error?: string;
  error_file?: string;
  diff?: string;
  fix?: string;
  skills_used?: string[];
  research_used?: string[];
  // propose_improvement
  target?: string;
  section?: string;
  content?: string;
  evidence?: string;
  // get_telemetry
  category?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface MemoryAgentsResponse {
  success: boolean;
  action: string;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// Handler
// ============================================================================

export async function handleMemoryAgents(
  engine: CodeImpactEngine,
  input: MemoryAgentsInput,
): Promise<MemoryAgentsResponse> {
  const projectPath = engine.getProjectPath();

  if (!agentWorkspaceExists(projectPath)) {
    return {
      success: false,
      action: input.action,
      message: 'Agent workspace not initialized. Run `codeimpact agents init` first.',
    };
  }

  switch (input.action) {
    case 'list_skills':
      return handleListSkills(projectPath, input);
    case 'list_agents':
      return handleListAgents(projectPath);
    case 'get_skill':
      return handleGetSkill(projectPath, input);
    case 'get_agent':
      return handleGetAgent(projectPath, input);
    case 'get_research':
      return handleGetResearch(projectPath, input);
    case 'validate_action':
      return handleValidateAction(projectPath, input);
    case 'record_outcome':
      return handleRecordOutcome(engine, input);
    case 'propose_improvement':
      return handleProposeImprovement(projectPath, input);
    case 'get_telemetry':
      return handleGetTelemetry(engine, input);
    case 'get_dashboard':
      return handleGetDashboard(engine, input);
    default:
      return { success: false, action: input.action, message: `Unknown action: ${input.action}` };
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

function handleListSkills(projectPath: string, input: MemoryAgentsInput): MemoryAgentsResponse {
  const paths = getAgentWorkspacePaths(projectPath);
  const skills: Array<{ name: string; type: string; path: string; source: string }> = [];

  // Project-level skills (.code-impact/project/)
  if (!input.scope || input.scope === 'project') {
    const projectFiles = ['SKILL.md', 'CONVENTIONS.md', 'ARCHITECTURE.md'];
    for (const file of projectFiles) {
      const filePath = join(paths.projectDir, file);
      if (existsSync(filePath)) {
        skills.push({ name: file.replace('.md', '').toLowerCase(), type: 'project', path: `project/${file}`, source: '.code-impact' });
      }
    }
  }

  // Feature-level skills (.code-impact/features/)
  if (!input.scope || input.scope === 'feature') {
    if (existsSync(paths.featuresDir)) {
      const features = readdirSync(paths.featuresDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const feature of features) {
        if (input.feature && feature !== input.feature) continue;
        const skillPath = join(paths.featuresDir, feature, 'SKILL.md');
        if (existsSync(skillPath)) {
          skills.push({ name: `${feature}-skill`, type: 'feature', path: `features/${feature}/SKILL.md`, source: '.code-impact' });
        }
      }
    }
  }

  // Legacy knowledge/ skills (backward compat — read from both locations)
  const legacySkillsDir = join(projectPath, 'knowledge', 'skills');
  if (existsSync(legacySkillsDir)) {
    try {
      for (const scope of ['technology', 'feature', 'core', 'risk']) {
        const scopeDir = join(legacySkillsDir, scope);
        if (!existsSync(scopeDir)) continue;
        const skillDirs = readdirSync(scopeDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);

        for (const skillName of skillDirs) {
          const skillPath = join(scopeDir, skillName, 'SKILL.md');
          if (existsSync(skillPath)) {
            // Skip if already present in .code-impact (migrated)
            const alreadyListed = skills.some(s => s.name === skillName || s.name === `${skillName}-skill`);
            if (!alreadyListed) {
              skills.push({
                name: skillName,
                type: scope,
                path: `knowledge/skills/${scope}/${skillName}/SKILL.md`,
                source: 'knowledge',
              });
            }
          }
        }
      }
    } catch { /* ignore legacy read errors */ }
  }

  return {
    success: true,
    action: 'list_skills',
    message: `Found ${skills.length} skills`,
    data: { skills, count: skills.length },
  };
}

function handleListAgents(projectPath: string): MemoryAgentsResponse {
  const paths = getAgentWorkspacePaths(projectPath);
  const agents: Array<{ name: string; type: string; path: string; scope: string[] }> = [];

  // Super agent
  const superAgentPath = join(paths.projectDir, 'AGENT.md');
  if (existsSync(superAgentPath)) {
    const content = readFileSync(superAgentPath, 'utf-8');
    const agent = parseAgentMd(content);
    if (agent) {
      agents.push({
        name: agent.name,
        type: agent.type,
        path: 'project/AGENT.md',
        scope: agent.scope.includedPaths,
      });
    }
  }

  // Feature agents
  if (existsSync(paths.featuresDir)) {
    const features = readdirSync(paths.featuresDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const feature of features) {
      const agentPath = join(paths.featuresDir, feature, 'AGENT.md');
      if (existsSync(agentPath)) {
        const content = readFileSync(agentPath, 'utf-8');
        const agent = parseAgentMd(content);
        if (agent) {
          agents.push({
            name: agent.name,
            type: agent.type,
            path: `features/${feature}/AGENT.md`,
            scope: agent.scope.includedPaths,
          });
        }
      }
    }
  }

  return {
    success: true,
    action: 'list_agents',
    message: `Found ${agents.length} agents`,
    data: { agents, count: agents.length },
  };
}

function handleGetSkill(projectPath: string, input: MemoryAgentsInput): MemoryAgentsResponse {
  if (!input.name) {
    return { success: false, action: 'get_skill', message: 'Missing required parameter: name' };
  }

  const paths = getAgentWorkspacePaths(projectPath);

  // Check project-level
  const projectFile = join(paths.projectDir, `${input.name.toUpperCase()}.md`);
  if (existsSync(projectFile)) {
    return {
      success: true,
      action: 'get_skill',
      message: `Found project skill: ${input.name}`,
      data: { content: readFileSync(projectFile, 'utf-8'), path: `project/${input.name.toUpperCase()}.md` },
    };
  }

  // Check SKILL.md in project
  const skillFile = join(paths.projectDir, 'SKILL.md');
  if (input.name === 'project-overview' && existsSync(skillFile)) {
    return {
      success: true,
      action: 'get_skill',
      message: 'Found project skill',
      data: { content: readFileSync(skillFile, 'utf-8'), path: 'project/SKILL.md' },
    };
  }

  // Check feature-level
  const featureName = input.name.replace(/-skill$/, '').replace(/-feature$/, '');
  const featureSkill = join(paths.featuresDir, featureName, 'SKILL.md');
  if (existsSync(featureSkill)) {
    return {
      success: true,
      action: 'get_skill',
      message: `Found feature skill: ${featureName}`,
      data: { content: readFileSync(featureSkill, 'utf-8'), path: `features/${featureName}/SKILL.md` },
    };
  }

  return { success: false, action: 'get_skill', message: `Skill not found: ${input.name}` };
}

function handleGetAgent(projectPath: string, input: MemoryAgentsInput): MemoryAgentsResponse {
  if (!input.name) {
    return { success: false, action: 'get_agent', message: 'Missing required parameter: name' };
  }

  const paths = getAgentWorkspacePaths(projectPath);

  // Check super agent
  if (input.name === 'project-coordinator') {
    const superPath = join(paths.projectDir, 'AGENT.md');
    if (existsSync(superPath)) {
      const content = readFileSync(superPath, 'utf-8');
      const agent = parseAgentMd(content);
      return {
        success: true,
        action: 'get_agent',
        message: `Found agent: ${input.name}`,
        data: { content, parsed: agent, path: 'project/AGENT.md' },
      };
    }
  }

  // Check feature agents
  const featureName = input.name.replace(/-agent$/, '');
  const agentPath = join(paths.featuresDir, featureName, 'AGENT.md');
  if (existsSync(agentPath)) {
    const content = readFileSync(agentPath, 'utf-8');
    const agent = parseAgentMd(content);
    return {
      success: true,
      action: 'get_agent',
      message: `Found agent: ${input.name}`,
      data: { content, parsed: agent, path: `features/${featureName}/AGENT.md` },
    };
  }

  return { success: false, action: 'get_agent', message: `Agent not found: ${input.name}` };
}

function handleGetResearch(projectPath: string, input: MemoryAgentsInput): MemoryAgentsResponse {
  if (!input.technology) {
    return { success: false, action: 'get_research', message: 'Missing required parameter: technology' };
  }

  const content = getResearchContent(projectPath, input.technology, input.version);
  if (content) {
    return {
      success: true,
      action: 'get_research',
      message: `Found research for ${input.technology}`,
      data: { content, technology: input.technology, version: input.version },
    };
  }

  return { success: false, action: 'get_research', message: `No research found for: ${input.technology}` };
}

function handleValidateAction(projectPath: string, input: MemoryAgentsInput): MemoryAgentsResponse {
  if (!input.agent || !input.path) {
    return { success: false, action: 'validate_action', message: 'Missing required parameters: agent, path' };
  }

  const paths = getAgentWorkspacePaths(projectPath);

  // Load agent definition
  let agentDef: AgentDefinition | null = null;
  if (input.agent === 'project-coordinator') {
    const superPath = join(paths.projectDir, 'AGENT.md');
    if (existsSync(superPath)) {
      agentDef = parseAgentMd(readFileSync(superPath, 'utf-8'));
    }
  } else {
    const featureName = input.agent.replace(/-agent$/, '');
    const agentPath = join(paths.featuresDir, featureName, 'AGENT.md');
    if (existsSync(agentPath)) {
      agentDef = parseAgentMd(readFileSync(agentPath, 'utf-8'));
    }
  }

  if (!agentDef) {
    return {
      success: true,
      action: 'validate_action',
      message: `Agent not found: ${input.agent}`,
      data: { allowed: false, reason: `Agent "${input.agent}" not found` } satisfies ValidateActionResult,
    };
  }

  // Check path scope
  const pathAllowed = isPathInScope(input.path, agentDef.scope);

  // Check tool allowlist
  const toolAllowed = !input.tool || agentDef.allowedTools.includes(input.tool);

  if (pathAllowed && toolAllowed) {
    return {
      success: true,
      action: 'validate_action',
      message: 'Action allowed',
      data: { allowed: true } satisfies ValidateActionResult,
    };
  }

  // Suggest correct agent
  const suggestions: string[] = [];
  if (!pathAllowed) {
    suggestions.push(`Path "${input.path}" is outside ${input.agent}'s scope`);
    // Could suggest which agent owns this path
  }
  if (!toolAllowed) {
    suggestions.push(`Tool "${input.tool}" is not in ${input.agent}'s allowed tools`);
  }

  return {
    success: true,
    action: 'validate_action',
    message: 'Action denied',
    data: {
      allowed: false,
      reason: suggestions.join('; '),
      suggestions,
    } satisfies ValidateActionResult,
  };
}

function handleRecordOutcome(engine: CodeImpactEngine, input: MemoryAgentsInput): MemoryAgentsResponse {
  if (!input.agent || !input.task || !input.result) {
    return { success: false, action: 'record_outcome', message: 'Missing required parameters: agent, task, result' };
  }

  try {
    const db = engine.getDatabase();
    const projectPath = engine.getProjectPath();
    // Ensure table exists
    createOutcomeTable(db);

    const record = recordOutcome(db, {
      agent: input.agent,
      task: input.task,
      result: input.result,
      errorMessage: input.error,
      errorFile: input.error_file,
      diff: input.diff,
      fixApplied: input.fix,
      relatedSkills: input.skills_used,
      relatedResearch: input.research_used,
    });

    // Immediate self-learning: diagnose and act on this outcome right away
    let learnDetail: string | undefined;
    try {
      const learnResult = learnFromOutcome(db, projectPath, record);
      if (learnResult.learned) {
        learnDetail = `Self-improved: ${learnResult.action}${learnResult.detail ? ' — ' + learnResult.detail : ''}`;
      }
    } catch {
      // Learning is best-effort — don't fail the outcome recording
    }

    return {
      success: true,
      action: 'record_outcome',
      message: learnDetail
        ? `Outcome recorded: ${record.id}. ${learnDetail}`
        : `Outcome recorded: ${record.id}`,
      data: {
        id: record.id,
        agent: record.agent,
        result: record.result,
        selfImproved: !!learnDetail,
        learnDetail,
      },
    };
  } catch (err) {
    return {
      success: false,
      action: 'record_outcome',
      message: `Failed to record outcome: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function handleProposeImprovement(projectPath: string, input: MemoryAgentsInput): MemoryAgentsResponse {
  if (!input.target || !input.section || !input.content || !input.evidence) {
    return { success: false, action: 'propose_improvement', message: 'Missing required parameters: target, section, content, evidence' };
  }

  // Store improvement proposal in index.json for next generation cycle
  const index = readAgentIndex(projectPath);
  const proposal: ProposedImprovement = {
    id: `imp-${Date.now()}`,
    target: input.target,
    section: input.section,
    content: input.content,
    evidence: input.evidence,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  // We store proposals in a separate file to avoid bloating index.json
  const paths = getAgentWorkspacePaths(projectPath);
  const proposalsPath = join(paths.root, 'proposals.json');
  let proposals: ProposedImprovement[] = [];
  if (existsSync(proposalsPath)) {
    try {
      proposals = JSON.parse(readFileSync(proposalsPath, 'utf-8'));
    } catch { /* ignore */ }
  }
  proposals.push(proposal);

  writeFileSync(proposalsPath, JSON.stringify(proposals, null, 2));

  return {
    success: true,
    action: 'propose_improvement',
    message: `Improvement proposed: ${proposal.id}`,
    data: { id: proposal.id, target: input.target, section: input.section, status: 'pending' },
  };
}

function handleGetTelemetry(engine: CodeImpactEngine, input: MemoryAgentsInput): MemoryAgentsResponse {
  try {
    const db = engine.getDatabase();
    createTelemetryTable(db);

    const events = queryTelemetry(db, {
      category: input.category as TelemetryCategory | undefined,
      since: input.since,
      until: input.until,
      limit: input.limit || 20,
    });

    return {
      success: true,
      action: 'get_telemetry',
      message: `Found ${events.length} telemetry events`,
      data: { events, count: events.length },
    };
  } catch (err) {
    return {
      success: false,
      action: 'get_telemetry',
      message: `Failed to query telemetry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function handleGetDashboard(engine: CodeImpactEngine, input: MemoryAgentsInput): MemoryAgentsResponse {
  try {
    const db = engine.getDatabase();
    createTelemetryTable(db);

    const dashboard = getDashboard(db, input.since);
    return {
      success: true,
      action: 'get_dashboard',
      message: `Dashboard for period since ${dashboard.period}`,
      data: { dashboard },
    };
  } catch (err) {
    return {
      success: false,
      action: 'get_dashboard',
      message: `Failed to get dashboard: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// Scope Validation Helpers
// ============================================================================

function isPathInScope(filePath: string, scope: { includedPaths: string[]; excludedPaths: string[] }): boolean {
  // Check exclusions first
  for (const pattern of scope.excludedPaths) {
    if (matchGlob(filePath, pattern)) return false;
  }

  // Check inclusions
  for (const pattern of scope.includedPaths) {
    if (matchGlob(filePath, pattern)) return true;
  }

  return false;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching
  if (pattern === '**') return true;

  const normalized = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalized.startsWith(prefix + '/') || normalized === prefix;
  }

  if (normalizedPattern.includes('*')) {
    const regex = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    return new RegExp(`^${regex}$`).test(normalized);
  }

  return normalized === normalizedPattern || normalized.startsWith(normalizedPattern + '/');
}
