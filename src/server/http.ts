/**
 * HTTP API Server for CodeImpact
 *
 * Provides REST endpoints for tools that don't support MCP.
 * Runs alongside or instead of the MCP server.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { CodeImpactEngine } from '../core/engine.js';
import type { CodeImpactConfig } from '../types/index.js';

export class HTTPServer {
  private engine: CodeImpactEngine;
  private server: ReturnType<typeof createServer> | null = null;
  private port: number;

  constructor(config: CodeImpactConfig, port: number = 3333) {
    this.engine = new CodeImpactEngine(config);
    this.port = port;
  }

  async start(): Promise<void> {
    // Initialize the engine first
    await this.engine.initialize();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.port, () => {
      console.log(`CodeImpact HTTP API running at http://localhost:${this.port}`);
      console.log('');
      console.log('Endpoints:');
      console.log('  GET  /status              - Project status and stats');
      console.log('  GET  /search?q=...        - Search code semantically');
      console.log('  GET  /dependencies?file=  - Get file dependencies');
      console.log('  GET  /impact?file=        - Impact analysis');
      console.log('  GET  /circular            - Find circular dependencies');
      console.log('  GET  /decisions           - List all decisions');
      console.log('  POST /decisions           - Record a new decision');
      console.log('  GET  /symbols?file=       - Get symbols in a file');
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.shutdown();
      process.exit(0);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Enable CORS for all origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    const path = url.pathname;

    try {
      let result: unknown;

      switch (path) {
        case '/':
        case '/status': {
          const summary = this.engine.getProjectSummary();
          const status = this.engine.getInitializationStatus();
          result = {
            project: summary.name,
            status: status.status,
            files: summary.totalFiles,
            lines: summary.totalLines,
            languages: summary.languages,
            decisions: summary.recentDecisions.length
          };
          break;
        }

        case '/search': {
          const query = url.searchParams.get('q');
          if (!query) {
            this.sendError(res, 400, 'Missing query parameter: q');
            return;
          }
          const limit = parseInt(url.searchParams.get('limit') || '10');
          const results = await this.engine.search(query, limit);
          result = results.map(r => ({
            file: r.file,
            preview: r.preview,
            similarity: r.similarity,
            lines: `${r.lineStart}-${r.lineEnd}`
          }));
          break;
        }

        case '/dependencies': {
          const file = url.searchParams.get('file');
          if (!file) {
            this.sendError(res, 400, 'Missing query parameter: file');
            return;
          }
          const deps = this.engine.getFileDependencies(file);
          result = deps;
          break;
        }

        case '/impact': {
          const file = url.searchParams.get('file');
          if (!file) {
            this.sendError(res, 400, 'Missing query parameter: file');
            return;
          }
          const depth = parseInt(url.searchParams.get('depth') || '3');
          const dependents = this.engine.getTransitiveDependents(file, depth);
          const circular = this.engine.findCircularDependencies();
          const fileCircular = circular.filter(chain => chain.includes(file));

          result = {
            file,
            direct_dependents: dependents.filter(d => d.depth === 1).length,
            total_affected: dependents.length,
            risk_level: dependents.length > 10 ? 'high' : dependents.length > 5 ? 'medium' : 'low',
            affected_files: dependents.slice(0, 20),
            circular_dependencies: fileCircular
          };
          break;
        }

        case '/circular': {
          const chains = this.engine.findCircularDependencies();
          result = {
            count: chains.length,
            chains: chains.slice(0, 10)
          };
          break;
        }

        case '/decisions': {
          if (req.method === 'POST') {
            const body = await this.readBody(req);
            const data = JSON.parse(body);
            if (!data.title || !data.description) {
              this.sendError(res, 400, 'Missing required fields: title, description');
              return;
            }
            const decision = await this.engine.recordDecision(
              data.title,
              data.description,
              data.files || [],
              data.tags || []
            );
            result = decision;
          } else {
            const decisions = this.engine.getRecentDecisions(50);
            result = decisions.map(d => ({
              id: d.id,
              title: d.title,
              description: d.description,
              files: d.files,
              tags: d.tags,
              created: d.createdAt,
              status: d.status
            }));
          }
          break;
        }

        case '/symbols': {
          const file = url.searchParams.get('file');
          if (!file) {
            this.sendError(res, 400, 'Missing query parameter: file');
            return;
          }
          const symbols = this.engine.getSymbols(file);
          result = symbols;
          break;
        }

        default:
          this.sendError(res, 404, `Unknown endpoint: ${path}`);
          return;
      }

      this.sendJSON(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(res, 500, message);
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  private sendJSON(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  shutdown(): void {
    console.log('Shutting down HTTP server...');
    this.engine.shutdown();
    if (this.server) {
      this.server.close();
    }
  }
}
