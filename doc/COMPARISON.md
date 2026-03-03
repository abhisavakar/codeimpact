# CodeImpact vs Code Impact

A comparison between the open-source CodeImpact and the enterprise Code Impact solution.

---

## Overview

| | CodeImpact | Code Impact |
|---|-------------|-------------|
| **Target** | Individual developers, small teams | Enterprise teams, large codebases |
| **License** | MIT (Open Source) | Commercial |
| **Pricing** | Free | Contact for pricing |
| **Support** | Community | Priority support |

---

## Feature Comparison

### Code Parsing

| Feature | CodeImpact | Code Impact |
|---------|:-----------:|:-----------:|
| TypeScript/JavaScript | Regex | Tree-sitter AST |
| Python | Regex | Tree-sitter AST |
| Go | - | Tree-sitter AST |
| Rust | - | Tree-sitter AST |
| Java | - | Tree-sitter AST |
| Accurate symbol boundaries | Partial | 100% |
| Method signatures | Basic | Full |
| Nested structures | Limited | Full |

**Why it matters:** Tree-sitter provides true Abstract Syntax Tree parsing, meaning 100% accurate symbol extraction, proper handling of edge cases, and support for complex nested structures that regex cannot reliably parse.

---

### Code Intelligence

| Feature | CodeImpact | Code Impact |
|---------|:-----------:|:-----------:|
| Semantic search | Yes | Yes |
| File indexing | Yes | Yes |
| Decision recording | Yes | Yes |
| Pattern library | Yes | Yes |
| **Dependency graph** | - | Yes |
| **Impact analysis** | - | Yes |
| **Circular dependency detection** | - | Yes |
| **Test coverage mapping** | - | Yes |
| **Cross-file refactoring insights** | - | Yes |

---

### Integration

| Feature | CodeImpact | Code Impact |
|---------|:-----------:|:-----------:|
| Claude Desktop | Yes | Yes |
| Claude Code (CLI) | Yes | Yes |
| OpenCode | Yes | Yes |
| Cursor | Yes | Yes |
| Any MCP Client | Yes | Yes |
| **HTTP REST API** | - | Yes |
| **Non-MCP tools** | - | Yes |
| **Custom integrations** | - | Yes |

---

### API Access

**CodeImpact** - MCP protocol only

**Code Impact** - MCP + HTTP REST API

```bash
# Start HTTP server
codeimpact serve --project /path/to/project --port 3333
```

| Endpoint | Description |
|----------|-------------|
| `GET /status` | Project statistics |
| `GET /search?q=...` | Semantic code search |
| `GET /dependencies?file=...` | File dependencies |
| `GET /impact?file=...` | Impact analysis |
| `GET /circular` | Circular dependency detection |
| `GET /decisions` | List architectural decisions |
| `POST /decisions` | Record a decision |
| `GET /symbols?file=...` | Get file symbols |

---

## Use Cases

### CodeImpact (Free)

Best for:
- Individual developers
- Small projects
- Learning and experimentation
- Open source projects
- Basic code intelligence needs

### Code Impact (Enterprise)

Best for:
- Large codebases (100K+ lines)
- Enterprise teams (5+ developers)
- Multi-language projects
- CI/CD integration requirements
- Custom tooling and integrations
- Mission-critical refactoring
- Compliance and audit requirements

---

## Example: Impact Analysis

**Scenario:** You're about to modify `src/auth/login.ts`

**CodeImpact response:**
> "I can search for references to this file."

**Code Impact response:**
> "Modifying `src/auth/login.ts` will impact:
> - 12 files that directly import this module
> - 34 files transitively affected
> - 8 test files that cover this code
> - No circular dependencies detected
>
> High-risk changes: `validateCredentials()` is used by 23 downstream files."

---

## Example: Dependency Graph

**Code Impact** builds a complete dependency graph of your codebase:

```
src/auth/login.ts
├── imports
│   ├── src/utils/crypto.ts
│   ├── src/db/users.ts
│   └── src/config/auth.ts
└── imported by
    ├── src/routes/auth.ts
    ├── src/middleware/session.ts
    └── src/controllers/user.ts (transitively)
```

This enables:
- "What breaks if I change this?"
- "What's the safest refactoring order?"
- "Are there any circular dependencies?"

---

## Getting Started

### CodeImpact (Free)

```bash
npm install -g codeimpact
cd your-project
codeimpact init
```

### Code Impact (Enterprise)

Contact: abhishek@savakar.com

---

## Summary

| Need | Recommendation |
|------|----------------|
| Basic code intelligence | CodeImpact |
| Just getting started with AI coding | CodeImpact |
| Small personal projects | CodeImpact |
| Large enterprise codebase | Code Impact |
| Multi-language projects | Code Impact |
| CI/CD and custom integrations | Code Impact |
| Impact analysis before changes | Code Impact |
| Team collaboration features | Code Impact |

---

**Questions?** Contact abhishek@savakar.com
