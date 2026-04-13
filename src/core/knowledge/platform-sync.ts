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

  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start >= 0 && end > start) {
    const before = existing.slice(0, start).trimEnd();
    const after = existing.slice(end + END_MARKER.length).trimStart();
    const content = `${before}\n\n${block}\n\n${after}`.trim() + '\n';
    return { content, changed: content !== existing };
  }

  const content = `${existing.trimEnd()}\n\n${block}\n`;
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

  return `# CodeImpact Knowledge System

You are part of a **self-improving knowledge system**. Skills you create persist across sessions. Future AI sessions benefit from the knowledge you build now.

## Tools
| Task | Tool |
|------|------|
| Find code | \`${tool('memory_query')}\` |
| Check code | \`${tool('memory_review')}\` |
| Verify code | \`${tool('memory_verify')}\` |
| Project status | \`${tool('memory_status')}\` |
| Impact analysis | \`${tool('memory_blast_radius')}\` |
| Build knowledge | \`${tool('memory_evolve')}\` |

## Session Start
1. Run \`${tool('memory_status')}\` — check \`knowledge_gaps\` for uncovered technologies and high-risk files.
2. Read relevant skills from \`knowledge/skills/\` for the current task.

## Skill Creation Protocol

**After completing any task involving 3+ files**, create or improve a skill.

### To create a new skill:
\`${tool('memory_evolve')}\` with:
- action="create_skill"
- name="technology-or-area-name" (slug format)
- description="One line: when to use this skill"
- scope="technology|feature|risk|core"
- content="Full markdown body (see format below)"

### To improve an existing skill:
\`${tool('memory_evolve')}\` with:
- action="improve_skill", skill_id="skill-name"
- Patch mode: old_text="exact text to replace", new_text="replacement"
- Append mode: section="pitfalls", content="New pitfall to add"

### To discover gaps:
\`${tool('memory_evolve')}\` with action="list_signals"

### Skill Format (agentskills.io SKILL.md)

\`\`\`markdown
---
name: better-sqlite3-patterns
description: Synchronous database patterns. Use when working with database queries or schema changes.
version: 1.0
metadata:
  scope: technology
  created_by: ai
---

# better-sqlite3 Patterns

## When to Use
When modifying database queries, adding tables, or working with files that import from src/storage/database.ts.

## Key Facts
- Database: .codeimpact/codeimpact.db (SQLite, WAL mode)
- API: better-sqlite3 (synchronous, NOT async)

## Rules
- ALL database access goes through database.ts — never import better-sqlite3 directly.
- Use db.prepare().all() for SELECT, db.prepare().run() for INSERT/UPDATE/DELETE.

## Pitfalls
- db.exec() returns nothing. If you use it for SELECT, you get undefined.
- better-sqlite3 is synchronous. Do NOT wrap in async/await.

## Verification
- npx tsc --noEmit passes with no type errors on database code.
\`\`\`

### Quality Rules
- **Under 5000 tokens** per skill
- **Be specific**: "Use db.prepare().all() for SELECT" not "follow project patterns"
- **Pitfalls with symptoms**: "you'll get undefined" not "don't misuse"
- **Every line earns its tokens** — no filler, no generic advice the AI already knows

## Existing Skills
${skillList}
${attentionSection}

## Workspace
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
