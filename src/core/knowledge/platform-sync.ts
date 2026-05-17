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

type Platform = 'cursor' | 'claude' | 'codex';

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
    attentionSection = `
### Skills Needing Attention
${evolutionGuidance.map((g) => `- ${g}`).join('\n')}`;
  }

  return `# CodeImpact — AI-Powered Codebase Intelligence

You have access to **CodeImpact**, a persistent knowledge system that understands this codebase. It provides project skills, architecture knowledge, and self-learning agents.

## IMPORTANT: Session Start

1. **Read project knowledge** before making changes:
   - \`.code-impact/project/SKILL.md\` — Tech stack, architecture, key directories
   - \`.code-impact/project/CONVENTIONS.md\` — Coding standards and patterns
   - \`.code-impact/project/ARCHITECTURE.md\` — System layers and data flow
2. **Read feature knowledge** for the files you're modifying:
   - \`.code-impact/features/{feature}/SKILL.md\` — Feature-specific rules, pitfalls, and research refs
   - Features: check \`.code-impact/features/\` for available feature directories
3. Run \`${tool('memory_status')}\` for project overview and recent changes

## MCP Tools (Use FIRST before built-in tools)

| Task | Tool |
|------|------|
| Search code semantically | \`${tool('memory_query')}\` |
| Review code before changes | \`${tool('memory_review')}\` |
| Verify before committing | \`${tool('memory_verify')}\` |
| Project status | \`${tool('memory_status')}\` |
| Impact analysis | \`${tool('memory_blast_radius')}\` |
| Agent system | \`${tool('memory_agents')}\` |
| Build knowledge | \`${tool('memory_evolve')}\` |

## Agent System

This project has feature-level agents in \`.code-impact/features/\`. Each agent has:
- **SKILL.md** — Rules, pitfalls, and technology-specific guidance
- **AGENT.md** — Scope, allowed tools, and lessons learned from past mistakes

Before modifying files, check the relevant feature's SKILL.md for rules and pitfalls.
After completing a task, record the outcome via \`${tool('memory_agents')}\` with action="record_outcome".

## Skill Management

After completing any task involving 3+ files, create or improve a skill:

\`${tool('memory_evolve')}\` with action="create_skill" (new) or action="improve_skill" (update)

### Quality Rules
- Under 5000 tokens per skill
- Be specific: "Use db.prepare().all() for SELECT" not "follow project patterns"
- Include pitfalls with symptoms: "you'll get undefined" not "don't misuse"

## Existing Skills
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
    results.push(writeManagedFile(join(this.projectPath, 'Cloud.md'), claudeSection, options));

    const codexSection = renderPlatformSection('codex', paths, skillIndex, guidance);
    results.push(writeManagedFile(join(this.projectPath, 'AGENTS.md'), codexSection, options));
    results.push(writeManagedFile(join(this.projectPath, 'CODEX.md'), codexSection, options));

    return results;
  }
}
