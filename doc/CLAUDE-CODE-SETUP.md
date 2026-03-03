# CodeImpact + Claude Code Setup Guide

This guide explains how to configure CodeImpact as an MCP server for [Claude Code](https://code.claude.com/) (Anthropic's CLI tool).

---

## Prerequisites

1. **Node.js 18+** installed
2. **Claude Code** installed (`npm install -g @anthropic-ai/claude-code`)
3. **CodeImpact** built (`npm run build`)

---

## Quick Setup (Recommended)

The easiest and most reliable way to configure CodeImpact for Claude Code is using our automated initialization command.

### Step 1: Initialize CodeImpact

Run this command in the root of your project:

```bash
npx codeimpact init .
```

This will automatically configure `.mcp.json` in your project with the exact absolute paths and platform-specific commands required for Claude Code to connect smoothly to CodeImpact.

### Step 2: Verify Connection

Start Claude Code and check your servers:

```bash
# Inside Claude Code
/mcp
```

You should see:
```
MCP Servers
  codeimpact (stdio)
    Status: connected
```

---

## Configuration Methods (Advanced)

If you prefer not to use the automated `npx codeimpact init` command, Claude Code provides several ways to configure MCP servers manually.

### Method 1: CLI Commands

Claude Code provides CLI commands to manage MCP servers:

```bash
# Add a server
claude mcp add --transport stdio codeimpact -- node /absolute/path/to/dist/index.js --project .

# List all servers
claude mcp list

# Get server details
claude mcp get codeimpact

# Remove a server
claude mcp remove codeimpact
```

**Note:** On Windows natively, you MUST wrap the node execution with `cmd /c` to prevent stdin/stdout hanging issues:
```bash
claude mcp add --transport stdio codeimpact -- cmd /c node C:\absolute\path\to\dist\index.js --project .
```

### Method 2: Project Configuration (`.mcp.json`)

If you want to create `.mcp.json` in your project root manually:

```json
{
  "mcpServers": {
    "codeimpact": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/codeimpact/dist/index.js", "--project", "."],
      "env": {}
    }
  }
}
```

*For Windows, use `["cmd", "/c", "node", "C:\\absolute\\path\\to\\dist\\index.js", "--project", "."]` in the command and args fields as appropriate depending on your node integration.*

---

## Configuration Scopes

| Scope | Storage Location | Use Case |
|-------|------------------|----------|
| `local` (default) | `~/.claude.json` | Personal, current project only |
| `project` | `.mcp.json` | Shared with team via version control |
| `user` | `~/.claude.json` | Personal, available across all projects |

```bash
# The automated init command uses Project scope by default
npx codeimpact init .
```

---

## Platform-Specific Setup

### Windows (Native)

On native Windows (not WSL), use the `cmd /c` wrapper for proper execution:

```bash
# Using CLI
claude mcp add --transport stdio codeimpact -- cmd /c node C:\path\to\codeimpact\dist\index.js --project .
```

**In `.mcp.json`:**

```json
{
  "mcpServers": {
    "codeimpact": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "node", "C:\\path\\to\\codeimpact\\dist\\index.js", "--project", "."],
      "env": {}
    }
  }
}
```

### Windows (WSL)

WSL works like Linux:

```bash
claude mcp add --transport stdio codeimpact -- node /path/to/codeimpact/dist/index.js --project .
```

### macOS / Linux

```bash
claude mcp add --transport stdio codeimpact -- node /path/to/codeimpact/dist/index.js --project .
```

**In `.mcp.json`:**

```json
{
  "mcpServers": {
    "codeimpact": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/you/codeimpact/dist/index.js", "--project", "."],
      "env": {}
    }
  }
}
```

---

## After npm Publish

Once CodeImpact is published to npm, setup becomes simpler:

### CLI Command

```bash
# Install globally
npm install -g codeimpact

# Add to Claude Code
claude mcp add --transport stdio codeimpact -- codeimpact --project .
```

### Using npx

```bash
# Without installation
claude mcp add --transport stdio codeimpact -- npx -y codeimpact --project .
```

**Windows (with npx):**

```bash
claude mcp add --transport stdio codeimpact -- cmd /c npx -y codeimpact --project .
```

### Project `.mcp.json`

```json
{
  "mcpServers": {
    "codeimpact": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codeimpact", "--project", "."],
      "env": {}
    }
  }
}
```

---

## Environment Variables

### CodeImpact Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEIMPACT_MAX_TOKENS` | 6000 | Maximum tokens for context assembly |
| `CODEIMPACT_DEBUG` | false | Enable debug logging |

```bash
claude mcp add --transport stdio \
  --env CODEIMPACT_MAX_TOKENS=8000 \
  --env CODEIMPACT_DEBUG=true \
  codeimpact -- node dist/index.js --project .
```

### Claude Code MCP Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TIMEOUT` | 60000 | Server startup timeout (ms) |
| `MAX_MCP_OUTPUT_TOKENS` | 25000 | Max tokens from MCP tools |

```bash
# Start Claude Code with custom MCP settings
MCP_TIMEOUT=120000 MAX_MCP_OUTPUT_TOKENS=50000 claude
```

---

## Available MCP Tools

Once connected, Claude Code can use these CodeImpact tools:

### Core Tools

| Tool | Description |
|------|-------------|
| `get_context` | Get relevant codebase context for a query |
| `search_codebase` | Semantic search across all files |
| `record_decision` | Save an architectural decision |
| `get_file_context` | Get content of a specific file |
| `get_project_summary` | Overview of project structure |

### Symbol & Dependency Tools

| Tool | Description |
|------|-------------|
| `get_symbol` | Find functions, classes, types by name |
| `get_dependencies` | See imports/exports for a file |
| `get_file_summary` | Get compressed file summary (10x smaller) |

### Living Documentation Tools

| Tool | Description |
|------|-------------|
| `generate_docs` | Generate documentation for a file or architecture |
| `get_architecture` | Get project architecture overview |
| `get_component_doc` | Get detailed documentation for a component |
| `get_changelog` | Get changelog of recent changes |
| `validate_docs` | Check for outdated docs |
| `what_happened` | Query recent project activity |

### Context Health Tools

| Tool | Description |
|------|-------------|
| `get_context_health` | Check context health and drift score |
| `trigger_compaction` | Manually trigger context compaction |
| `mark_critical` | Mark content as critical (never compress) |

### Confidence & Intelligence Tools

| Tool | Description |
|------|-------------|
| `get_confidence` | Get confidence score for code suggestion |
| `check_conflicts` | Check if code conflicts with past decisions |
| `what_changed` | Query what changed in the codebase |
| `why_broke` | Diagnose why something broke |
| `suggest_fix` | Get fix suggestions for an error |

### Architecture Tools

| Tool | Description |
|------|-------------|
| `validate_pattern` | Validate code against established patterns |
| `suggest_existing` | Find existing functions that match intent |
| `learn_pattern` | Teach a new pattern to the system |
| `list_patterns` | List all learned patterns |

### Test Awareness Tools

| Tool | Description |
|------|-------------|
| `get_related_tests` | Get tests related to a file or function |
| `check_tests` | Check if a code change would break tests |
| `suggest_test_update` | Get suggested test updates for a change |
| `get_test_coverage` | Get test coverage for a file |

---

## Example Usage

Once configured, try these prompts in Claude Code:

```
> Search for authentication code in this project

> What architectural decisions have been made?

> Show me the project summary

> Find the function that handles user login

> What files import the database module?

> What changed in the last 24 hours?

> Why might the login test be failing?

> Record a decision: We chose SQLite for local storage because it's embedded and requires no separate server

> Get the architecture overview of this project

> Check if this code follows our patterns: async function fetchUser(id) { ... }
```

---

## Troubleshooting

### "Connection closed" on Windows

Ensure you're using the `cmd /c` wrapper:

```bash
# Wrong
claude mcp add --transport stdio codeimpact -- node dist/index.js --project .

# Correct
claude mcp add --transport stdio codeimpact -- cmd /c node dist/index.js --project .
```

### "Server not found" or "ENOENT"

1. Verify the path to `dist/index.js` is correct and absolute
2. Ensure CodeImpact is built: `npm run build`
3. Check Node.js is in your PATH

### "MCP server not connected"

1. Run `claude mcp list` to check configuration
2. Run `/mcp` inside Claude Code to see status
3. Check for errors in the server output

### "Configuration is invalid"

Ensure your JSON is valid and `command` is a string (not array):

```json
// Correct
{
  "type": "stdio",
  "command": "node",
  "args": ["dist/index.js", "--project", "."]
}

// Wrong
{
  "type": "stdio",
  "command": ["node", "dist/index.js"]
}
```

### Server Takes Too Long to Start

Increase the MCP timeout:

```bash
MCP_TIMEOUT=120000 claude
```

Or set in `.mcp.json`:

```json
{
  "mcpServers": {
    "codeimpact": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js", "--project", "."],
      "env": {},
      "timeout": 120000
    }
  }
}
```

### View Debug Logs

```bash
# Run Claude Code with debug logging
claude --log-level DEBUG
```

---

## Importing from Claude Desktop

If you already have CodeImpact configured in Claude Desktop:

```bash
# Import all servers from Claude Desktop
claude mcp add-from-claude-desktop

# Select codeimpact from the list

# Verify import
claude mcp list
```

---

## Data Storage

CodeImpact stores data locally:

```
~/.codeimpact/
├── registry.json          # Project registry
└── projects/
    └── {project-name}-{hash}/
        ├── codeimpact.db  # SQLite database
        └── tier1.json      # Working context
```

---

## Comparison: Claude Desktop vs Claude Code

| Feature | Claude Desktop | Claude Code |
|---------|----------------|-------------|
| Config Location | `~/.claude/claude_desktop_config.json` | `~/.claude.json` or `.mcp.json` |
| Add Server | Manual JSON edit | CLI commands or JSON |
| Project Scope | No | Yes (`.mcp.json`) |
| User Scope | Yes | Yes |
| Local Scope | N/A | Yes (default) |
| Env Var Expansion | No | Yes (`${VAR}` syntax) |

---

## Links

- [Claude Code Documentation](https://code.claude.com/docs/)
- [Claude Code MCP Guide](https://code.claude.com/docs/en/mcp)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [CodeImpact Documentation](./INDEX.md)

---

## Quick Reference

### Minimum Setup

```bash
# One-liner setup
claude mcp add --transport stdio codeimpact -- node /path/to/codeimpact/dist/index.js --project .
```

### Full `.mcp.json` Example

```json
{
  "mcpServers": {
    "codeimpact": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/codeimpact/dist/index.js",
        "--project",
        "."
      ],
      "env": {
        "CODEIMPACT_MAX_TOKENS": "8000"
      }
    }
  }
}
```

---

*Last updated: February 2026*
