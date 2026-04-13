import { ProjectManager, type ProjectInfo } from '../core/project-manager.js';
import { ADRExporter } from '../core/adr-exporter.js';
import { DeadCodeDetector, type DeadCodeReport } from '../core/dead-code-detector.js';
import { TestImpactAnalyzer, type TestImpactResult } from '../core/test-impact-analyzer.js';
import { BlastRadiusAnalyzer, type BlastRadiusResult } from '../core/blast-radius.js';
import { CostTracker, type UsageStats, type StatsPeriod } from '../core/cost-tracker.js';
import { TestAwareness } from '../core/test-awareness/index.js';
import { PlatformRuleSync, ensureKnowledgeWorkspace, readManifest } from '../core/knowledge/index.js';
import { ProviderResearch } from '../core/knowledge/provider-research.js';
import { initializeDatabase } from '../storage/database.js';
import { Tier2Storage } from '../storage/tier2.js';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const projectManager = new ProjectManager();

interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// List all projects
export function listProjects(): CommandResult {
  const projects = projectManager.listProjects();
  const activeProject = projectManager.getActiveProject();

  if (projects.length === 0) {
    return {
      success: true,
      message: 'No projects registered. Use "codeimpact projects add <path>" to add one.'
    };
  }

  const lines = ['Registered Projects:', ''];
  for (const project of projects) {
    const isActive = activeProject?.id === project.id ? ' (active)' : '';
    lines.push(`  ${project.name}${isActive}`);
    lines.push(`    ID: ${project.id}`);
    lines.push(`    Path: ${project.path}`);
    lines.push(`    Files: ${project.totalFiles}, Decisions: ${project.totalDecisions}`);
    lines.push(`    Languages: ${project.languages.join(', ') || 'N/A'}`);
    lines.push('');
  }

  return {
    success: true,
    message: lines.join('\n'),
    data: projects
  };
}

