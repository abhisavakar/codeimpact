# Project Instructions

## CLI Commands

```bash
codeimpact deadcode              # Find unused exports and dead code
codeimpact test-impact --changed src/file.ts  # Tests to run for changed files
codeimpact impact src/core/engine.ts          # Blast radius analysis
codeimpact stats                 # Token usage statistics
codeimpact reindex               # Force reindex after git issues
```

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

## Session Start (Do This First)

1. `mcp__codeimpact__memory_ghost` with mode="resurrect" — resume previous work context
2. `mcp__codeimpact__memory_status` — project overview, languages, recent decisions
3. Read `.code-impact/project/SKILL.md` — tech stack, conventions, key directories
4. Read `.code-impact/features/{feature}/SKILL.md` — rules for files you'll modify

## Workflow

### Searching Code
Use `mcp__codeimpact__memory_query` FIRST (faster than grep, returns semantic context):
- Question: `query="how does auth work?"`
- File content: `query="src/core/engine.ts"`
- Symbol lookup: `symbol="CodeImpactEngine"`
- Only fall back to Grep/Glob if CodeImpact returns no results

### Before Writing Code
1. `mcp__codeimpact__memory_ghost` with mode="conflicts" + code — check for decision conflicts
2. `mcp__codeimpact__memory_review` with code + file + intent — validates against patterns, past decisions, and known bugs
   - Returns risk_score (0-100) and verdict (approve/warning/reject)

### Before Committing
`mcp__codeimpact__memory_verify` with code + file — catches hallucinated imports, security issues (OWASP Top 10), missing dependencies
- Returns verdict (pass/warning/fail) and score (0-100)

### When Debugging
`mcp__codeimpact__memory_ghost` with mode="dejavu" + query="error message" — finds "you solved this before" matches

### Assessing Risk of a Change
`mcp__codeimpact__memory_blast_radius` with file="path" — risk score, affected files, critical paths, whether senior review is needed

### After Completing a Task
1. `mcp__codeimpact__memory_record` — save decisions (title + content) or patterns (code + pattern_name) to project memory
2. `mcp__codeimpact__memory_agents` with action="record_outcome" — records what worked/failed for agent learning
3. If task touched 3+ files: `mcp__codeimpact__memory_evolve` with action="create_skill" (new) or action="improve_skill" (update existing)

## All Tools Reference

| Tool | When to Use |
|------|-------------|
| `mcp__codeimpact__memory_query` | Search code, find definitions, understand architecture |
| `mcp__codeimpact__memory_record` | Save decisions, patterns, requirements to project memory |
| `mcp__codeimpact__memory_review` | Review code against patterns and decisions before writing |
| `mcp__codeimpact__memory_verify` | Pre-commit quality gate (imports, security, deps) |
| `mcp__codeimpact__memory_ghost` | Conflict detection, déjà vu, session resurrection |
| `mcp__codeimpact__memory_status` | Project overview, recent changes, health check |
| `mcp__codeimpact__memory_blast_radius` | Impact/risk analysis before changing files |
| `mcp__codeimpact__memory_agents` | Query agents, validate scope, record outcomes |
| `mcp__codeimpact__memory_evolve` | Create/improve skills and generate documentation |
| `mcp__codeimpact__export_decisions_to_adr` | Export architecture decisions as ADR markdown files |
| `mcp__codeimpact__knowledge_generate` | Regenerate full knowledge workspace |

## Agent System

Feature agents in `.code-impact/features/` own specific file scopes. Before modifying files:
1. `mcp__codeimpact__memory_agents` with action="validate_action" + path — check scope
2. Read the feature's SKILL.md for rules and pitfalls

## Skills
- sqlite-patterns: SQLite patterns and pitfalls for this project
- fixtures-large-features-feat-a: Feature skill for Fixtures large features feat a (70 files)
- fixtures-large-features-feat-b: Feature skill for Fixtures large features feat b (70 files)
- fixtures-large-features-feat-c: Feature skill for Fixtures large features feat c (70 files)
- fixtures-large-features-feat-d: Feature skill for Fixtures large features feat d (70 files)
- fixtures-large-features-feat-e: Feature skill for Fixtures large features feat e (70 files)
- fixtures-large-features-feat-f: Feature skill for Fixtures large features feat f (70 files)
- core-agents: Feature skill for Core agents (46 files)
- src-core: Feature skill for Src core (32 files)
- server-gateways: Feature skill for Server gateways (26 files)
- test-agents: Feature skill for Test agents (18 files)
- project-conventions: Project-wide conventions, patterns, and risk areas

## Knowledge Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`

