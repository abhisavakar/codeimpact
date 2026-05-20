import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { KnowledgeWorkspacePaths } from './workspace.js';

export interface PlatformSyncResult {
  path: string;
  updated: boolean;
  mode: 'created' | 'updated' | 'noop';
}

export interface PlatformSyncOptions {
  dryRun?: boolean;
}

type Platform = 'cursor' | 'claude' | 'codex' | 'windsurf';

const START_MARKER = '<!-- codeimpact:knowledge:start -->';
const END_MARKER = '<!-- codeimpact:knowledge:end -->';

function updateSection(existing: string, section: string): { content: string; changed: boolean } {
  const block = `${START_MARKER}\n${section.trim()}\n${END_MARKER}`;
  if (!existing.trim()) {
    return { content: `${block}\n`, changed: true };
  }

  // Strip ALL existing marker blocks (handles accumulated duplicates)
  let cleaned = existing;
  let hadMarkers = false;
  while (true) {
    const start = cleaned.indexOf(START_MARKER);
    const end = cleaned.indexOf(END_MARKER, start >= 0 ? start : 0);
    if (start >= 0 && end > start) {
      hadMarkers = true;
      cleaned = cleaned.slice(0, start) + cleaned.slice(end + END_MARKER.length);
    } else if (end >= 0 && start < 0) {
      // Orphan end marker — remove it
      hadMarkers = true;
      cleaned = cleaned.slice(0, end) + cleaned.slice(end + END_MARKER.length);
    } else {
      break;
    }
  }

  // Clean up excessive whitespace from removals
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  let content: string;
  if (!cleaned) {
    content = `${block}\n`;
  } else {
    content = `${cleaned}\n\n${block}\n`;
  }
  return { content, changed: content !== existing };
}

function writeManagedFile(targetPath: string, section: string, options?: PlatformSyncOptions): PlatformSyncResult {
  const didExist = existsSync(targetPath);
  const existing = didExist ? readFileSync(targetPath, 'utf-8') : '';
  const { content, changed } = updateSection(existing, section);
  if (!changed) {
    return { path: targetPath, updated: false, mode: 'noop' };
  }
  if (options?.dryRun) {
    return { path: targetPath, updated: true, mode: didExist ? 'updated' : 'created' };
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content);
  return { path: targetPath, updated: true, mode: didExist ? 'updated' : 'created' };
}

function renderToolReference(platform: Platform, tool: string): string {
  switch (platform) {
    case 'cursor':
      return `mcp_codeimpact_${tool}`;
    case 'claude':
    case 'windsurf':
      return `mcp__codeimpact__${tool}`;
    case 'codex':
      return `codeimpact ${tool.replace(/_/g, '-')}`;
  }
}

