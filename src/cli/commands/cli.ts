import type { StatsPeriod } from '../../core/cost-tracker.js';
import type { CommandResult } from './types.js';
import { listProjects, addProject, removeProject, switchProject, discoverProjects } from './projects.js';
import { exportDecisions, runKnowledgeStatus, runKnowledgeGenerate, runKnowledgeSyncRules, runKnowledgeResearch } from './knowledge.js';
import {
  runDeadCodeAnalysis, runTestImpactAnalysis, runBlastRadiusAnalysis,
  runUsageStats, runAnalytics, runTail, forceReindex, showProject
} from './analysis.js';
import { initProject } from './init.js';

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

    case 'agents': {
      // Parse agents options
      let projectPath: string | undefined;
      let force = false;
      let pr = false;
      let push = false;
      let techName: string | undefined;

      for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        if ((arg === '--project' || arg === '-p') && nextArg) {
          projectPath = nextArg;
          i++;
        } else if (arg === '--force') {
          force = true;
        } else if (arg === '--pr') {
          pr = true;
        } else if (arg === '--push') {
          push = true;
        } else if (arg === '--tech' && nextArg) {
          techName = nextArg;
          i++;
        }
      }

      const agentProjectPath = projectPath || process.cwd();

      switch (subcommand) {
        case 'init': {
          const { agentsInit } = require('../../core/agents/index.js');
          const initResult = agentsInit(agentProjectPath);
          console.log(initResult.message);
          break;
        }
        case 'generate': {
          const { agentsGenerate } = require('../../core/agents/index.js');
          const genPromise = agentsGenerate({ projectPath: agentProjectPath, force, pr, push });
          genPromise.then((genResult: { message: string; success: boolean }) => {
            console.log(genResult.message);
            if (!genResult.success) process.exit(1);
            process.exit(0);
          }).catch((err: Error) => {
            console.error('Error:', err.message);
            process.exit(1);
          });
          // Keep process alive until promise resolves
          return;
        }
        case 'research': {
          const { detectTechnologies, researchAllTechnologies } = require('../../core/agents/index.js');
          const { readAgentConfig } = require('../../core/agents/workspace.js');
          const config = readAgentConfig(agentProjectPath);
          let techs = detectTechnologies(agentProjectPath);
          if (techName) {
            techs = techs.filter((t: { name: string }) => t.name === techName);
          }
          researchAllTechnologies(agentProjectPath, techs.slice(0, 20), {
            maxTokensPerTech: config.research_max_tokens_per_tech,
            cadenceHours: config.research_cadence_hours,
            force,
          }).then((results: Array<{ technology: string; status: string }>) => {
            console.log(`Research complete: ${results.length} technologies processed`);
            for (const r of results) {
              console.log(`  ${r.technology}: ${r.status}`);
            }
            process.exit(0);
          }).catch((err: Error) => {
            console.error('Error:', err.message);
            process.exit(1);
          });
          // Keep process alive until promise resolves
          return;
        }
        case 'status': {
          const { agentsStatus } = require('../../core/agents/index.js');
          const status = agentsStatus(agentProjectPath);
          if (!status.initialized) {
            console.log('Agent system not initialized. Run: codeimpact agents init');
          } else {
            console.log('Agent System Status:');
            console.log(`  Technologies: ${status.technologies}`);
            console.log(`  Features: ${status.features}`);
            console.log(`  Research files: ${status.researchFiles} (${status.staleResearch} stale)`);
            console.log(`  Outcomes: ${status.outcomes.total} total (${status.outcomes.successes} success, ${status.outcomes.failures} failures)`);
            console.log(`  Monorepo: ${status.monorepo || 'no'}`);
            console.log(`  Uncommitted changes: ${status.hasChanges ? 'yes' : 'no'}`);
          }
          break;
        }
        case 'migrate': {
          // Migrate from knowledge/ to .code-impact/
          const { agentsInit, agentsGenerate } = require('../../core/agents/index.js');
          agentsInit(agentProjectPath);
          console.log('Migrating from knowledge/ to .code-impact/...');
          agentsGenerate({ projectPath: agentProjectPath, force: true }).then((genResult: { message: string }) => {
            console.log('Migration complete. ' + genResult.message);
            console.log('Note: knowledge/ directory is preserved (both systems can coexist).');
          }).catch((err: Error) => {
            console.error('Error:', err.message);
            process.exit(1);
          });
          break;
        }
        default:
          console.error(`Unknown agents subcommand: ${subcommand}`);
          console.error('Available: init, generate, research, status, migrate');
          process.exit(1);
      }
      break;
    }

    default:
      // If no command matches, it might be the default MCP server mode
      // Return without handling - let main() handle it
      return;
  }

  process.exit(0);
}
