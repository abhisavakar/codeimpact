import { writeFileSync } from 'fs';
import { join } from 'path';
import { ensureKnowledgeWorkspace } from './workspace.js';

export interface ProviderResearchEntry {
  provider: string;
  topic: string;
  fetchedAt: string;
  freshnessHours: number;
  sourceUrl: string;
  summary: string;
  retrievalMode: 'static' | 'api-configured' | 'api-fetched';
  version?: string;
  importPatterns?: string[];
}

export interface ProviderResearchOptions {
  topics?: string[];
  dryRun?: boolean;
}

interface ProviderInfo {
  provider: string;
  url: string;
  summary: string;
  pitfalls?: string[];
}

const PROVIDER_REGISTRY: Record<string, ProviderInfo> = {
  fastapi: {
    provider: 'FastAPI',
    url: 'https://fastapi.tiangolo.com/',
    summary: 'Prefer dependency injection, pydantic validation, and explicit response models. Use async endpoints for I/O-bound work.',
    pitfalls: ['Blocking calls in async endpoints', 'Missing response_model on endpoints', 'Forgetting to validate path parameters'],
  },
  aws: {
    provider: 'AWS',
    url: 'https://docs.aws.amazon.com/',
    summary: 'Use least privilege IAM, regional settings, retries with jitter, and observability defaults.',
    pitfalls: ['Hardcoded credentials', 'Missing retry configuration', 'Using root account keys'],
  },
  jwt: {
    provider: 'JWT / jsonwebtoken',
    url: 'https://datatracker.ietf.org/doc/html/rfc7519',
    summary: 'Validate signature, issuer, audience, and expiration. Use RS256 for production. Implement secure key rotation.',
    pitfalls: ['Using HS256 without verifying key length', 'Not checking token expiration', 'Storing tokens in localStorage'],
  },
  express: {
    provider: 'Express.js',
    url: 'https://expressjs.com/',
    summary: 'Use middleware composition, proper error handling with next(), and helmet for security headers.',
    pitfalls: ['Missing error handling middleware', 'Not using helmet/cors', 'Synchronous error throwing in async handlers'],
  },
  react: {
    provider: 'React',
    url: 'https://react.dev/',
    summary: 'Use functional components, hooks for state/effects, suspense for data fetching, and memo for expensive renders.',
    pitfalls: ['Missing dependency arrays in useEffect', 'Prop drilling without context', 'Unnecessary re-renders from object literals'],
  },
  prisma: {
    provider: 'Prisma',
    url: 'https://www.prisma.io/docs/',
    summary: 'Use prisma client for type-safe queries, migrations for schema changes, and connection pooling for serverless.',
    pitfalls: ['N+1 queries without include/select', 'Missing indexes on filtered columns', 'Not using transactions for multi-step operations'],
  },
  stripe: {
    provider: 'Stripe',
    url: 'https://stripe.com/docs/',
    summary: 'Use webhooks for payment confirmation, idempotency keys for retries, and test mode for development.',
    pitfalls: ['Not verifying webhook signatures', 'Missing idempotency keys', 'Hardcoded API keys'],
  },
  graphql: {
    provider: 'GraphQL',
    url: 'https://graphql.org/learn/',
    summary: 'Define clear schema with input validation, use DataLoader for N+1 prevention, and implement depth limiting.',
    pitfalls: ['Unbounded query depth', 'Missing input validation', 'N+1 queries without batching'],
  },
  nextjs: {
    provider: 'Next.js',
    url: 'https://nextjs.org/docs',
    summary: 'Use App Router, server components by default, and route handlers for API. Leverage ISR for dynamic content.',
    pitfalls: ['Using client components unnecessarily', 'Not leveraging server actions', 'Missing metadata exports'],
  },
  database: {
    provider: 'Database (General)',
    url: 'https://use-the-index-luke.com/',
    summary: 'Index frequently queried columns, use parameterized queries, implement connection pooling, and design for migrations.',
    pitfalls: ['SQL injection via string concatenation', 'Missing indexes on foreign keys', 'Not using transactions'],
  },
  sqlite: {
    provider: 'SQLite / better-sqlite3',
    url: 'https://www.sqlite.org/docs.html',
    summary: 'Use WAL mode for concurrent reads, prepare statements for repeated queries, and PRAGMA journal_mode for durability.',
    pitfalls: ['Not using WAL mode', 'Missing busy_timeout', 'Writing from multiple processes'],
  },
  mcp: {
    provider: 'Model Context Protocol',
    url: 'https://modelcontextprotocol.io/',
    summary: 'Implement tools with clear schemas, handle errors gracefully, and keep tool descriptions concise to save tokens.',
    pitfalls: ['Overly verbose tool descriptions', 'Missing error handling in tool implementations', 'Not validating input schemas'],
  },
  typescript: {
    provider: 'TypeScript',
    url: 'https://www.typescriptlang.org/docs/',
    summary: 'Use strict mode, prefer interfaces over types for objects, leverage discriminated unions, and avoid any.',
    pitfalls: ['Using any instead of unknown', 'Missing strict null checks', 'Type assertions without validation'],
  },
  general: {
    provider: 'General Best Practices',
    url: 'https://12factor.net/',
    summary: 'Follow 12-factor principles. Externalize config, handle errors gracefully, log structured data, and test critical paths.',
    pitfalls: ['Hardcoded configuration', 'Swallowing errors silently', 'Missing input validation'],
  },
};

export class ProviderResearch {
  constructor(private readonly projectPath: string) {}

  refresh(options?: ProviderResearchOptions): ProviderResearchEntry[] {
    const topics = options?.topics?.length ? options.topics : ['general'];
    const fetchedAt = new Date().toISOString();
    const hasApiConfig = Boolean(process.env.CODEIMPACT_RESEARCH_API && process.env.CODEIMPACT_RESEARCH_TOKEN);

    const entries: ProviderResearchEntry[] = [];

    for (const topic of topics) {
      const lookup = PROVIDER_REGISTRY[topic.toLowerCase()] || {
        provider: topic,
        url: 'https://example.com',
        summary: `Document latest operational guidance for ${topic}.`,
      };

      const pitfalls = (lookup as ProviderInfo).pitfalls || [];

      let summary = lookup.summary;
      let retrievalMode: ProviderResearchEntry['retrievalMode'] = 'static';

      if (pitfalls.length > 0) {
        summary += '\n\nCommon pitfalls:\n' + pitfalls.map((p) => `- ${p}`).join('\n');
      }

      if (hasApiConfig) {
        summary += '\n\n(API-backed research configured via CODEIMPACT_RESEARCH_API/TOKEN — live fetch available.)';
        retrievalMode = 'api-configured';
      }

      entries.push({
        provider: lookup.provider,
        topic,
        fetchedAt,
        freshnessHours: 24,
        sourceUrl: lookup.url,
        summary,
        retrievalMode,
      });
    }

    if (!options?.dryRun) {
      const paths = ensureKnowledgeWorkspace(this.projectPath);
      for (const entry of entries) {
        const fileName = `${entry.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
        const filePath = join(paths.integrationDocsRoot, fileName);
        const content = `# ${entry.provider} - ${entry.topic}

Source: ${entry.sourceUrl}
FetchedAt: ${entry.fetchedAt}
FreshnessHours: ${entry.freshnessHours}
RetrievalMode: ${entry.retrievalMode}

## Guidance
${entry.summary}
`;
        writeFileSync(filePath, content);
      }
    }

    return entries;
  }
}
