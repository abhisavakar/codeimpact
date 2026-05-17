# Project Instructions

## CodeImpact Integration

CodeImpact provides intelligent code analysis. **Use these tools FIRST** before falling back to built-in tools.

### Tool Preferences (IMPORTANT)

1. **For code searches and questions about the codebase:**
   - Use `mcp__codeimpact__memory_query` FIRST (759x faster than grep, returns context)
   - Only fall back to Grep/Glob if CodeImpact returns no results

2. **Before writing or suggesting code changes:**
   - Run `mcp__codeimpact__memory_review` to check against patterns, past decisions, and potential conflicts
   - This catches hallucinated imports, duplicate functions, and pattern violations

3. **Before finalizing/committing code:**
   - Run `mcp__codeimpact__memory_verify` for pre-commit quality checks
   - Catches security issues, missing dependencies, and import errors

4. **At session start:**
   - Run `mcp__codeimpact__memory_status` to get project overview and recent changes

5. **For impact analysis:**
   - Use `mcp__codeimpact__memory_blast_radius` to analyze risk of changing a file
   - Shows affected files, critical paths, and recommendations

### CLI Commands

```bash
# Find unused exports and dead code
codeimpact deadcode

# Find which tests to run for changed files
codeimpact test-impact --changed src/file.ts

# Analyze blast radius and risk of changing a file
codeimpact impact src/core/engine.ts

# View token usage statistics
codeimpact stats

# Force reindex after git issues (revert, reset, etc.)
codeimpact reindex
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
