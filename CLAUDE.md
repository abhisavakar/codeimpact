# Project Instructions

## CLI Commands

```bash
codeimpact deadcode              # Find unused exports and dead code
codeimpact test-impact --changed src/file.ts  # Tests to run for changed files
codeimpact impact src/core/engine.ts          # Blast radius analysis
codeimpact stats                 # Token usage statistics
codeimpact reindex               # Force reindex after git issues
```

<!-- codeimpact:knowledge:start -->
# CodeImpact — AI-Powered Codebase Intelligence

You have access to **CodeImpact**, a persistent knowledge system that understands this codebase. It provides project skills, architecture knowledge, and self-learning agents.

## IMPORTANT: Session Start

1. **Read project knowledge** before making changes:
   - `.code-impact/project/SKILL.md` — Tech stack, architecture, key directories
   - `.code-impact/project/CONVENTIONS.md` — Coding standards and patterns
   - `.code-impact/project/ARCHITECTURE.md` — System layers and data flow
2. **Read feature knowledge** for the files you're modifying:
   - `.code-impact/features/{feature}/SKILL.md` — Feature-specific rules, pitfalls, and research refs
   - Features: check `.code-impact/features/` for available feature directories
3. Run `mcp__codeimpact__memory_status` for project overview and recent changes

## MCP Tools (Use FIRST before built-in tools)

| Task | Tool |
|------|------|
| Search code semantically | `mcp__codeimpact__memory_query` |
| Review code before changes | `mcp__codeimpact__memory_review` |
| Verify before committing | `mcp__codeimpact__memory_verify` |
| Project status | `mcp__codeimpact__memory_status` |
| Impact analysis | `mcp__codeimpact__memory_blast_radius` |
| Agent system | `mcp__codeimpact__memory_agents` |
| Build knowledge | `mcp__codeimpact__memory_evolve` |

## Agent System

This project has feature-level agents in `.code-impact/features/`. Each agent has:
- **SKILL.md** — Rules, pitfalls, and technology-specific guidance
- **AGENT.md** — Scope, allowed tools, and lessons learned from past mistakes

Before modifying files, check the relevant feature's SKILL.md for rules and pitfalls.
After completing a task, record the outcome via `mcp__codeimpact__memory_agents` with action="record_outcome".

## Skill Management

After completing any task involving 3+ files, create or improve a skill:

`mcp__codeimpact__memory_evolve` with action="create_skill" (new) or action="improve_skill" (update)

### Quality Rules
- Under 5000 tokens per skill
- Be specific: "Use db.prepare().all() for SELECT" not "follow project patterns"
- Include pitfalls with symptoms: "you'll get undefined" not "don't misuse"

## Existing Skills
- No skills yet — create your first after completing a task


## Knowledge Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`
<!-- codeimpact:knowledge:end -->