// Add a project
export function addProject(projectPath: string): CommandResult {
  try {
    const projectInfo = projectManager.registerProject(projectPath);
    projectManager.setActiveProject(projectInfo.id);

    return {
      success: true,
      message: `Project "${projectInfo.name}" registered and set as active.\nID: ${projectInfo.id}\nData directory: ${projectInfo.dataDir}`,
      data: projectInfo
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to add project: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Remove a project
export function removeProject(projectId: string): CommandResult {
  const project = projectManager.getProject(projectId);

  if (!project) {
    return {
      success: false,
      message: `Project not found: ${projectId}`
    };
  }

  const removed = projectManager.removeProject(projectId);

  return {
    success: removed,
    message: removed
      ? `Project "${project.name}" removed from registry.`
      : `Failed to remove project.`
  };
}

// Switch to a project
export function switchProject(projectId: string): CommandResult {
  const project = projectManager.getProject(projectId);

  if (!project) {
    return {
      success: false,
      message: `Project not found: ${projectId}`
    };
  }

  const switched = projectManager.setActiveProject(projectId);

  return {
    success: switched,
    message: switched
      ? `Switched to project: ${project.name}`
      : `Failed to switch project.`
  };
}

// Discover projects
export function discoverProjects(): CommandResult {
  const discovered = projectManager.discoverProjects();

  if (discovered.length === 0) {
    return {
      success: true,
      message: 'No projects discovered in common locations.'
    };
  }

  const lines = [`Discovered ${discovered.length} potential projects:`, ''];
  for (const path of discovered) {
    const name = path.split(/[/\\]/).pop();
    lines.push(`  ${name}`);
    lines.push(`    ${path}`);
    lines.push('');
  }
  lines.push('Use "codeimpact projects add <path>" to register a project.');

  return {
    success: true,
    message: lines.join('\n'),
    data: discovered
  };
}

// Export decisions to ADR
export function exportDecisions(
  projectPath?: string,
  options: { outputDir?: string; format?: 'madr' | 'nygard' | 'simple' } = {}
): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database and get decisions (check both new and old names)
  let dbPath = join(projectInfo.dataDir, 'codeimpact.db');
  if (!existsSync(dbPath)) {
    // Fall back to old name for backwards compatibility
    const oldDbPath = join(projectInfo.dataDir, 'codeimpact.db');
    if (existsSync(oldDbPath)) {
      dbPath = oldDbPath;
    } else {
      return {
        success: false,
        message: `Project database not found. Has the project been indexed?`
      };
    }
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);
  const decisions = tier2.getAllDecisions();
  db.close();

  if (decisions.length === 0) {
    return {
      success: true,
      message: 'No decisions to export.'
    };
  }

  // Export
  const exporter = new ADRExporter(targetPath);
  const exportedFiles = exporter.exportAllDecisions(decisions, {
    outputDir: options.outputDir,
    format: options.format,
    includeIndex: true
  });

  return {
    success: true,
    message: `Exported ${exportedFiles.length} ADR files to ${options.outputDir || join(targetPath, 'docs', 'decisions')}`,
    data: exportedFiles
  };
}

// Helper to find database path (checks both centralized and project-local locations)
function findDatabasePath(projectInfo: ProjectInfo): string | null {
  // First try centralized location
  const centralizedPath = join(projectInfo.dataDir, 'codeimpact.db');
  if (existsSync(centralizedPath)) {
    return centralizedPath;
  }

  // Then try project-local .codeimpact directory
  const projectLocalPath = join(projectInfo.path, '.codeimpact', 'codeimpact.db');
  if (existsSync(projectLocalPath)) {
    return projectLocalPath;
  }

  return null;
}

function resolveProjectPath(projectPath?: string): { success: boolean; message?: string; targetPath?: string; projectInfo?: ProjectInfo } {
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.',
      };
    }
    targetPath = activeProject.path;
  }

  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`,
    };
  }

  return { success: true, targetPath, projectInfo };
}

export function runKnowledgeStatus(projectPath?: string): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  const paths = ensureKnowledgeWorkspace(resolved.targetPath);
  const manifest = readManifest(resolved.targetPath);

  const status = {
    generatedAt: manifest.generatedAt,
    skillCount: manifest.skills.length,
    docCount: manifest.docs.length,
    providerCount: manifest.providers.length,
    workspaceRoot: paths.root,
  };

  return {
    success: true,
    message: [
      'Knowledge Workspace Status',
      `Root: ${status.workspaceRoot}`,
      `Generated: ${status.generatedAt}`,
      `Skills: ${status.skillCount}`,
      `Docs: ${status.docCount}`,
      `Providers: ${status.providerCount}`,
    ].join('\n'),
    data: status,
  };
}

export function runKnowledgeGenerate(
  projectPath?: string,
  options: { reason?: string; dryRun?: boolean } = {}
): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  return {
    success: true,
    message: [
      'Knowledge generation requires the full engine.',
      'Use the MCP tool knowledge_generate or start the server and run:',
      `  codeimpact init ${resolved.targetPath}`,
      'The engine will auto-generate knowledge on startup and file changes.',
    ].join('\n'),
  };
}

export function runKnowledgeSyncRules(projectPath?: string, dryRun = false): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  const paths = ensureKnowledgeWorkspace(resolved.targetPath);
  const manifest = readManifest(resolved.targetPath);
  const skillIndex = manifest.skills.map((s) => `${s.name}: ${(s.description || '').slice(0, 80)}`);
  const platformSync = new PlatformRuleSync(resolved.targetPath);
  const result = platformSync.syncAll(paths, skillIndex, { dryRun });

  return {
    success: true,
    message: `Rules synced (${dryRun ? 'dry-run' : 'write'}): ${result.filter((entry) => entry.updated).length}/${result.length}`,
    data: result,
  };
}

export function runKnowledgeResearch(
  projectPath?: string,
  options: { topics?: string[]; dryRun?: boolean } = {}
): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  const providerResearch = new ProviderResearch(resolved.targetPath);
  const result = providerResearch.refresh({ topics: options.topics, dryRun: options.dryRun });

  return {
    success: true,
    message: `Provider docs refreshed (${options.dryRun ? 'dry-run' : 'write'}): ${result.length}`,
    data: result,
  };
}

// Run dead code analysis
export function runDeadCodeAnalysis(
  projectPath?: string,
  options: { json?: boolean; threshold?: number } = {}
): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: false,
      message: `Project database not found. Run "codeimpact init ${targetPath}" first to index the project.`
    };
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);

  // Run dead code analysis
  const detector = new DeadCodeDetector(tier2);
  const report = detector.analyze();
  db.close();

  // Apply threshold filter if specified
  let filteredReport = report;
  if (options.threshold !== undefined) {
    filteredReport = {
      ...report,
      unusedExports: report.unusedExports.filter(e => e.confidence >= options.threshold!),
      unusedFiles: report.unusedFiles.filter(f => f.confidence >= options.threshold!),
      safeToDelete: report.safeToDelete.filter(e => e.confidence >= options.threshold!),
    };
  }

  // Format output
  const output = options.json
    ? detector.formatReportJSON(filteredReport)
    : detector.formatReport(filteredReport);

  return {
    success: true,
    message: output,
    data: filteredReport
  };
}

// Run test impact analysis
export function runTestImpactAnalysis(
  projectPath?: string,
  options: { json?: boolean; changed?: string[]; gitDiff?: boolean; branch?: string } = {}
): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: false,
      message: `Project database not found. Run "codeimpact init ${targetPath}" first to index the project.`
    };
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);
  const testAwareness = new TestAwareness(targetPath, db, tier2);

  // Initialize test awareness (indexes test files)
  testAwareness.initialize();

  // Create analyzer
  const analyzer = new TestImpactAnalyzer(tier2, testAwareness, targetPath);

  // Determine changed files
  let changedFiles: string[] = [];

  if (options.changed && options.changed.length > 0) {
    // Use explicitly provided files
    changedFiles = options.changed;
  } else if (options.branch) {
    // Compare to branch
    changedFiles = analyzer.getChangedFilesFromBranch(options.branch);
  } else if (options.gitDiff) {
    // Use git diff (staged + unstaged)
    changedFiles = analyzer.getChangedFilesFromGit();
  } else {
    // Default: use git diff
    changedFiles = analyzer.getChangedFilesFromGit();
  }

  if (changedFiles.length === 0) {
    db.close();
    return {
      success: true,
      message: 'No changed files detected. Use --changed <file> to specify files, or make changes to your code.',
      data: null
    };
  }

  // Run analysis
  const result = analyzer.analyzeImpact(changedFiles);
  db.close();

  // Format output
  const output = options.json
    ? analyzer.formatReportJSON(result)
    : analyzer.formatReport(result);

  return {
    success: true,
    message: output,
    data: result
  };
}

// Run blast radius analysis
export function runBlastRadiusAnalysis(
  filePath: string,
  projectPath?: string,
  options: { json?: boolean; depth?: number } = {}
): CommandResult {
  if (!filePath) {
    return {
      success: false,
      message: 'Error: File path required. Usage: codeimpact impact <file>'
    };
  }

  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: false,
      message: `Project database not found. Run "codeimpact init ${targetPath}" first to index the project.`
    };
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);

  // Optionally create TestAwareness for coverage info
  let testAwareness: TestAwareness | null = null;
  try {
    testAwareness = new TestAwareness(targetPath, db, tier2);
    testAwareness.initialize();
  } catch {
    // TestAwareness is optional, continue without it
  }

  // Create analyzer and run analysis
  const analyzer = new BlastRadiusAnalyzer(tier2, testAwareness);
  const maxDepth = options.depth ?? 3;
  const result = analyzer.analyze(filePath, maxDepth);
  db.close();

  // Format output
  const output = options.json
    ? analyzer.formatReportJSON(result)
    : analyzer.formatReport(result);

  return {
    success: true,
    message: output,
    data: result
  };
}

// Run usage stats / cost dashboard
export function runUsageStats(
  projectPath?: string,
  options: { json?: boolean; period?: StatsPeriod } = {}
): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: false,
      message: `Project database not found. Run "codeimpact init ${targetPath}" first to index the project.`
    };
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);

  // Get usage stats
  const tracker = new CostTracker(tier2);
  const period = options.period || 'month';
  const stats = tracker.getStats(period);
  db.close();

  // Format output
  const output = options.json
    ? tracker.formatReportJSON(stats)
    : tracker.formatReport(stats);

  return {
    success: true,
    message: output,
    data: stats
  };
}

// Analytics dashboard with cleaner table-based output
export function runAnalytics(
  projectPath?: string,
  options: { json?: boolean; period?: StatsPeriod; export?: string } = {}
): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: false,
      message: `Project database not found. Run "codeimpact init ${targetPath}" first to index the project.`
    };
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);
  const tracker = new CostTracker(tier2);
  const period = options.period || 'week';
  const stats = tracker.getStats(period);
  db.close();

  // JSON output
  if (options.json) {
    const jsonOutput = tracker.formatReportJSON(stats);
    if (options.export) {
      writeFileSync(options.export, jsonOutput, 'utf-8');
      return {
        success: true,
        message: `Analytics exported to ${options.export}`,
        data: stats
      };
    }
    return {
      success: true,
      message: jsonOutput,
      data: stats
    };
  }

  // Table-based output
  const lines: string[] = [];
  const periodLabel = period === 'day' ? 'Today' : period === 'week' ? 'Last 7 Days' : period === 'month' ? 'Last 30 Days' : 'All Time';

  lines.push(`Tool Usage (${periodLabel}):`);
  lines.push('─'.repeat(65));
  lines.push(padRight('Tool', 28) + padRight('Calls', 10) + padRight('Tokens', 15) + 'Cost');
  lines.push('─'.repeat(65));

  for (const qt of stats.byQueryType) {
    const tokens = formatTokensShort(qt.tokensUsed);
    const cost = `$${qt.costDollars.toFixed(2)}`;
    lines.push(padRight(qt.queryType, 28) + padRight(String(qt.queries), 10) + padRight(tokens, 15) + cost);
  }

  lines.push('─'.repeat(65));
  const totalTokens = formatTokensShort(stats.totalTokensUsed);
  const totalCost = `$${stats.totalCostDollars.toFixed(2)}`;
  lines.push(padRight('TOTAL', 28) + padRight(String(stats.totalQueries), 10) + padRight(totalTokens, 15) + totalCost);
  lines.push('');

  // Most used actions breakdown
  if (stats.byQueryType.length > 0) {
    lines.push('Most Used:');
    const sorted = [...stats.byQueryType].sort((a, b) => b.queries - a.queries);
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      const qt = sorted[i];
      const pct = stats.totalQueries > 0 ? Math.round((qt.queries / stats.totalQueries) * 100) : 0;
      lines.push(`  ${i + 1}. ${qt.queryType} (${pct}%)`);
    }
  }

  const output = lines.join('\n');

  if (options.export) {
    const jsonOutput = tracker.formatReportJSON(stats);
    writeFileSync(options.export, jsonOutput, 'utf-8');
    return {
      success: true,
      message: output + `\n\nExported to ${options.export}`,
      data: stats
    };
  }

  return {
    success: true,
    message: output,
    data: stats
  };
}

// Helper: pad string to right
function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// Helper: format tokens with K/M suffix (compact)
function formatTokensShort(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

// Helper: format timestamp as HH:MM:SS
function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Live activity log - streams recent token usage events
export async function runTail(
  projectPath?: string,
  options: { lines?: number } = {}
): Promise<CommandResult> {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: false,
      message: `Project database not found. Run "codeimpact init ${targetPath}" first to index the project.`
    };
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);

  const initialLines = options.lines || 10;
  let lastTimestamp = 0;
  let running = true;

  // Handle Ctrl+C gracefully
  const cleanup = () => {
    running = false;
    db.close();
    console.log('\nStopped.');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log(`Watching CodeImpact activity... (Ctrl+C to stop)\n`);

  // Initial fetch
  const initialEvents = tier2.getRecentUsageEvents(initialLines);

  // Display in chronological order (reverse the DESC order)
  for (const event of initialEvents.reverse()) {
    const time = formatTime(event.timestamp);
    const tokens = formatTokensShort(event.tokensUsed);
    const cost = `$${event.costDollars.toFixed(2)}`;
    console.log(`[${time}] ${padRight(event.queryType, 22)} ${padRight(tokens, 12)} ${cost}`);
    lastTimestamp = Math.max(lastTimestamp, event.timestamp);
  }

  // Poll for new events
  while (running) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!running) break;

    const newEvents = tier2.getRecentUsageEvents(50, lastTimestamp);

    // Display in chronological order
    for (const event of newEvents.reverse()) {
      const time = formatTime(event.timestamp);
      const tokens = formatTokensShort(event.tokensUsed);
      const cost = `$${event.costDollars.toFixed(2)}`;
      console.log(`[${time}] ${padRight(event.queryType, 22)} ${padRight(tokens, 12)} ${cost}`);
      lastTimestamp = Math.max(lastTimestamp, event.timestamp);
    }
  }

  db.close();
  return { success: true, message: 'Stopped.' };
}

// Force reindex - clears database for fresh indexing
export function forceReindex(projectPath?: string): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Find database
  const dbPath = findDatabasePath(projectInfo);
  if (!dbPath) {
    return {
      success: true,
      message: 'No database found - nothing to clear. Run your AI tool to create fresh index.'
    };
  }

  // Open database and clear indexing tables
  const db = initializeDatabase(dbPath);

  try {
    // Clear file-related tables (preserve decisions and usage stats)
    db.exec(`
      DELETE FROM files;
      DELETE FROM embeddings;
      DELETE FROM dependencies;
      DELETE FROM symbols;
      DELETE FROM imports;
      DELETE FROM exports;
      DELETE FROM file_access;
      DELETE FROM file_summaries;
      DELETE FROM test_index;
      DELETE FROM refresh_state;
    `);

    db.close();

    return {
      success: true,
      message: `Index cleared for ${projectInfo.name}.

