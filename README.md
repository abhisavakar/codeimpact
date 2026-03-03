# CodeImpact

**Persistent codebase understanding for AI assistants.**

CodeImpact is an MCP server that indexes your codebase and gives AI assistants like Claude the ability to understand your project's structure, dependencies, and history across sessions.

[![npm version](https://img.shields.io/npm/v/codeimpact.svg)](https://www.npmjs.com/package/codeimpact)
[![downloads](https://img.shields.io/npm/dt/codeimpact.svg)](https://www.npmjs.com/package/codeimpact)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)

---

## What CodeImpact Does

- **Indexes your code** - Extracts functions, classes, imports, and exports using true Tree-sitter AST parsing
- **Builds a dependency graph** - Tracks what files import what, transitively
- **Analyzes impact** - Shows which files are affected when you change something
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
"What tests cover this function?"
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
codeimpact init              # Set up project + configure AI tools
codeimpact serve             # Start HTTP API server
codeimpact projects list     # List registered projects
codeimpact projects add .    # Add current directory
codeimpact projects switch   # Switch active project
codeimpact export            # Export decisions to ADR files
codeimpact help              # Show help
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

Project data is stored locally:

```
~/.memorylayer/
├── projects/
│   └── your-project-abc123/
│       ├── codeimpact.db    # SQLite database
│       └── embeddings/       # Vector index
└── registry.json             # Project list
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
```

---

## License

MIT - see [LICENSE](LICENSE)

---

**Author:** Abhishek Arun Savakar - [savakar.com](https://savakar.com)

Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic.
