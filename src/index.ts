import { MCPServer } from './server/mcp.js';
import { HTTPServer } from './server/http.js';
import { getDefaultConfig, parseArgs } from './utils/config.js';
import { executeCLI, printHelp } from './cli/commands.js';

function parseServeArgs(args: string[]): { projectPath: string; port: number } {
  let projectPath = process.cwd();
  let port = 3333;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if ((arg === '--project' || arg === '-p') && nextArg) {
      projectPath = nextArg;
      i++;
    } else if (arg === '--port' && nextArg) {
      port = parseInt(nextArg) || 3333;
      i++;
    }
  }

  return { projectPath, port };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Check for CLI commands first
  const firstArg = args[0];
  const cliCommands = ['init', 'projects', 'export', 'deadcode', 'test-impact', 'impact', 'stats', 'analytics', 'tail', 'reindex', 'help', '--help', '-h'];

  if (firstArg && cliCommands.includes(firstArg)) {
    // Handle CLI commands
    executeCLI(args);
    return;
  }

  // Handle serve command - start HTTP API server
  if (firstArg === 'serve') {
    const { projectPath, port } = parseServeArgs(args.slice(1));
    const config = getDefaultConfig(projectPath);

    console.log('CodeImpact HTTP API starting...');
    console.log(`Project: ${config.projectPath}`);
    console.log(`Data directory: ${config.dataDir}`);
    console.log('');

    const server = new HTTPServer(config, port);
    try {
      await server.start();
    } catch (error) {
      console.error('Failed to start HTTP server:', error);
      process.exit(1);
    }
    return;
  }

  // No arguments and not piped - show help
  if (args.length === 0 && process.stdin.isTTY) {
    printHelp();
    console.log('\nTo start as MCP server, use: codeimpact --project <path>');
    console.log('To start HTTP API, use: codeimpact serve --project <path>\n');
    return;
  }

  // Parse command line arguments for MCP server mode
  const { projectPath } = parseArgs(args);

  // Get configuration
  const config = getDefaultConfig(projectPath);

  console.error('CodeImpact starting...');
  console.error(`Project: ${config.projectPath}`);
  console.error(`Data directory: ${config.dataDir}`);

  // Create and start MCP server
  // CRITICAL: Monkey-patch console.log to console.error in MCP mode.
  // Many third-party libraries (like @xenova/transformers) log to stdout by default.
  // Since MCP uses stdout for JSON-RPC communication, ANY stdout log will corrupt
  // the protocol and cause the client (Claude/OpenCode) to disconnect.
  const originalConsoleLog = console.log;
  console.log = function() {
    console.error.apply(console, arguments as any);
  };

  const server = new MCPServer(config);

  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start CodeImpact:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