What was preserved:
  - Architectural decisions
  - Usage statistics

What was cleared:
  - File index
  - Symbol index
  - Dependencies
  - Test mappings

Next step: Restart your AI tool (Claude Desktop, Cursor, etc.) to trigger fresh indexing.`
    };
  } catch (err) {
    db.close();
    return {
      success: false,
      message: `Failed to clear index: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// Show project info
export function showProject(projectId?: string): CommandResult {
  let project: ProjectInfo | null;

  if (projectId) {
    project = projectManager.getProject(projectId);
  } else {
    project = projectManager.getActiveProject();
  }

  if (!project) {
    return {
      success: false,
      message: projectId
        ? `Project not found: ${projectId}`
        : 'No active project. Use "codeimpact projects switch <id>" first.'
    };
  }

  const lines = [
    `Project: ${project.name}`,
    `ID: ${project.id}`,
    `Path: ${project.path}`,
    `Data Directory: ${project.dataDir}`,
    `Files Indexed: ${project.totalFiles}`,
    `Decisions: ${project.totalDecisions}`,
    `Languages: ${project.languages.join(', ') || 'N/A'}`,
    `Last Accessed: ${new Date(project.lastAccessed).toLocaleString()}`
  ];

  return {
    success: true,
    message: lines.join('\n'),
    data: project
  };
}

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
- **Déjà vu detection**: Surfaces similar past problems you've solved
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
${configuredClients.map(c => '  ✓ ' + c).join('\n')}
`;

  if (failedClients.length > 0) {
    message += `\nFailed:\n${failedClients.map(c => '  ✗ ' + c).join('\n')}`;
  }

  message += `\n\nRestart your AI tools to activate.`;

  return {
    success: true,
    message: message.trim(),
    data: { projectInfo, serverName, configuredClients }
  };
}

// Print help
export function printHelp(): void {
  console.log(`
