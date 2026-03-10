import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CodeImpactEngine } from '../core/engine.js';
import { getDefaultConfig } from '../utils/config.js';
import { allToolDefinitions, handleGatewayCall, isGatewayTool } from './gateways/index.js';
import { handleToolCall } from './tools.js';
import { resourceDefinitions, handleResourceRead } from './resources.js';

interface Session {
  transport: StreamableHTTPServerTransport;
  projectPath: string;
}

export class RemoteMCPServer {
  private engines = new Map<string, CodeImpactEngine>();
  private sessions = new Map<string, Session>();
  private httpServer: ReturnType<typeof createServer>;

  constructor(private port: number) {
    this.httpServer = createServer((req, res) => {
      this.handleRequest(req, res).catch(err => {
        console.error('Request error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      });
    });
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : undefined);
        } catch {
          resolve(undefined);
        }
      });
      req.on('error', reject);
    });
  }

  private getOrCreateEngine(projectPath: string): CodeImpactEngine {
    if (!this.engines.has(projectPath)) {
      const config = getDefaultConfig(projectPath);
      const engine = new CodeImpactEngine(config);
      this.engines.set(projectPath, engine);
      engine.initialize().catch(err =>
        console.error(`Engine init error for ${projectPath}:`, err)
      );
      console.log(`Initialized engine for project: ${projectPath}`);
    }
    return this.engines.get(projectPath)!;
  }

  private setupMCPHandlers(server: Server, engine: CodeImpactEngine): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allToolDefinitions.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = isGatewayTool(name)
          ? await handleGatewayCall(engine, name, args || {})
          : await handleToolCall(engine, name, args || {});
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }) }],
          isError: true,
        };
      }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resourceDefinitions.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const result = await handleResourceRead(engine, uri);
      return { contents: [{ uri, mimeType: result.mimeType, text: result.contents }] };
    });
  }

  private setCORSHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://localhost`);

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        projects: this.engines.size,
        sessions: this.sessions.size,
        projectList: Array.from(this.engines.keys()),
      }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    this.setCORSHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST') {
      if (sessionId && this.sessions.has(sessionId)) {
        // Existing session — route to its transport
        const session = this.sessions.get(sessionId)!;
        const body = await this.readBody(req);
        await session.transport.handleRequest(req, res, body);
      } else {
        // New session — project path required
        const projectPath = url.searchParams.get('project');
        if (!projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?project= parameter. Example: /mcp?project=/path/to/project' }));
          return;
        }

        const engine = this.getOrCreateEngine(projectPath);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const mcpServer = new Server(
          { name: 'codeimpact', version: '0.1.0' },
          { capabilities: { tools: {}, resources: {} } }
        );

        this.setupMCPHandlers(mcpServer, engine);
        await mcpServer.connect(transport);

        transport.onclose = () => {
          if (transport.sessionId) {
            this.sessions.delete(transport.sessionId);
            console.log(`Session closed: ${transport.sessionId}`);
          }
        };

        const body = await this.readBody(req);
        await transport.handleRequest(req, res, body);

        if (transport.sessionId) {
          this.sessions.set(transport.sessionId, { transport, projectPath });
          console.log(`New session: ${transport.sessionId} → ${projectPath}`);
        }
      }
    } else if (req.method === 'GET') {
      if (!sessionId || !this.sessions.has(sessionId)) {
        res.writeHead(400);
        res.end('Bad Request: Missing or invalid mcp-session-id header');
        return;
      }
      await this.sessions.get(sessionId)!.transport.handleRequest(req, res);
    } else if (req.method === 'DELETE') {
      if (sessionId && this.sessions.has(sessionId)) {
        await this.sessions.get(sessionId)!.transport.close();
        this.sessions.delete(sessionId);
        res.writeHead(200);
        res.end('Session terminated');
        console.log(`Session terminated: ${sessionId}`);
      } else {
        res.writeHead(404);
        res.end('Session not found');
      }
    } else {
      res.writeHead(405);
      res.end('Method Not Allowed');
    }
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(this.port, () => resolve());
      this.httpServer.on('error', reject);
    });

    console.log(`\nCodeImpact Remote MCP Server running on port ${this.port}`);
    console.log(`\nMCP endpoint:  http://localhost:${this.port}/mcp?project=/path/to/project`);
    console.log(`Health check:  http://localhost:${this.port}/health`);
    console.log(`\nTo connect clients, run in each project:`);
    console.log(`  codeimpact init --server http://<this-machine-ip>:${this.port}\n`);

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  shutdown(): void {
    console.log('\nShutting down...');
    for (const engine of this.engines.values()) {
      engine.shutdown();
    }
    this.httpServer.close();
    process.exit(0);
  }
}
