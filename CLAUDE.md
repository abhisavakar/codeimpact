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