<!-- codeimpact:knowledge:start -->
# CodeImpact — AI-Powered Codebase Intelligence

You have access to **CodeImpact**, a persistent knowledge system. **Use CodeImpact tools FIRST** before falling back to built-in search/grep/read tools.

## Session Start (Do This First)

1. `mcp__codeimpact__memory_ghost` with mode="resurrect" — resume previous work context
2. `mcp__codeimpact__memory_status` — project overview, languages, recent decisions
3. Read `.code-impact/project/SKILL.md` — tech stack, conventions, key directories
4. Read `.code-impact/features/{feature}/SKILL.md` — rules for files you'll modify

## Workflow

### Searching Code
Use `mcp__codeimpact__memory_query` FIRST (faster than grep, returns semantic context):
- Question: `query="how does auth work?"`
- File content: `query="src/core/engine.ts"`
- Symbol lookup: `symbol="CodeImpactEngine"`
- Only fall back to Grep/Glob if CodeImpact returns no results

### Before Writing Code
1. `mcp__codeimpact__memory_ghost` with mode="conflicts" + code — check for decision conflicts
2. `mcp__codeimpact__memory_review` with code + file + intent — validates against patterns, past decisions, and known bugs
   - Returns risk_score (0-100) and verdict (approve/warning/reject)

### Before Committing
`mcp__codeimpact__memory_verify` with code + file — catches hallucinated imports, security issues (OWASP Top 10), missing dependencies
- Returns verdict (pass/warning/fail) and score (0-100)

### When Debugging
`mcp__codeimpact__memory_ghost` with mode="dejavu" + query="error message" — finds "you solved this before" matches

### Assessing Risk of a Change
`mcp__codeimpact__memory_blast_radius` with file="path" — risk score, affected files, critical paths, whether senior review is needed

### After Completing a Task
1. `mcp__codeimpact__memory_record` — save decisions (title + content) or patterns (code + pattern_name) to project memory
2. `mcp__codeimpact__memory_agents` with action="record_outcome" — records what worked/failed for agent learning
3. If task touched 3+ files: `mcp__codeimpact__memory_evolve` with action="create_skill" (new) or action="improve_skill" (update existing)

## All Tools Reference

| Tool | When to Use |
|------|-------------|
| `mcp__codeimpact__memory_query` | Search code, find definitions, understand architecture |
| `mcp__codeimpact__memory_record` | Save decisions, patterns, requirements to project memory |
| `mcp__codeimpact__memory_review` | Review code against patterns and decisions before writing |
| `mcp__codeimpact__memory_verify` | Pre-commit quality gate (imports, security, deps) |
| `mcp__codeimpact__memory_ghost` | Conflict detection, déjà vu, session resurrection |
| `mcp__codeimpact__memory_status` | Project overview, recent changes, health check |
| `mcp__codeimpact__memory_blast_radius` | Impact/risk analysis before changing files |
| `mcp__codeimpact__memory_agents` | Query agents, validate scope, record outcomes |
| `mcp__codeimpact__memory_evolve` | Create/improve skills and generate documentation |
| `mcp__codeimpact__export_decisions_to_adr` | Export architecture decisions as ADR markdown files |
| `mcp__codeimpact__knowledge_generate` | Regenerate full knowledge workspace |

## Agent System

Feature agents in `.code-impact/features/` own specific file scopes. Before modifying files:
1. `mcp__codeimpact__memory_agents` with action="validate_action" + path — check scope
2. Read the feature's SKILL.md for rules and pitfalls

## Skills
- sqlite-patterns: SQLite patterns and pitfalls for this project
- fixtures-large-features-feat-a: Feature skill for Fixtures large features feat a (70 files)
- fixtures-large-features-feat-b: Feature skill for Fixtures large features feat b (70 files)
- fixtures-large-features-feat-c: Feature skill for Fixtures large features feat c (70 files)
- fixtures-large-features-feat-d: Feature skill for Fixtures large features feat d (70 files)
- fixtures-large-features-feat-e: Feature skill for Fixtures large features feat e (70 files)
- fixtures-large-features-feat-f: Feature skill for Fixtures large features feat f (70 files)
- core-agents: Feature skill for Core agents (46 files)
- src-core: Feature skill for Src core (32 files)
- server-gateways: Feature skill for Server gateways (26 files)
- test-agents: Feature skill for Test agents (18 files)
- project-conventions: Project-wide conventions, patterns, and risk areas

## Knowledge Workspace
`E:/Coding/fullstackoverweekend/codeimpact/knowledge`
<!-- codeimpact:knowledge:end -->
