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

### Why Use CodeImpact Tools?

- **Semantic search**: Understands intent, not just keywords
- **Pattern awareness**: Knows project conventions and enforces them
- **Decision memory**: Remembers past architectural decisions
- **Déjà vu detection**: Surfaces similar past problems you've solved
- **Import validation**: Catches hallucinated imports before they break builds
- **Blast radius**: Understand impact and risk before making changes

### Quick Reference

| Task | Tool | Example |
|------|------|---------|
| Find code | `memory_query` | "how does auth work?" |
| Check code | `memory_review` | Before suggesting changes |
| Verify code | `memory_verify` | Before committing |
| Project status | `memory_status` | At session start |
| Save decision | `memory_record` | After architectural choices |
| Impact analysis | `memory_blast_radius` | Before modifying critical files |

### CLI Commands

CodeImpact also provides CLI commands for code analysis:

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

## Tools
| Task | Tool |
|------|------|
| Find code | `mcp__codeimpact__memory_query` |
| Check code | `mcp__codeimpact__memory_review` |
| Verify code | `mcp__codeimpact__memory_verify` |
| Project status | `mcp__codeimpact__memory_status` |
| Impact analysis | `mcp__codeimpact__memory_blast_radius` |
| Build knowledge | `mcp__codeimpact__memory_evolve` |

## Session Start
1. Run `mcp__codeimpact__memory_status` — check `knowledge_gaps` for uncovered technologies and high-risk files.
2. Read relevant skills from `knowledge/skills/` for the current task.

## Skill Creation Protocol

**After completing any task involving 3+ files**, create or improve a skill.

### To create a new skill:
`mcp__codeimpact__memory_evolve` with:
- action="create_skill"
- name="technology-or-area-name" (slug format)
- description="One line: when to use this skill"
- scope="technology|feature|risk|core"
- content="Full markdown body (see format below)"

### To improve an existing skill:
`mcp__codeimpact__memory_evolve` with:
- action="improve_skill", skill_id="skill-name"
- Patch mode: old_text="exact text to replace", new_text="replacement"
- Append mode: section="pitfalls", content="New pitfall to add"

### To discover gaps:
`mcp__codeimpact__memory_evolve` with action="list_signals"

### Skill Format (agentskills.io SKILL.md)

```markdown
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
```

### Quality Rules
- **Under 5000 tokens** per skill
- **Be specific**: "Use db.prepare().all() for SELECT" not "follow project patterns"
- **Pitfalls with symptoms**: "you'll get undefined" not "don't misuse"
- **Every line earns its tokens** — no filler, no generic advice the AI already knows

## Existing Skills
- No skills yet — create your first after completing a task


## Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`
<!-- codeimpact:knowledge:end -->

<!-- codeimpact:knowledge:start -->
# CodeImpact Knowledge System

You are part of a **self-improving knowledge system**. Skills you create persist across sessions. Future AI sessions benefit from the knowledge you build now.

## Tools
| Task | Tool |
|------|------|
| Find code | `mcp__codeimpact__memory_query` |
| Check code | `mcp__codeimpact__memory_review` |
| Verify code | `mcp__codeimpact__memory_verify` |
| Project status | `mcp__codeimpact__memory_status` |
| Impact analysis | `mcp__codeimpact__memory_blast_radius` |
| Build knowledge | `mcp__codeimpact__memory_evolve` |

## Session Start
1. Run `mcp__codeimpact__memory_status` — check `knowledge_gaps` for uncovered technologies and high-risk files.
2. Read relevant skills from `knowledge/skills/` for the current task.

## Skill Creation Protocol

**After completing any task involving 3+ files**, create or improve a skill.

### To create a new skill:
`mcp__codeimpact__memory_evolve` with:
- action="create_skill"
- name="technology-or-area-name" (slug format)
- description="One line: when to use this skill"
- scope="technology|feature|risk|core"
- content="Full markdown body (see format below)"

### To improve an existing skill:
`mcp__codeimpact__memory_evolve` with:
- action="improve_skill", skill_id="skill-name"
- Patch mode: old_text="exact text to replace", new_text="replacement"
- Append mode: section="pitfalls", content="New pitfall to add"

### To discover gaps:
`mcp__codeimpact__memory_evolve` with action="list_signals"

### Skill Format (agentskills.io SKILL.md)

```markdown
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
```

