# CodeImpact

**Persistent codebase understanding for AI assistants.**

CodeImpact is an MCP server that indexes your codebase and gives AI assistants like Claude the ability to understand your project's structure, dependencies, and history across sessions.

[![npm version](https://img.shields.io/npm/v/codeimpact.svg)](https://www.npmjs.com/package/codeimpact)
[![downloads](https://img.shields.io/npm/dt/codeimpact.svg)](https://www.npmjs.com/package/codeimpact)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)

---

## What CodeImpact Does

- **Indexes your code** - Extracts functions, classes, imports, and exports using true Tree-sitter AST parsing
- **Builds a dependency graph** - Tracks what files import what, transitively
- **Dead code detection** - Finds unused exports and orphan files with confidence scoring
- **Test impact analysis** - Shows which tests to run when you change a file
- **Blast radius analysis** - Risk scoring and critical path detection for any file change
- **Cost tracking** - Monitors token usage and costs for CodeImpact queries
- **Detects circular dependencies** - Finds import cycles in your codebase
- **Indexes tests** - Identifies test files and what source files they cover
- **Records decisions** - Stores architectural decisions that persist across sessions
- **Semantic search** - Find code by meaning using local embeddings

All processing happens locally on your machine. No cloud services, no telemetry.

---

## Quick Start

```bash
# Install
npm install -g codeimpact

# Initialize in your project
cd your-project
codeimpact init
```

This registers your project and configures Claude Desktop, Claude Code, OpenCode, and Cursor automatically. Restart your AI tool and you're ready.

> **Windows users**: If upgrading, close any AI tools using CodeImpact first (or run `taskkill /f /im node.exe`) before reinstalling. Windows locks native binaries while they're in use.

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

1. **Symbol index** - Functions, classes, imports, exports
2. **Dependency graph** - File-to-file import relationships
3. **Decision log** - Architectural decisions you've recorded
4. **Embeddings** - For semantic search (using MiniLM-L6 locally)
5. **Test index** - Test files and their coverage mappings
6. **Token usage** - Query tracking for cost analysis

When your AI assistant asks a question, CodeImpact provides the relevant context.

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
│   ├── codeimpact.db       # SQLite database
│   ├── tier1.json          # Hot context cache
│   └── feature-context.json # Session tracking
├── src/
└── ...
```

Each project has its own isolated `.codeimpact/` folder - no cross-contamination between projects.

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
git clone https://github.com/anthropics/codeimpact.git
cd codeimpact
npm install
npm run build
```

---

**Author:** Abhishek Arun Savakar - [savakar.com](https://savakar.com)

Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic.