CodeImpact CLI - Code Intelligence for AI Coding Assistants

USAGE:
  codeimpact [command] [options]

COMMANDS:
  init [path]               Initialize project + auto-configure AI tools
  serve [options]           Start HTTP API server (for non-MCP tools)
  (no command)              Start MCP server
  deadcode [options]        Find unused exports and dead code
  test-impact [options]     Find which tests to run for changed files
  impact <file> [options]   Analyze blast radius and risk of changing a file
  stats [options]           Show token usage and costs (verbose)
  analytics [options]       Usage dashboard with table-based output
  tail [options]            Live activity log (streams new events)
  knowledge <action>        Manage autonomous skills/docs workspace
  reindex                   Clear index for fresh re-indexing (after git issues)
  projects list             List all registered projects
  projects add <path>       Add a project to the registry
  projects remove <id>      Remove a project from the registry
  projects switch <id>      Set a project as active
  projects show [id]        Show project details
  projects discover         Discover projects in common locations
  export [options]          Export decisions to ADR files
  help                      Show this help message

OPTIONS:
  --project, -p <path>      Path to the project directory
  --port <number>           Port for HTTP server (default: 3333)
  --output, -o <dir>        Output directory for exports
  --format <type>           ADR format: madr, nygard, simple
  --json                    Output as JSON (for deadcode, test-impact, stats)
  --threshold <percent>     Minimum confidence % to report (for deadcode)
  --changed <file>          Specify changed file(s) (for test-impact)
  --git-diff                Use git diff to detect changes (default)
  --branch <name>           Compare to branch (e.g., main)
  --depth <n>               Max dependency depth to analyze (default: 3)
  --period <type>           Time period: day, week, month, all (for stats/analytics)
  --export, -o <file>       Export analytics to JSON file
  --lines, -n <count>       Number of initial lines to show (for tail, default: 10)

