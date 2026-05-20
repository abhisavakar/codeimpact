import { DeadCodeDetector } from '../../core/dead-code-detector.js';
import { TestImpactAnalyzer } from '../../core/test-impact-analyzer.js';
import { BlastRadiusAnalyzer } from '../../core/blast-radius.js';
import { CostTracker, type StatsPeriod } from '../../core/cost-tracker.js';
import { TestAwareness } from '../../core/test-awareness/index.js';
import { initializeDatabase } from '../../storage/database.js';
import { Tier2Storage } from '../../storage/tier2.js';
import { writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { CommandResult } from './types.js';
import { projectManager, findDatabasePath } from './shared.js';

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
  lines.push('\u2500'.repeat(65));
  lines.push(padRight('Tool', 28) + padRight('Calls', 10) + padRight('Tokens', 15) + 'Cost');
  lines.push('\u2500'.repeat(65));

  for (const qt of stats.byQueryType) {
    const tokens = formatTokensShort(qt.tokensUsed);
    const cost = `$${qt.costDollars.toFixed(2)}`;
    lines.push(padRight(qt.queryType, 28) + padRight(String(qt.queries), 10) + padRight(tokens, 15) + cost);
  }

  lines.push('\u2500'.repeat(65));
  const totalTokens = formatTokensShort(stats.totalTokensUsed);
  const totalCost = `$${stats.totalCostDollars.toFixed(2)}`;
  lines.push(padRight('TOTAL', 28) + padRight(String(stats.totalQueries), 10) + padRight(totalTokens, 15) + totalCost);
  lines.push('');

  // Most used actions breakdown
  if (stats.byQueryType.length > 0) {
    lines.push('Most Used:');
    const sorted = [...stats.byQueryType].sort((a, b) => b.queries - a.queries);
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      const qt = sorted[i]!;
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
export function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// Helper: format tokens with K/M suffix (compact)
export function formatTokensShort(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

// Helper: format timestamp as HH:MM:SS
export function formatTime(timestamp: number): string {
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

  // Wipe stale generated docs to prevent accumulation from buggy versions
  const knowledgeDocsDir = join(targetPath, 'knowledge', 'docs');
  if (existsSync(knowledgeDocsDir)) {
    try {
      rmSync(knowledgeDocsDir, { recursive: true, force: true });
      console.log('Cleared stale knowledge/docs/');
    } catch {
      // ignore cleanup errors
    }
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
  let project: ReturnType<typeof projectManager.getProject> | null;

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
