# CodeImpact Implementation Guide

## Architecture Overview

CodeImpact is an MCP server that gives AI coding assistants persistent, deep understanding of any codebase. It exposes **17 tools** (6 gateway + 11 standalone) backed by **14 engine subsystems**, sharing a single SQLite database + embedding index per project.

## MCP Tool Surface (17 Tools)

### Gateway Tools (6)

| Tool | Sub-actions | Purpose |
|------|------------|---------|
| `memory_query` | context, search, file, summary, symbol, dependencies, predict, confidence, sources, existing | Semantic code search, AST symbol lookup, dependency graph traversal, deja vu, prediction, confidence scoring |
| `memory_record` | decision, pattern, feedback, feature, critical, example | Persist architectural choices, code patterns, critical requirements, pattern examples |
| `memory_review` | full, pattern, conflicts, tests, confidence, bugs, coverage | Pre-change safety: pattern validation + decision conflicts + ghost conflicts + test impact + bug history. Returns risk_score + verdict |
| `memory_status` | summary, happened, changed, architecture, changelog, health, patterns, stats, undocumented, critical, learning | Project observability: what changed, architecture state, doc freshness, context health |
| `memory_ghost` | full, conflicts, dejavu, resurrect | Silent intelligence: proactive conflict warnings, similar-problem detection, session resurrection |
| `memory_verify` | imports, security, dependencies, patterns, tests, all | Pre-commit quality gate: hallucinated import detection, OWASP scanning, pattern compliance. Returns pass/warning/fail verdict |

### Standalone Tools (11)

| Tool | Purpose |
|------|---------|
| `switch_project` | Switch active project context |
| `switch_feature_context` | Resume tracking a previous feature |
| `trigger_compaction` | Reduce memory token usage |
| `update_decision_status` | Mark decisions deprecated/superseded |
| `export_decisions_to_adr` | Export decisions as ADR markdown files |
| `discover_projects` | Find git repositories on the system |
| `knowledge_status` | Get knowledge workspace status |
| `knowledge_generate` | Generate/refresh knowledge artifacts |
| `knowledge_sync_rules` | Sync platform instruction files |
| `knowledge_research` | Refresh provider research notes |
| `memory_blast_radius` | Analyze risk of changing a file |

## Engine Subsystems (14)

### 1. Indexer + AST + Embeddings
- Tree-sitter WASM parsing for TS/JS, Python, Go, Rust, Java
- MiniLM L6 embeddings for semantic search
- Extracts symbols, imports, exports, dependency edges
- File watcher for live re-indexing

### 2. Context Assembler
- Assembles relevant context from all tiers for queries
- Token budget allocation across tiers
- Feature context integration

### 3. Decision Tracker + Extractor
- Persists architectural decisions with embeddings
- Extracts decisions from git commits and code comments
- Conflict detection via semantic similarity

### 4. Learning Engine
- Tracks file access patterns and query patterns
- Predicts relevant files based on usage
- Hot file caching and pre-fetching

### 5. Living Documentation
- Architecture overview generation (layers, data flow, key components)
- Per-file component documentation
- Git-based changelog generation
- Documentation validation and staleness detection
- Syncs to knowledge/docs/ on every generation

### 6. Context Rot Prevention
- Token utilization monitoring
- Drift detection from initial requirements
- Critical context marking (never compress)
- Compaction strategies (summarize, selective, aggressive)

### 7. Confidence Scorer
- Multi-signal confidence scoring (codebase + decisions + patterns)
- Source tracking with provenance
- Conflict detection against past decisions

### 8. Change Intelligence
- Git history analysis and change tracking
- Bug history with FTS5 search
- Fix correlation and suggestion
- Diagnosis engine for error investigation

### 9. Architecture Enforcement
- Pattern learning from codebase
- Pattern validation for new code
- Duplicate function detection via embeddings
- Pattern library with rules and examples

### 10. Test Awareness
- Test file indexing across frameworks (jest, vitest, pytest, etc.)
- File-to-test and function-to-test mapping
- Test impact analysis for changed files
- Test coverage gap detection

### 11. Ghost Mode
- Silent file access tracking
- Proactive decision conflict detection
- File impact correlation
- Telepathic context surfacing

### 12. Deja Vu Detector
- Query pattern recording and matching
- Similar-problem detection across sessions
- Solution recall from past interactions

### 13. Code Verifier
- Import existence validation (catches hallucinated imports)
- OWASP Top 10 security scanning
- Dependency verification (installed? in manifest?)
- Multi-check pipeline with scoring

### 14. Knowledge Orchestrator
- Autonomous skill and documentation generation
- Debounced triggers from index/git/file events
- Cross-platform instruction file sync
- Provider research management
- Intelligence fusion from all subsystems

## Data Flow

```
Code Changes
    |
    v
Indexer (AST + Embeddings)
    |
    v
SQLite Database (files, symbols, imports, exports, dependencies,
                  decisions, patterns, tests, changes, bugs,
                  documentation, activity_log, token_usage)
    |
    v
14 Engine Subsystems (read/write shared DB)
    |
    v
Knowledge Orchestrator (fuses intelligence from all subsystems)
    |
    v
knowledge/ workspace (skills + docs + manifest)
    |
    v
Platform Rule Sync (.cursorrules, CLAUDE.md, AGENTS.md, etc.)
```

## Knowledge Workspace Structure

```
knowledge/
  index.json              -- manifest with versions, timestamps, sources
  skills/
    _core/                -- always-present skills
    _technology/          -- framework/library skills
    _features/            -- codebase feature area skills
    _risk/                -- blast radius and safety skills
  docs/
    architecture/         -- architecture overview
    features/             -- per-component documentation
    integrations/         -- provider research notes
    changelog/            -- rolling changelog
```

## Intelligence Fusion

The knowledge system consumes intelligence from every engine subsystem:

| Source | Data Used | Feeds Into |
|--------|-----------|------------|
| Tier2 (Indexer) | File count, languages, dependency hotspots, imports/exports | Tech detection, feature mapping |
| Architecture Enforcement | Learned patterns, rules, usage counts | Skill constraints, review criteria |
| Decisions | Active decisions, tags, files | Skill rules, conflict prevention |
| Blast Radius | High-risk files, risk scores, critical paths | Risk skills, review warnings |
| Dead Code | Unused exports, safe-to-delete candidates | Cleanup skills |
| Test Awareness | Framework, test count, coverage gaps | Verification steps, test commands |
| Change Intelligence | Recent bugs, change hotspots | Pitfall warnings, bug history |
| Feature Context | Active feature, working files | Scoped skill generation |
| Ghost Mode | Conflict warnings, decision caches | Constraint generation |
| Deja Vu | Recurring query patterns | Problem-solving steps |
| Living Docs | Architecture, validation score, outdated docs | Documentation maintenance skills |
| Confidence | Pattern/decision alignment signals | Verification criteria |