EXAMPLES:
  # Quick setup (auto-configures Claude Desktop)
  cd /path/to/project
  codeimpact init

  # Start MCP server
  codeimpact --project /path/to/project

  # List all projects
  codeimpact projects list

  # Add a new project
  codeimpact projects add /path/to/my-project

  # Switch active project
  codeimpact projects switch abc123

  # Export decisions to ADR files
  codeimpact export --format madr

  # Find dead code (unused exports)
  codeimpact deadcode
  codeimpact deadcode --json --threshold 80

  # Find which tests to run for your changes
  codeimpact test-impact
  codeimpact test-impact --changed src/auth/login.ts
  codeimpact test-impact --branch main --json

  # Analyze blast radius of a file change
  codeimpact impact src/core/engine.ts
  codeimpact impact src/auth/session.ts --depth 5 --json

  # Show token usage and cost savings
  codeimpact stats
  codeimpact stats --period week
  codeimpact stats --period all --json

  # Analytics dashboard (cleaner table output)
  codeimpact analytics
  codeimpact analytics --period week
  codeimpact analytics --export usage.json

  # Live activity log (watch token usage in real-time)
  codeimpact tail
  codeimpact tail --lines 20

  # Discover projects
  codeimpact projects discover

  # Knowledge workspace commands
  codeimpact knowledge status
  codeimpact knowledge generate --reason "manual refresh"
  codeimpact knowledge sync-rules --dry-run
  codeimpact knowledge research --topic fastapi --topic aws

  # Start HTTP API server (for tools without MCP support)
  codeimpact serve --project /path/to/project
  codeimpact serve --port 8080

