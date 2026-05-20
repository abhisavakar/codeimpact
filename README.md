# CodeImpact

**Persistent codebase understanding for AI assistants.**

[![NPM Version](https://img.shields.io/npm/v/codeimpact?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/codeimpact)
[![Downloads](https://img.shields.io/npm/dm/codeimpact?style=for-the-badge&logo=npm&logoColor=white&label=downloads/month)](https://www.npmjs.com/package/codeimpact)
[![Total Downloads](https://img.shields.io/npm/dt/codeimpact?style=for-the-badge&logo=npm&logoColor=white&label=total%20downloads)](https://www.npmjs.com/package/codeimpact)
[![License](https://img.shields.io/npm/l/codeimpact?style=for-the-badge)](https://github.com/abhisavakar/codeimpact/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue?style=for-the-badge)](https://modelcontextprotocol.io/)

```bash
npm i codeimpact
```

CodeImpact is an MCP server that indexes your codebase and gives AI assistants like Claude the ability to understand your project's structure, dependencies, and history across sessions. It also includes a **Super Agent System** — a self-improving multi-agent architecture that detects features, generates knowledge artifacts, learns from mistakes, and continuously improves code quality using the [agentskills.io](https://agentskills.io) open standard.

---

## What CodeImpact Does

- **Indexes your code** - Extracts functions, classes, imports, and exports using true Tree-sitter AST parsing
- **Builds a dependency graph** - Tracks what files import what, transitively
- **Super Agent System** - Self-improving multi-agent architecture with feature detection, research distillation, and outcome-driven learning
- **AI Knowledge System** - AI assistants create reusable SKILL.md files that persist across sessions
- **Dead code detection** - Finds unused exports and orphan files with confidence scoring
- **Test impact analysis** - Shows which tests to run when you change a file
- **Blast radius analysis** - Risk scoring and critical path detection for any file change
- **Knowledge gap detection** - Identifies uncovered technologies and high-risk areas
- **Auto-generated skills** - Generates starter SKILL.md files from real codebase data (technologies, features, conventions) on first index
- **Self-learning loop** - Records outcomes, diagnoses failures, promotes confirmed patterns to rules; agent failures automatically feed back into skills
- **Agent lifecycle management** - Proposes merge/split/prune of feature agents based on git history
- **Research distillation** - Fetches and distills technology documentation with trust scoring
- **Cost tracking** - Monitors token usage and costs for CodeImpact queries
- **Detects circular dependencies** - Finds import cycles in your codebase
- **Records decisions** - Stores architectural decisions that persist across sessions
- **Semantic search** - Find code by meaning using local embeddings

All processing happens locally on your machine. No cloud services, no telemetry.

---

## Quick Start

```bash
# Install globally
npm i -g codeimpact

# Or use with npx (no install)
npx codeimpact init

# Initialize in your project
cd your-project
codeimpact init
```

This registers your project and configures Claude Desktop, Claude Code, OpenCode, and Cursor automatically. Restart your AI tool and you're ready.

> **Windows users**: If upgrading, close any AI tools using CodeImpact first (or run `taskkill /f /im node.exe`) before reinstalling. Windows locks native binaries while they're in use.

---

## Super Agent System

CodeImpact includes a production-grade multi-agent system that automatically detects project features, generates knowledge artifacts, learns from mistakes, and continuously improves. The system generates **SKILL.md** and **AGENT.md** files following the [agentskills.io](https://agentskills.io) open standard — compatible with Claude Code, Cursor, Codex, Gemini CLI, and 27+ other AI agents.

### How It Works

1. **Technology detection** — scans lockfiles, manifests, and configs to identify your stack
2. **Feature detection** — clusters source files into cohesive features using directory structure, import graphs, and CODEOWNERS
3. **Research distillation** — fetches and distills technology documentation with trust scoring
4. **Agent generation** — creates feature-scoped agents with scope boundaries, allowed tools, and success criteria
5. **Self-learning loop** — records outcomes, diagnoses failures using a 15-rule decision table, and promotes confirmed patterns to rules
6. **Lifecycle management** — proposes merge/split/prune of agents based on git co-change analysis

### Self-Learning Pipeline

```
Outcome recorded → Diagnose (15-rule decision table)
  → wrong-assumption + fix → Patch SKILL.md immediately
  → wrong-assumption + fix + no SKILL.md → Patch matching knowledge skill's Watch Out
  → outdated-research → Flag for re-research
  → 2+ similar failures → Write lesson to AGENT.md (quarantine)
  → 3+ confirmations → Promote lesson to SKILL.md Rules
  → 90 days unconfirmed → Decay lesson
```

### Auto-Generated Skills (New in 0.5.0)

CodeImpact now auto-generates starter skills from real codebase data during knowledge generation. This closes the intelligence loop — review/verify pipelines have rules to check against from day one, instead of operating in a vacuum.

**Three skill categories are generated:**

| Category | Scope | Cap | Source Data |
|----------|-------|-----|-------------|
| Technology patterns | `technology` | 5 | Detected technologies + provider research (pitfalls, best practices, import files) |
| Feature skills | `feature` | 10 | Feature clusters (3+ files) + risk files + dependency hotspots + decisions |
| Project conventions | `core` | 1 | Languages, test framework, architecture layers, top patterns, risk/change hotspots |

**Idempotency guarantees:**
- All auto-generated skills have `auto_generated: true` in frontmatter metadata
- Re-generation only triggers when the project grows by >20% in file count
- User-edited skills (where `auto_generated: true` was removed) are never overwritten
- Auto-generated skills are safely overwritten on regeneration

**Feedback loop:** When an agent records a failure with a fix, the improvement engine patches the matching skill's `## Watch Out` section — so the same mistake is caught by review/verify in future sessions.

### Agent Workspace Structure

```
your-project/
├── .code-impact/                  # Agent workspace (auto-generated)
│   ├── config.yaml                # Configuration
│   ├── index.json                 # Manifest with tech, features, outcomes
│   ├── project/                   # Project-wide knowledge
│   │   ├── SKILL.md               # Technology stack + conventions
│   │   ├── CONVENTIONS.md         # Coding standards
│   │   ├── ARCHITECTURE.md        # System architecture
│   │   └── AGENT.md               # Super agent (coordinator)
│   ├── research/                  # Distilled tech documentation
│   │   └── express@4.21.0.md      # With trust scores + structured sections
│   └── features/                  # Feature-specific knowledge
│       └── auth/
│           ├── SKILL.md           # Feature rules, pitfalls, research refs
│           └── AGENT.md           # Scope, tools, lessons learned
├── AGENTS.md                      # Top-level agent directory (auto-generated)
├── knowledge/                     # Legacy knowledge workspace
│   └── skills/                    # AI-created SKILL.md files
├── .codeimpact/
│   └── codeimpact.db              # SQLite database
└── src/
```

### CLI Commands for Agents

```bash
codeimpact agents init             # Initialize agent workspace
codeimpact agents generate         # Run full pipeline (detect → research → generate)
codeimpact agents status           # Show agent system health + lifecycle proposals
codeimpact agents research         # Refresh technology research
codeimpact agents migrate          # Migrate knowledge/ → .code-impact/
```

### Skill Format (agentskills.io SKILL.md)

```markdown
---
name: better-sqlite3-patterns
description: Synchronous database patterns. Use when working with database queries.
version: 1.0
metadata:
  scope: technology
  created_by: ai
---

# better-sqlite3 Patterns

## When to Use
When modifying database queries, adding tables, or working with any file
that imports from src/storage/database.ts.

## Rules
- ALL database access goes through database.ts — never import better-sqlite3 directly.
- Use db.prepare().all() for SELECT, db.prepare().run() for INSERT/UPDATE/DELETE.

## Pitfalls
- db.exec() returns nothing. If you use it for SELECT, you get undefined.
- better-sqlite3 is synchronous. Do NOT wrap in async/await.

## Verification
- npx tsc --noEmit passes with no type errors on database code.
```

### MCP Tools

| Tool | What It Does |
|------|-------------|
| `memory_status` | Project overview + knowledge gaps + lifecycle proposals |
| `memory_agents` | List/get agents, skills, research; validate scope; record outcomes; telemetry dashboard |
| `memory_evolve` | Create/improve skills, report outcomes, list signals |
| `memory_query` | Semantic search across code and knowledge |
| `memory_review` | Check code against learned patterns and skill rules |
| `memory_verify` | Pre-commit quality checks using skill verification rules |
| `memory_ghost` | Proactive intelligence — conflict detection, deja vu, session resurrection |
| `memory_blast_radius` | Impact analysis with skill-aware recommendations |

---

## Key Features

### Dead Code Detection

Find unused exports and orphan files in your codebase:

```bash
codeimpact deadcode
codeimpact deadcode --json --threshold 80
```

**Output:**
```
Dead Code Report:
- 4,230 lines of unused code detected
- 12 files with zero imports
- 23 functions never called
Safe to delete: 89% confidence
```

### Test Impact Analysis

Know exactly which tests to run when you change a file:

```bash
codeimpact test-impact
codeimpact test-impact --changed src/auth/login.ts
codeimpact test-impact --branch main
```

**Output:**
```
Analyzing impact of src/auth/login.ts...
Files affected: 12
Tests to run: 8 (instead of 234)
Estimated time: 2m (instead of 28m)
Time saved: 26 minutes
```

### Blast Radius Analysis

Understand the risk of changing any file:

```bash
codeimpact impact src/core/engine.ts
codeimpact impact src/auth/session.ts --depth 5 --json
```

**Output:**
```
File: src/auth/session.ts
Risk Score: 78/100 (HIGH)
Direct dependents: 8 files
Transitive dependents: 34 files
Critical paths affected: src/api/checkout.ts, src/billing/payments.ts
Recommendation: Senior review required
```

### Usage Dashboard

Track token usage and costs for CodeImpact queries:

```bash
codeimpact stats
codeimpact stats --period week
codeimpact stats --period all --json
```

**Output:**
```
This Month:
- Queries: 1,247
- Tokens used: 892K
- Estimated cost: $5.35
```

---

## Supported AI Tools

| Tool | Setup |
|------|-------|
| Claude Desktop | `codeimpact init` (auto) |
| Claude Code (CLI) | [`codeimpact init` (auto)](./doc/CLAUDE-CODE-SETUP.md) |
| Cursor | `codeimpact init` (auto) |
| OpenCode | [`codeimpact init` (auto)](./doc/OPENCODE-SETUP.md) |
| Any MCP Client | Manual config |
| **Any tool (HTTP)** | `codeimpact serve` |

All tools share the same data - switch between them freely.

---

## What You Can Ask

Once CodeImpact is running, your AI assistant can:

**Understand dependencies:**
```
"What files depend on src/auth/login.ts?"
"Show me the import chain for this module"
```

**Analyze impact:**
```
"If I change this file, what else might break?"
"What's the blast radius of changing this module?"
"What tests cover this function?"
```

**Build knowledge:**
```
"Check memory_status for knowledge gaps"
"Create a skill for the authentication patterns I just implemented"
"What skills exist for the database layer?"
```

**Agent system:**
```
"List all agents and their scopes"
"Validate if auth-agent can modify src/billing/pay.ts"
"Show the telemetry dashboard for this week"
"What lifecycle proposals exist?"
```

**Find dead code:**
```
"Are there any unused exports in this project?"
"Which files have no dependents?"
```

**Find code:**
```
"Find all authentication-related code"
"Where is the user validation logic?"
```

**Check for issues:**
```
"Are there any circular dependencies?"
"What decisions have we made about authentication?"
```

---

## How It Works

CodeImpact watches your project and maintains:

1. **Symbol index** - Functions, classes, imports, exports via Tree-sitter AST
2. **Dependency graph** - File-to-file import relationships (transitive)
3. **Agent workspace** - Auto-generated SKILL.md, AGENT.md, and research files
4. **Auto-generated skills** - Starter skills from detected technologies, feature clusters, and project conventions
5. **Self-learning loop** - Outcome recording, diagnosis, lesson writing, promotion, and skill patching
6. **Research cache** - Distilled technology docs with trust scoring and staleness tracking
7. **Decision log** - Architectural decisions that persist across sessions
8. **Embeddings** - Semantic search using MiniLM-L6 locally
9. **Telemetry** - Generation, learning, and research event tracking (local SQLite)
10. **Lifecycle proposals** - Merge/split/prune suggestions from git co-change analysis
11. **Token usage** - Query tracking for cost analysis

When your AI assistant asks a question, CodeImpact provides the relevant context. When the AI completes work, the self-learning loop captures what happened — successes confirm existing knowledge, failures trigger diagnosis and improvement.

---

## Language Support

| Language | What's Extracted |
|----------|------------------|
| TypeScript/JavaScript | Functions, classes, imports, exports |
| Python | Functions, classes, imports |
| Go | Functions, structs, imports |
| Rust | Functions, structs, imports |
| Java | Classes, methods, imports |

Parsing is powered by **Tree-sitter WASM**, providing true Abstract Syntax Tree (AST) understanding rather than fragile regex matching. This ensures 100% accurate symbol extraction, boundary detection, and method signatures across all supported languages.

---

## CLI Commands

```bash
# Setup
codeimpact init              # Set up project + configure AI tools
codeimpact serve             # Start HTTP API server

# Analysis
codeimpact deadcode          # Find unused exports and dead code
codeimpact test-impact       # Find which tests to run for changes
codeimpact impact <file>     # Analyze blast radius of a file
codeimpact stats             # Show token usage and costs
codeimpact reindex           # Force reindex after git operations

# Agent System
codeimpact agents init       # Initialize agent workspace
codeimpact agents generate   # Detect → research → generate → learn
codeimpact agents status     # Health, outcomes, lifecycle proposals
codeimpact agents research   # Refresh technology research
codeimpact agents migrate    # Migrate knowledge/ → .code-impact/

# Project Management
codeimpact projects list     # List registered projects
codeimpact projects add .    # Add current directory
codeimpact projects switch   # Switch active project
codeimpact export            # Export decisions to ADR files
codeimpact help              # Show help
```

### CLI Options

```bash
--project, -p <path>      # Path to the project directory
--json                    # Output as JSON
--threshold <percent>     # Minimum confidence % (for deadcode)
--changed <file>          # Specify changed file(s) (for test-impact)
--git-diff                # Use git diff to detect changes
--branch <name>           # Compare to branch (e.g., main)
--depth <n>               # Max dependency depth (default: 3)
--period <type>           # Time period: day, week, month, all
```

---

## HTTP API

For tools that don't support MCP, CodeImpact provides a REST API:

```bash
codeimpact serve --project /path/to/project --port 3333
```

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Project stats |
| GET | `/search?q=...` | Semantic code search |
| GET | `/dependencies?file=...` | File dependencies |
| GET | `/impact?file=...` | Impact analysis |
| GET | `/circular` | Find circular deps |
| GET | `/decisions` | List decisions |
| POST | `/decisions` | Record a decision |
| GET | `/symbols?file=...` | Get file symbols |

**Example:**
```bash
curl "http://localhost:3333/impact?file=src/auth/login.ts"
```

---

## Manual Configuration

If `codeimpact init` doesn't work for your setup, add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "codeimpact": {
      "command": "npx",
      "args": ["-y", "codeimpact", "--project", "/path/to/your/project"]
    }
  }
}
```

Config locations:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/claude/claude_desktop_config.json`

---

## Data Storage

Project data is stored locally in each project:

```
your-project/
├── .codeimpact/
│   ├── codeimpact.db        # SQLite database (index, outcomes, telemetry)
│   ├── tier1.json           # Hot context cache
│   └── feature-context.json # Session tracking
├── .code-impact/            # Agent workspace (auto-generated)
│   ├── config.yaml          # Agent system configuration
│   ├── index.json           # Technologies, features, outcomes, lifecycle
│   ├── project/             # Project-wide SKILL/CONVENTIONS/ARCHITECTURE/AGENT
│   ├── research/            # Distilled tech docs with trust scores
│   └── features/            # Per-feature SKILL + AGENT files
├── knowledge/               # Knowledge workspace
│   ├── skills/              # SKILL.md files (auto-generated + AI-created)
│   │   ├── technology/      # Tech pattern skills (auto-generated)
│   │   ├── features/        # Feature-scoped skills (auto-generated)
│   │   └── core/            # Project conventions (auto-generated)
│   ├── docs/                # Generated documentation
│   └── index.json           # Knowledge manifest (includes autoGeneration tracking)
├── src/
└── ...
```

Each project has its own isolated data — no cross-contamination between projects. The `.code-impact/` agent workspace is the primary knowledge store; `knowledge/` is supported for backward compatibility and can be migrated via `codeimpact agents migrate`.

Global registry for project listing:
```
~/.codeimpact/
└── registry.json           # Project list
```

---

## Privacy

- All data stays on your machine
- No cloud services
- No telemetry
- Works offline

---

## Development

```bash
git clone https://github.com/abhisavakar/codeimpact.git
cd codeimpact
npm install
npm run build
npm test              # 180+ tests including 10 eval scenarios
```

### Architecture

```
src/core/agents/                  # Super Agent System (12 modules)
├── orchestrator.ts               # Pipeline: init → detect → research → generate → learn
├── tech-detector.ts              # Lockfile + manifest scanning
├── feature-detector.ts           # Cohesion clustering + CODEOWNERS
├── research-engine.ts            # Fetch + distill + trust scoring
├── generator.ts                  # SKILL.md / CONVENTIONS.md / ARCHITECTURE.md
├── agent-generator.ts            # AGENT.md + AGENTS.md shim
├── improvement-engine.ts         # Self-learning: diagnose → learn → promote → decay + knowledge skill patching
├── diagnosis-table.ts            # 15-rule declarative error classification
├── outcome-storage.ts            # SQLite agent_outcomes table
├── lifecycle.ts                  # Merge/split/prune proposals
├── telemetry.ts                  # Event emission + dashboard queries
├── marker-writer.ts              # Content-hash dedup + token budgets
├── token-budget.ts               # Section-priority truncation
├── migration.ts                  # knowledge/ → .code-impact/ migration
├── research-trust.ts             # 7-signal trust scoring
├── remote-provider.ts            # GitHub/GitLab/Bitbucket abstraction
├── co-change-analyzer.ts         # Git log analysis for feature coupling
└── workspace.ts                  # Directory management + config

src/core/knowledge/               # Knowledge Layer
├── orchestrator.ts               # Knowledge generation pipeline (intel → providers → features → auto-skills → evolution)
├── skill-auto-generator.ts       # Auto-generates starter skills from codebase data (NEW in 0.5.0)
├── skill-generator.ts            # SKILL.md rendering + writing
├── skill-reader.ts               # Read/search skills across all scopes
├── skill-evolution.ts            # Evolve existing skills from usage data
├── intelligence-collector.ts     # Collect project intelligence (techs, risks, patterns)
├── provider-research.ts          # Technology documentation research
├── platform-sync.ts              # Sync rules to IDE platform files
├── doc-sync.ts                   # Sync architecture/component/changelog docs
└── workspace.ts                  # Knowledge workspace paths + manifest I/O
```

---

**Author:** Abhishek Arun Savakar - [savakar.com](https://savakar.com)

Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic.