function renderPlatformSection(
  platform: Platform,
  paths: KnowledgeWorkspacePaths,
  skillIndex: string[],
  evolutionGuidance?: string[],
): string {
  const tool = (name: string) => renderToolReference(platform, name);

  const skillList = skillIndex.length > 0
    ? skillIndex.map((s) => `- ${s}`).join('\n')
    : '- No skills yet — create your first after completing a task';

  let attentionSection = '';
  if (evolutionGuidance && evolutionGuidance.length > 0) {
    attentionSection = `\n### Skills Needing Attention\n${evolutionGuidance.map((g) => `- ${g}`).join('\n')}\n`;
  }

  return `# CodeImpact — AI-Powered Codebase Intelligence

You have access to **CodeImpact**, a persistent knowledge system. **Use CodeImpact tools FIRST** before falling back to built-in search/grep/read tools.

## Session Start (Do This First)

1. \`${tool('memory_ghost')}\` with mode="resurrect" — resume previous work context
2. \`${tool('memory_status')}\` — project overview, languages, recent decisions
3. Read \`.code-impact/project/SKILL.md\` — tech stack, conventions, key directories
4. Read \`.code-impact/features/{feature}/SKILL.md\` — rules for files you'll modify

## Workflow

### Searching Code
Use \`${tool('memory_query')}\` FIRST (faster than grep, returns semantic context):
- Question: \`query="how does auth work?"\`
- File content: \`query="src/core/engine.ts"\`
- Symbol lookup: \`symbol="CodeImpactEngine"\`
- Only fall back to Grep/Glob if CodeImpact returns no results

### Before Writing Code
1. \`${tool('memory_ghost')}\` with mode="conflicts" + code — check for decision conflicts
2. \`${tool('memory_review')}\` with code + file + intent — validates against patterns, past decisions, and known bugs
   - Returns risk_score (0-100) and verdict (approve/warning/reject)

### Before Committing
\`${tool('memory_verify')}\` with code + file — catches hallucinated imports, security issues (OWASP Top 10), missing dependencies
- Returns verdict (pass/warning/fail) and score (0-100)

### When Debugging
\`${tool('memory_ghost')}\` with mode="dejavu" + query="error message" — finds "you solved this before" matches

### Assessing Risk of a Change
\`${tool('memory_blast_radius')}\` with file="path" — risk score, affected files, critical paths, whether senior review is needed

### After Completing a Task
1. \`${tool('memory_record')}\` — save decisions (title + content) or patterns (code + pattern_name) to project memory
2. \`${tool('memory_agents')}\` with action="record_outcome" — records what worked/failed for agent learning
3. If task touched 3+ files: \`${tool('memory_evolve')}\` with action="create_skill" (new) or action="improve_skill" (update existing)

## All Tools Reference

| Tool | When to Use |
|------|-------------|
| \`${tool('memory_query')}\` | Search code, find definitions, understand architecture |
| \`${tool('memory_record')}\` | Save decisions, patterns, requirements to project memory |
| \`${tool('memory_review')}\` | Review code against patterns and decisions before writing |
| \`${tool('memory_verify')}\` | Pre-commit quality gate (imports, security, deps) |
| \`${tool('memory_ghost')}\` | Conflict detection, déjà vu, session resurrection |
| \`${tool('memory_status')}\` | Project overview, recent changes, health check |
| \`${tool('memory_blast_radius')}\` | Impact/risk analysis before changing files |
| \`${tool('memory_agents')}\` | Query agents, validate scope, record outcomes |
| \`${tool('memory_evolve')}\` | Create/improve skills and generate documentation |
| \`${tool('export_decisions_to_adr')}\` | Export architecture decisions as ADR markdown files |
| \`${tool('knowledge_generate')}\` | Regenerate full knowledge workspace |

## Agent System

Feature agents in \`.code-impact/features/\` own specific file scopes. Before modifying files:
1. \`${tool('memory_agents')}\` with action="validate_action" + path — check scope
2. Read the feature's SKILL.md for rules and pitfalls

## Skills
${skillList}
${attentionSection}
## Knowledge Workspace
\`${paths.root.replace(/\\/g, '/')}\``;
}

export class PlatformRuleSync {
  constructor(private readonly projectPath: string) {}

  syncAll(
    paths: KnowledgeWorkspacePaths,
    skillIndex: string[],
    options?: PlatformSyncOptions & { evolutionGuidance?: string[] },
  ): PlatformSyncResult[] {
    const results: PlatformSyncResult[] = [];
    const guidance = options?.evolutionGuidance;

    const cursorSection = renderPlatformSection('cursor', paths, skillIndex, guidance);
    results.push(writeManagedFile(join(this.projectPath, '.cursorrules'), cursorSection, options));
    results.push(writeManagedFile(join(this.projectPath, '.cursor', 'rules', 'codeimpact.mdc'), cursorSection, options));

    const claudeSection = renderPlatformSection('claude', paths, skillIndex, guidance);
    results.push(writeManagedFile(join(this.projectPath, 'CLAUDE.md'), claudeSection, options));

    const codexSection = renderPlatformSection('codex', paths, skillIndex, guidance);
    results.push(writeManagedFile(join(this.projectPath, 'AGENTS.md'), codexSection, options));
    results.push(writeManagedFile(join(this.projectPath, 'CODEX.md'), codexSection, options));

    const windsurfSection = renderPlatformSection('windsurf', paths, skillIndex, guidance);
    results.push(writeManagedFile(join(this.projectPath, '.windsurfrules'), windsurfSection, options));

    return results;
  }
}