### Quality Rules
- **Under 5000 tokens** per skill
- **Be specific**: "Use db.prepare().all() for SELECT" not "follow project patterns"
- **Pitfalls with symptoms**: "you'll get undefined" not "don't misuse"
- **Every line earns its tokens** — no filler, no generic advice the AI already knows

## Existing Skills
- No skills yet — create your first after completing a task


## Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`
<!-- codeimpact:knowledge:end -->

<!-- codeimpact:knowledge:start -->
# CodeImpact Knowledge System

You are part of a **self-improving knowledge system**. Skills you create persist across sessions. Future AI sessions benefit from the knowledge you build now.

## Tools
| Task | Tool |
|------|------|
| Find code | `mcp__codeimpact__memory_query` |
| Check code | `mcp__codeimpact__memory_review` |
| Verify code | `mcp__codeimpact__memory_verify` |
| Project status | `mcp__codeimpact__memory_status` |
| Impact analysis | `mcp__codeimpact__memory_blast_radius` |
| Build knowledge | `mcp__codeimpact__memory_evolve` |

## Session Start
1. Run `mcp__codeimpact__memory_status` — check `knowledge_gaps` for uncovered technologies and high-risk files.
2. Read relevant skills from `knowledge/skills/` for the current task.

## Skill Creation Protocol

**After completing any task involving 3+ files**, create or improve a skill.

### To create a new skill:
`mcp__codeimpact__memory_evolve` with:
- action="create_skill"
- name="technology-or-area-name" (slug format)
- description="One line: when to use this skill"
- scope="technology|feature|risk|core"
- content="Full markdown body (see format below)"

### To improve an existing skill:
`mcp__codeimpact__memory_evolve` with:
- action="improve_skill", skill_id="skill-name"
- Patch mode: old_text="exact text to replace", new_text="replacement"
- Append mode: section="pitfalls", content="New pitfall to add"

### To discover gaps:
`mcp__codeimpact__memory_evolve` with action="list_signals"

### Skill Format (agentskills.io SKILL.md)

```markdown
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
```

### Quality Rules
- **Under 5000 tokens** per skill
- **Be specific**: "Use db.prepare().all() for SELECT" not "follow project patterns"
- **Pitfalls with symptoms**: "you'll get undefined" not "don't misuse"
- **Every line earns its tokens** — no filler, no generic advice the AI already knows

## Existing Skills
- No skills yet — create your first after completing a task


## Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`
<!-- codeimpact:knowledge:end -->

<!-- codeimpact:knowledge:start -->
# CodeImpact Knowledge System

You are part of a **self-improving knowledge system**. Skills you create persist across sessions. Future AI sessions benefit from the knowledge you build now.

## Tools
| Task | Tool |
|------|------|
| Find code | `mcp__codeimpact__memory_query` |
| Check code | `mcp__codeimpact__memory_review` |
| Verify code | `mcp__codeimpact__memory_verify` |
| Project status | `mcp__codeimpact__memory_status` |
| Impact analysis | `mcp__codeimpact__memory_blast_radius` |
| Build knowledge | `mcp__codeimpact__memory_evolve` |

## Session Start
1. Run `mcp__codeimpact__memory_status` — check `knowledge_gaps` for uncovered technologies and high-risk files.
2. Read relevant skills from `knowledge/skills/` for the current task.

## Skill Creation Protocol

**After completing any task involving 3+ files**, create or improve a skill.

### To create a new skill:
`mcp__codeimpact__memory_evolve` with:
- action="create_skill"
- name="technology-or-area-name" (slug format)
- description="One line: when to use this skill"
- scope="technology|feature|risk|core"
- content="Full markdown body (see format below)"

### To improve an existing skill:
`mcp__codeimpact__memory_evolve` with:
- action="improve_skill", skill_id="skill-name"
- Patch mode: old_text="exact text to replace", new_text="replacement"
- Append mode: section="pitfalls", content="New pitfall to add"

### To discover gaps:
`mcp__codeimpact__memory_evolve` with action="list_signals"

### Skill Format (agentskills.io SKILL.md)

```markdown
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
```

### Quality Rules
- **Under 5000 tokens** per skill
- **Be specific**: "Use db.prepare().all() for SELECT" not "follow project patterns"
- **Pitfalls with symptoms**: "you'll get undefined" not "don't misuse"
- **Every line earns its tokens** — no filler, no generic advice the AI already knows

## Existing Skills
- No skills yet — create your first after completing a task


## Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`
<!-- codeimpact:knowledge:end -->