For more information, visit: https://github.com/abhisavakar/codeimpact
`);
}

// Parse and execute CLI commands
export function executeCLI(args: string[]): void {
  const command = args[0];
  const subcommand = args[1];

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    case 'init': {
      let projectPath: string | undefined;
      let serverUrl: string | undefined;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        if ((arg === '--server' || arg === '-s') && next) {
          serverUrl = next;
          i++;
        } else if (arg && !arg.startsWith('-')) {
          projectPath = arg;
        }
      }
      const result = initProject(projectPath, serverUrl);
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }

    case 'projects': {
      switch (subcommand) {
        case 'list':
          console.log(listProjects().message);
          break;
        case 'add': {
          const path = args[2];
          if (!path) {
            console.error('Error: Project path required.');
            console.error('Usage: codeimpact projects add <path>');
            process.exit(1);
          }
          const result = addProject(path);
          console.log(result.message);
          if (!result.success) process.exit(1);
          break;
        }
        case 'remove': {
          const id = args[2];
          if (!id) {
            console.error('Error: Project ID required.');
            console.error('Usage: codeimpact projects remove <id>');
            process.exit(1);
          }
          const result = removeProject(id);
          console.log(result.message);
          if (!result.success) process.exit(1);
          break;
        }
        case 'switch': {
          const id = args[2];
          if (!id) {
            console.error('Error: Project ID required.');
            console.error('Usage: codeimpact projects switch <id>');
            process.exit(1);
          }
          const result = switchProject(id);
          console.log(result.message);
          if (!result.success) process.exit(1);
          break;
        }
        case 'show': {
          const id = args[2];
          const result = showProject(id);
          console.log(result.message);
          if (!result.success) process.exit(1);
          break;
        }
        case 'discover':
          console.log(discoverProjects().message);
          break;
        default:
          console.error(`Unknown subcommand: ${subcommand}`);
          console.error('Available: list, add, remove, switch, show, discover');
          process.exit(1);
      }
      break;
    }

    case 'knowledge': {
      let projectPath: string | undefined;
      let dryRun = false;
      let reason: string | undefined;
      const topics: string[] = [];

      for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        } else if (arg === '--dry-run') {
          dryRun = true;
        } else if (arg === '--reason' && nextArg) {
          reason = nextArg;
          i++;
        } else if (arg === '--topic' && nextArg) {
          topics.push(nextArg);
          i++;
        }
      }

      let result: CommandResult;
      switch (subcommand) {
        case 'status':
          result = runKnowledgeStatus(projectPath);
          break;
        case 'generate':
          result = runKnowledgeGenerate(projectPath, { reason, dryRun });
          break;
        case 'sync-rules':
          result = runKnowledgeSyncRules(projectPath, dryRun);
          break;
        case 'research':
          result = runKnowledgeResearch(projectPath, {
            topics: topics.length ? topics : undefined,
            dryRun,
          });
          break;
        default:
          console.error(`Unknown knowledge action: ${subcommand}`);
          console.error('Available: status, generate, sync-rules, research');
          process.exit(1);
      }

      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }

    case 'export': {
      // Parse export options
      let outputDir: string | undefined;
      let format: 'madr' | 'nygard' | 'simple' | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if ((arg === '--output' || arg === '-o') && nextArg) {
          outputDir = nextArg;
          i++;
        } else if (arg === '--format' && nextArg) {
          format = nextArg as 'madr' | 'nygard' | 'simple';
          i++;
        }
      }

      const result = exportDecisions(undefined, { outputDir, format });
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }

    case 'deadcode': {
      // Parse deadcode options
      let json = false;
      let threshold: number | undefined;
      let projectPath: string | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if (arg === '--json') {
          json = true;
        } else if (arg === '--threshold' && nextArg) {
          threshold = parseInt(nextArg, 10);
          if (isNaN(threshold) || threshold < 0 || threshold > 100) {
            console.error('Error: Threshold must be a number between 0 and 100.');
            process.exit(1);
          }
          i++;
        } else if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        }
      }

      const result = runDeadCodeAnalysis(projectPath, { json, threshold });
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }

    case 'test-impact': {
      // Parse test-impact options
      let json = false;
      let gitDiff = false;
      let branch: string | undefined;
      let projectPath: string | undefined;
      const changedFiles: string[] = [];

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if (arg === '--json') {
          json = true;
        } else if (arg === '--git-diff') {
          gitDiff = true;
        } else if (arg === '--branch' && nextArg) {
          branch = nextArg;
          i++;
        } else if (arg === '--changed' && nextArg) {
          changedFiles.push(nextArg);
          i++;
        } else if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        }
      }

      const result = runTestImpactAnalysis(projectPath, {
        json,
        changed: changedFiles.length > 0 ? changedFiles : undefined,
        gitDiff,
        branch,
      });
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }

    case 'impact': {
      // Parse impact options
      let json = false;
      let depth = 3;
      let projectPath: string | undefined;
      let targetFile: string | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if (arg === '--json') {
          json = true;
        } else if (arg === '--depth' && nextArg) {
          depth = parseInt(nextArg, 10);
          if (isNaN(depth) || depth < 1 || depth > 10) {
            console.error('Error: Depth must be a number between 1 and 10.');
            process.exit(1);
          }
          i++;
        } else if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        } else if (arg && !arg.startsWith('-') && !targetFile) {
          targetFile = arg;
        }
      }

      if (!targetFile) {
        console.error('Error: File path required.');
        console.error('Usage: codeimpact impact <file> [--depth <n>] [--json]');
        process.exit(1);
      }

      const result = runBlastRadiusAnalysis(targetFile, projectPath, { json, depth });
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }

    case 'stats': {
      // Parse stats options
      let json = false;
      let period: StatsPeriod | undefined;
      let projectPath: string | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if (arg === '--json') {
          json = true;
        } else if (arg === '--period' && nextArg) {
          const validPeriods = ['day', 'week', 'month', 'all'];
          if (!validPeriods.includes(nextArg)) {
            console.error(`Error: Invalid period. Must be one of: ${validPeriods.join(', ')}`);
            process.exit(1);
          }
          period = nextArg as StatsPeriod;
          i++;
        } else if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        }
      }

      const statsResult = runUsageStats(projectPath, { json, period });
      console.log(statsResult.message);
      if (!statsResult.success) process.exit(1);
      break;
    }

    case 'analytics': {
      // Parse analytics options
      let json = false;
      let period: StatsPeriod | undefined;
      let projectPath: string | undefined;
      let exportPath: string | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if (arg === '--json') {
          json = true;
        } else if (arg === '--period' && nextArg) {
          const validPeriods = ['day', 'week', 'month', 'all'];
          if (!validPeriods.includes(nextArg)) {
            console.error(`Error: Invalid period. Must be one of: ${validPeriods.join(', ')}`);
            process.exit(1);
          }
          period = nextArg as StatsPeriod;
          i++;
        } else if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        } else if ((arg === '--export' || arg === '-o') && nextArg) {
          exportPath = nextArg;
          i++;
        }
      }

      const analyticsResult = runAnalytics(projectPath, { json, period, export: exportPath });
      console.log(analyticsResult.message);
      if (!analyticsResult.success) process.exit(1);
      break;
    }

    case 'tail': {
      // Parse tail options
      let projectPath: string | undefined;
      let lines: number | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if ((arg === '--lines' || arg === '-n') && nextArg) {
          lines = parseInt(nextArg, 10);
          if (isNaN(lines) || lines < 1) {
            console.error('Error: Lines must be a positive number.');
            process.exit(1);
          }
          i++;
        } else if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        }
      }

      // runTail is async, need to await it
      runTail(projectPath, { lines }).then(result => {
        if (!result.success) {
          console.error(result.message);
          process.exit(1);
        }
      }).catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
      break;
    }

    case 'reindex': {
      // Parse reindex options
      let projectPath: string | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        }
      }

      const reindexResult = forceReindex(projectPath);
      console.log(reindexResult.message);
      if (!reindexResult.success) process.exit(1);
      break;
    }

    default:
      // If no command matches, it might be the default MCP server mode
      // Return without handling - let main() handle it
      return;
  }

  process.exit(0);
}
