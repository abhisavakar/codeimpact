import type { ProjectInfo } from '../../core/project-manager.js';
import { PlatformRuleSync, ensureKnowledgeWorkspace, readManifest } from '../../core/knowledge/index.js';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import type { CommandResult } from './types.js';
import { addProject } from './projects.js';

// Helper to configure an MCP client
function configureMCPClient(
  clientName: string,
  configPath: string,
  serverName: string,
  projectPath: string
): { success: boolean; message: string } {
  let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    } else {
      // Create directory if needed
      const sep = process.platform === 'win32' ? '\\' : '/';
      const configDir = configPath.substring(0, configPath.lastIndexOf(sep));
      mkdirSync(configDir, { recursive: true });
    }
  } catch {
    // Config doesn't exist or is invalid, start fresh
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Execute direct binary to avoid npx network latency which causes 30s timeouts
  const isWindows = process.platform === 'win32';

  // Use absolute path to the compiled JS file to avoid cmd wrappers stalling MCP stdin/stdout streams
  // esbuild bundles everything into dist/index.js.
  // import.meta.url is file:///.../dist/index.js.
  // new URL('.', import.meta.url).pathname is /.../dist/
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const resolvedPath = resolve(__dirname, 'index.js');

  if (isWindows) {
    config.mcpServers[serverName] = {
      command: 'cmd',
      args: ['/c', 'node', resolvedPath, '--project', projectPath]
    };
  } else {
    config.mcpServers[serverName] = {
      command: 'node',
      args: [resolvedPath, '--project', projectPath]
    };
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: `${clientName}: ${configPath}` };
  } catch (err) {
    return { success: false, message: `${clientName}: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Helper to configure project-local .mcp.json for Claude Code, OpenCode, and other tools
function configureProjectMCP(
  configPath: string,
  projectPath: string
): { success: boolean; message: string } {
  let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }
  } catch {
    // Config doesn't exist or is invalid, start fresh
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Clean up old 'memorylayer' entries from previous versions
  delete config.mcpServers['memorylayer'];

  // Execute direct binary to avoid npx network latency which causes 30s timeouts
  const absoluteProjectPath = resolve(projectPath);
  const isWindows = process.platform === 'win32';

  // Use absolute path to the compiled JS file to avoid cmd wrappers stalling MCP stdin/stdout streams
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const resolvedPath = resolve(__dirname, 'index.js');

  if (isWindows) {
    config.mcpServers['codeimpact'] = {
      command: 'cmd',
      args: ['/c', 'node', resolvedPath, '--project', absoluteProjectPath]
    };
  } else {
    config.mcpServers['codeimpact'] = {
      command: 'node',
      args: [resolvedPath, '--project', absoluteProjectPath]
    };
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: `Claude Code / OpenCode: ${configPath} (project-local)` };
  } catch (err) {
    return { success: false, message: `Claude Code / OpenCode: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Helper to create/update CLAUDE.md with CodeImpact tool preferences
function configureClaudeMD(projectPath: string): { success: boolean; message: string } {
  const claudeMdPath = join(projectPath, 'CLAUDE.md');
  const codeimpactSection = `
## CodeImpact Integration

CodeImpact provides intelligent code analysis. **Use these tools FIRST** before falling back to built-in tools.

### Tool Preferences (IMPORTANT)

1. **For code searches and questions about the codebase:**
   - Use \`mcp__codeimpact__memory_query\` FIRST (759x faster than grep, returns context)
   - Only fall back to Grep/Glob if CodeImpact returns no results

2. **Before writing or suggesting code changes:**
   - Run \`mcp__codeimpact__memory_review\` to check against patterns, past decisions, and potential conflicts
   - This catches hallucinated imports, duplicate functions, and pattern violations

3. **Before finalizing/committing code:**
   - Run \`mcp__codeimpact__memory_verify\` for pre-commit quality checks
   - Catches security issues, missing dependencies, and import errors

4. **At session start:**
   - Run \`mcp__codeimpact__memory_status\` to get project overview and recent changes

5. **For impact analysis:**
   - Use \`mcp__codeimpact__memory_blast_radius\` to analyze risk of changing a file
   - Shows affected files, critical paths, and recommendations

### Why Use CodeImpact Tools?

- **Semantic search**: Understands intent, not just keywords
- **Pattern awareness**: Knows project conventions and enforces them
- **Decision memory**: Remembers past architectural decisions
- **D\u00e9j\u00e0 vu detection**: Surfaces similar past problems you've solved
- **Import validation**: Catches hallucinated imports before they break builds
- **Blast radius**: Understand impact and risk before making changes

### Quick Reference

| Task | Tool | Example |
|------|------|---------|
| Find code | \`memory_query\` | "how does auth work?" |
| Check code | \`memory_review\` | Before suggesting changes |
| Verify code | \`memory_verify\` | Before committing |
| Project status | \`memory_status\` | At session start |
| Save decision | \`memory_record\` | After architectural choices |
| Impact analysis | \`memory_blast_radius\` | Before modifying critical files |

### CLI Commands

CodeImpact also provides CLI commands for code analysis:

\`\`\`bash
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
\`\`\`
`;

  try {
    let existingContent = '';

    if (existsSync(claudeMdPath)) {
      existingContent = readFileSync(claudeMdPath, 'utf-8');

      // Check if CodeImpact section already exists
      if (existingContent.includes('## CodeImpact Integration')) {
        // Update existing section
        const startMarker = '## CodeImpact Integration';
        const startIndex = existingContent.indexOf(startMarker);

        // Find the next ## header or end of file
        const afterStart = existingContent.substring(startIndex + startMarker.length);
        const nextSectionMatch = afterStart.match(/\n## [^#]/);

        let endIndex: number;
        if (nextSectionMatch && nextSectionMatch.index !== undefined) {
          endIndex = startIndex + startMarker.length + nextSectionMatch.index;
        } else {
          endIndex = existingContent.length;
        }

        // Replace the section
        const newContent = existingContent.substring(0, startIndex) +
                          codeimpactSection.trim() +
                          '\n\n' +
                          existingContent.substring(endIndex).trimStart();

        writeFileSync(claudeMdPath, newContent.trim() + '\n');
        return { success: true, message: `CLAUDE.md: Updated CodeImpact section` };
      } else {
        // Append section at the end
        const newContent = existingContent.trimEnd() + '\n\n' + codeimpactSection.trim() + '\n';
        writeFileSync(claudeMdPath, newContent);
        return { success: true, message: `CLAUDE.md: Added CodeImpact section` };
      }
    } else {
      // Create new CLAUDE.md
      const newContent = `# Project Instructions\n${codeimpactSection}`;
      writeFileSync(claudeMdPath, newContent.trim() + '\n');
      return { success: true, message: `CLAUDE.md: Created with CodeImpact instructions` };
    }
  } catch (err) {
    return { success: false, message: `CLAUDE.md: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Helper to configure Cursor project-level MCP (.cursor/mcp.json)
function configureCursorProjectMCP(
  projectPath: string
): { success: boolean; message: string } {
  const cursorDir = join(projectPath, '.cursor');
  const configPath = join(cursorDir, 'mcp.json');

  // Create .cursor directory if it doesn't exist
  try {
    if (!existsSync(cursorDir)) {
      mkdirSync(cursorDir, { recursive: true });
    }
  } catch {
    // Directory might already exist
  }

  let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }
  } catch {
    // Config doesn't exist or is invalid, start fresh
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  const absoluteProjectPath = resolve(projectPath);
  const isWindows = process.platform === 'win32';

  // Use absolute path to the compiled JS file
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const resolvedPath = resolve(__dirname, 'index.js');

  if (isWindows) {
    config.mcpServers['codeimpact'] = {
      command: 'cmd',
      args: ['/c', 'node', resolvedPath, '--project', absoluteProjectPath]
    };
  } else {
    config.mcpServers['codeimpact'] = {
      command: 'node',
      args: [resolvedPath, '--project', absoluteProjectPath]
    };
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: `Cursor MCP: .cursor/mcp.json (project-local)` };
  } catch (err) {
    return { success: false, message: `Cursor MCP: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Helper to create/update .cursorrules with CodeImpact tool preferences
function configureCursorRules(projectPath: string): { success: boolean; message: string } {
  const cursorRulesPath = join(projectPath, '.cursorrules');
  const codeimpactSection = `
# CodeImpact Integration

CodeImpact provides intelligent code analysis. **Use these MCP tools FIRST** before falling back to built-in tools.

## Tool Preferences (IMPORTANT)

1. **For code searches and questions about the codebase:**
   - Use \`mcp_codeimpact_memory_query\` FIRST (semantic search, returns relevant context)
   - Only fall back to file search if CodeImpact returns no results

2. **Before writing or suggesting code changes:**
   - Run \`mcp_codeimpact_memory_review\` to check against patterns, past decisions, and potential conflicts
   - This catches hallucinated imports, duplicate functions, and pattern violations

3. **Before finalizing/committing code:**
   - Run \`mcp_codeimpact_memory_verify\` for pre-commit quality checks
   - Catches security issues, missing dependencies, and import errors

4. **At session start:**
   - Run \`mcp_codeimpact_memory_status\` to get project overview and recent changes

5. **For impact analysis:**
   - Use \`mcp_codeimpact_memory_blast_radius\` to analyze risk of changing a file
   - Shows affected files, critical paths, and recommendations

## Why Use CodeImpact Tools?

- **Semantic search**: Understands intent, not just keywords
- **Pattern awareness**: Knows project conventions and enforces them
- **Decision memory**: Remembers past architectural decisions
- **Import validation**: Catches hallucinated imports before they break builds
- **Blast radius**: Understand impact and risk before making changes

## Quick Reference

| Task | Tool |
|------|------|
| Find code | \`mcp_codeimpact_memory_query\` |
| Check code | \`mcp_codeimpact_memory_review\` |
| Verify code | \`mcp_codeimpact_memory_verify\` |
| Project status | \`mcp_codeimpact_memory_status\` |
| Save decision | \`mcp_codeimpact_memory_record\` |
| Impact analysis | \`mcp_codeimpact_memory_blast_radius\` |

## CLI Commands

\`\`\`bash
# Find unused exports and dead code
codeimpact deadcode

# Find which tests to run for changed files
codeimpact test-impact --changed src/file.ts

# Analyze blast radius and risk of changing a file
codeimpact impact src/core/engine.ts

# View token usage statistics
codeimpact stats
\`\`\`
`;

  try {
    let existingContent = '';

    if (existsSync(cursorRulesPath)) {
      existingContent = readFileSync(cursorRulesPath, 'utf-8');

      // Check if CodeImpact section already exists
      if (existingContent.includes('# CodeImpact Integration')) {
        // Update existing section
        const startMarker = '# CodeImpact Integration';
        const startIndex = existingContent.indexOf(startMarker);

        // Find the next # header (single #) or end of file
        const afterStart = existingContent.substring(startIndex + startMarker.length);
        const nextSectionMatch = afterStart.match(/\n# [^#]/);

        let endIndex: number;
        if (nextSectionMatch && nextSectionMatch.index !== undefined) {
          endIndex = startIndex + startMarker.length + nextSectionMatch.index;
        } else {
          endIndex = existingContent.length;
        }

        // Replace the section
        const newContent = existingContent.substring(0, startIndex) +
                          codeimpactSection.trim() +
                          '\n\n' +
                          existingContent.substring(endIndex).trimStart();

        writeFileSync(cursorRulesPath, newContent.trim() + '\n');
        return { success: true, message: `.cursorrules: Updated CodeImpact section` };
      } else {
        // Append section at the end
        const newContent = existingContent.trimEnd() + '\n\n' + codeimpactSection.trim() + '\n';
        writeFileSync(cursorRulesPath, newContent);
        return { success: true, message: `.cursorrules: Added CodeImpact section` };
      }
    } else {
      // Create new .cursorrules
      writeFileSync(cursorRulesPath, codeimpactSection.trim() + '\n');
      return { success: true, message: `.cursorrules: Created with CodeImpact instructions` };
    }
  } catch (err) {
    return { success: false, message: `.cursorrules: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Helper to configure OpenCode's opencode.json (uses a different format than other MCP clients)
function configureOpenCode(
  projectPath: string
): { success: boolean; message: string } {
  const configPath = join(projectPath, 'opencode.json');
  let config: Record<string, unknown> = {};

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }
  } catch {
    // Config doesn't exist or is invalid, start fresh
  }

  // OpenCode expects MCP servers under an "mcp" key with type "local" and command as array
  if (!config.mcp || typeof config.mcp !== 'object') {
    config.mcp = {};
  }

  // Clean up old 'memorylayer' entries from previous versions
  delete (config.mcp as Record<string, unknown>)['memorylayer'];

  const absoluteProjectPath = resolve(projectPath);
  const isWindows = process.platform === 'win32';

  // Use absolute path to the compiled JS file to avoid cmd wrappers stalling MCP stdin/stdout streams
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const resolvedPath = resolve(__dirname, 'index.js');

  if (isWindows) {
    (config.mcp as Record<string, unknown>)['codeimpact'] = {
      type: 'local',
      command: ['cmd', '/c', 'node', resolvedPath, '--project', absoluteProjectPath],
      enabled: true
    };
  } else {
    (config.mcp as Record<string, unknown>)['codeimpact'] = {
      type: 'local',
      command: ['node', resolvedPath, '--project', absoluteProjectPath],
      enabled: true
    };
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: `OpenCode: ${configPath}` };
  } catch (err) {
    return { success: false, message: `OpenCode: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Helper to write a URL-based MCP config entry (for remote server mode)
function configureRemoteMCPClient(
  clientName: string,
  configPath: string,
  serverName: string,
  serverUrl: string
): { success: boolean; message: string } {
  let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // start fresh
  }
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[serverName] = { url: serverUrl };
  try {
    const dir = configPath.substring(0, configPath.lastIndexOf('/') || configPath.lastIndexOf('\\'));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: `${clientName}: ${configPath}` };
  } catch (err) {
    return { success: false, message: `${clientName}: Failed - ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Initialize codeimpact for current project + auto-configure Claude Desktop & OpenCode
export function initProject(projectPath?: string, serverUrl?: string): CommandResult {
  const targetPath = projectPath || process.cwd();

  // 1. Register the project
  const addResult = addProject(targetPath);
  if (!addResult.success) {
    return addResult;
  }

  const projectInfo = addResult.data as ProjectInfo;
  const serverName = `codeimpact-${projectInfo.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const platform = process.platform;

  const configuredClients: string[] = [];
  const failedClients: string[] = [];

  // 2. Configure Claude Desktop
  let claudeConfigPath: string;
  if (platform === 'win32') {
    claudeConfigPath = join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'darwin') {
    claudeConfigPath = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else {
    claudeConfigPath = join(homedir(), '.config', 'claude', 'claude_desktop_config.json');
  }

  if (serverUrl) {
    // Remote server mode — write URL-based config to all tools
    const remoteProjectUrl = `${serverUrl}/mcp?project=${encodeURIComponent(resolve(targetPath))}`;

    const claudeResult = configureRemoteMCPClient('Claude Desktop', claudeConfigPath, serverName, remoteProjectUrl);
    if (claudeResult.success) configuredClients.push(claudeResult.message);
    else failedClients.push(claudeResult.message);

    const claudeCodeConfigPath = join(targetPath, '.mcp.json');
    const claudeCodeResult = configureRemoteMCPClient('Claude Code', claudeCodeConfigPath, 'codeimpact', remoteProjectUrl);
    if (claudeCodeResult.success) configuredClients.push(claudeCodeResult.message);

    let cursorConfigPath: string;
    if (platform === 'win32') {
      cursorConfigPath = join(homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
    } else if (platform === 'darwin') {
      cursorConfigPath = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
    } else {
      cursorConfigPath = join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
    }
    const cursorResult = configureRemoteMCPClient('Cursor (global)', cursorConfigPath, serverName, remoteProjectUrl);
    if (cursorResult.success) configuredClients.push(cursorResult.message);

    configuredClients.push(`Remote server: ${remoteProjectUrl}`);
  } else {
    // Local mode — spawn a local process
    const claudeResult = configureMCPClient('Claude Desktop', claudeConfigPath, serverName, targetPath);
    if (claudeResult.success) configuredClients.push(claudeResult.message);
    else failedClients.push(claudeResult.message);

    // 3. Configure OpenCode (uses opencode.json with different format)
    const openCodeResult = configureOpenCode(targetPath);
    if (openCodeResult.success) configuredClients.push(openCodeResult.message);
    else failedClients.push(openCodeResult.message);

    // 4. Configure Claude Code (CLI) - use project-local .mcp.json
    const claudeCodeConfigPath = join(targetPath, '.mcp.json');
    const claudeCodeResult = configureProjectMCP(claudeCodeConfigPath, targetPath);
    if (claudeCodeResult.success) configuredClients.push(claudeCodeResult.message);

    // 5. Configure Cursor (both global and project-level)
    // 5a. Global Cursor MCP config
    let cursorConfigPath: string;
    if (platform === 'win32') {
      cursorConfigPath = join(homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
    } else if (platform === 'darwin') {
      cursorConfigPath = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
    } else {
      cursorConfigPath = join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
    }
    const cursorGlobalResult = configureMCPClient('Cursor (global)', cursorConfigPath, serverName, targetPath);
    if (cursorGlobalResult.success) configuredClients.push(cursorGlobalResult.message);

    // 5b. Project-level Cursor MCP config (.cursor/mcp.json)
    const cursorProjectResult = configureCursorProjectMCP(targetPath);
    if (cursorProjectResult.success) configuredClients.push(cursorProjectResult.message);
    else failedClients.push(cursorProjectResult.message);

    // 5c. Cursor rules file (.cursorrules)
    const cursorRulesResult = configureCursorRules(targetPath);
    if (cursorRulesResult.success) configuredClients.push(cursorRulesResult.message);
    else failedClients.push(cursorRulesResult.message);
  }

  // 6. Configure CLAUDE.md with tool preferences (both modes)
  const claudeMdResult = configureClaudeMD(targetPath);
  if (claudeMdResult.success) configuredClients.push(claudeMdResult.message);
  else failedClients.push(claudeMdResult.message);

  // 7. Sync platform instruction/rule files to shared knowledge workspace.
  try {
    const paths = ensureKnowledgeWorkspace(targetPath);
    const platformSync = new PlatformRuleSync(targetPath);
    const manifest = readManifest(targetPath);
    const skillIndex = manifest.skills.map((s) => `${s.name}: ${(s.description || '').slice(0, 80)}`);
    const syncResults = platformSync.syncAll(paths, skillIndex);
    const updatedCount = syncResults.filter((result) => result.updated).length;
    configuredClients.push(`Knowledge rule sync: ${updatedCount}/${syncResults.length} files updated`);
  } catch (err) {
    failedClients.push(`Knowledge rule sync: Failed - ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build result message
  const modeNote = serverUrl ? `\nMode: Remote server (${serverUrl})` : '';
  let message = `
CodeImpact initialized!

Project: ${projectInfo.name}
Path: ${targetPath}
Data: ${projectInfo.dataDir}${modeNote}

Configured MCP Clients:
${configuredClients.map(c => '  \u2713 ' + c).join('\n')}
`;

  if (failedClients.length > 0) {
    message += `\nFailed:\n${failedClients.map(c => '  \u2717 ' + c).join('\n')}`;
  }

  message += `\n\nRestart your AI tools to activate.`;

  return {
    success: true,
    message: message.trim(),
    data: { projectInfo, serverName, configuredClients }
  };
}
