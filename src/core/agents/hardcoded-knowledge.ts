/**
 * Hardcoded Knowledge — pure data constants extracted from generator.ts,
 * orchestrator.ts, and research-engine.ts.
 *
 * These serve as Tier 2 (boost layer) in the universal inference system.
 * They are NEVER required — the system works without them via structural
 * inference (Tier 3) and sensible defaults (Tier 4).
 */

import type { DocSource } from './types.js';

// ============================================================================
// Technology Knowledge (from generator.ts)
// ============================================================================

export interface TechKnowledge {
  rules: string[];
  pitfalls: string[];
}

export const TECH_KNOWLEDGE: Record<string, TechKnowledge> = {
  'express': {
    rules: [
      'Use Router() for modular route definitions',
      'Always register error handler middleware last (4 args: err, req, res, next)',
    ],
    pitfalls: [
      'Forgetting to call next() in middleware causes request to hang',
      'Async errors in handlers need explicit try/catch or express-async-errors',
    ],
  },
  'hono': {
    rules: [
      'Use app.route() for modular route grouping',
      'Return c.json() or c.text() — do not use res.send()',
    ],
    pitfalls: [
      'Hono middleware must call next() or return a Response — skipping both hangs the request',
    ],
  },
  'better-sqlite3': {
    rules: [
      'Use db.prepare().all() for SELECT, db.prepare().run() for INSERT/UPDATE/DELETE',
      'better-sqlite3 is synchronous — do NOT use async/await with db calls',
      'All database access should go through a single module',
    ],
    pitfalls: [
      'db.exec() returns nothing — using it for SELECT gives undefined',
      'WAL mode must be set once after opening: db.pragma("journal_mode = WAL")',
    ],
  },
  'stripe': {
    rules: [
      'Always verify webhook signatures before processing events',
      'Use idempotency keys for payment creation to prevent double-charges',
    ],
    pitfalls: [
      'Stripe webhook events may arrive out of order — handle idempotently',
      'stripe.webhooks.constructEvent() throws on invalid signature — wrap in try/catch',
    ],
  },
  'jsonwebtoken': {
    rules: [
      'Always use jwt.verify() — never trust jwt.decode() alone',
      'Set explicit expiration (expiresIn) on all tokens',
    ],
    pitfalls: [
      'Using jwt.decode() without verify() is a security vulnerability',
      'The "none" algorithm attack — always specify algorithms: ["HS256"]',
    ],
  },
  '@modelcontextprotocol/sdk': {
    rules: [
      'Use server.tool() to register MCP tools with zod schema validation',
      'All tool handlers must return { content: [...] } response objects',
    ],
    pitfalls: [
      'Tool names must be unique across the server — duplicates silently overwrite',
      'Forgetting to call server.connect(transport) means no requests are handled',
    ],
  },
  'prisma': {
    rules: [
      'Run npx prisma generate after schema changes',
      'Use transactions for multi-table operations: prisma.$transaction()',
    ],
    pitfalls: [
      'Forgetting prisma generate after schema change causes type mismatches at runtime',
      'N+1 queries — use include/select to eagerly load relations',
    ],
  },
  'zod': {
    rules: [
      'Define schemas once, derive TypeScript types with z.infer<typeof schema>',
      'Use .safeParse() in handlers for graceful error handling',
    ],
    pitfalls: [
      '.parse() throws on invalid data — use .safeParse() in request handlers',
    ],
  },
  'vitest': {
    rules: [
      'Use describe/it/expect patterns for test organization',
      'Use vi.mock() for module mocking, vi.fn() for function stubs',
    ],
    pitfalls: [
      'vi.mock() is hoisted to top of file — cannot access variables from outer scope',
    ],
  },
  'web-tree-sitter': {
    rules: [
      'Initialize Parser with await Parser.init() before use',
      'Load language WASM files with Parser.Language.load()',
    ],
    pitfalls: [
      'Parser.init() must complete before any parsing — race condition if not awaited',
      'WASM files must be bundled/copied to dist — not resolved from node_modules at runtime',
    ],
  },
  '@xenova/transformers': {
    rules: [
      'Use pipeline() for high-level tasks, AutoModel for custom inference',
      'Cache downloaded models by setting env.cacheDir',
    ],
    pitfalls: [
      'First model load downloads weights (~100MB+) — cache for subsequent runs',
      'ONNX runtime may fail on some architectures — test on target platform',
    ],
  },
  'chokidar': {
    rules: [
      'Use chokidar.watch() with ignored patterns to skip node_modules',
      'Handle both "add" and "change" events for file watching',
    ],
    pitfalls: [
      'Not closing watcher on process exit leaks file handles',
      'Rapid file changes may fire multiple events — debounce handlers',
    ],
  },
  'react': {
    rules: [
      'Components must be pure — same props must produce same output',
      'Use useState for local UI state, useReducer for complex state logic',
      'Memoize expensive computations with useMemo, callbacks with useCallback',
    ],
    pitfalls: [
      'Missing key prop in lists causes React reconciliation bugs — always use stable keys',
      'useEffect with missing deps causes stale closures — lint rules catch most cases',
      'Setting state during render causes infinite re-render loop',
    ],
  },
  'react-router-dom': {
    rules: [
      'Use <Link> for navigation — never use <a href> for internal routes',
      'Use useNavigate() for programmatic navigation in event handlers',
    ],
    pitfalls: [
      'Routes must be nested under a <Router> provider — missing it causes runtime crash',
      'useSearchParams() returns URLSearchParams — .get() returns null not undefined',
    ],
  },
  'react-hook-form': {
    rules: [
      'Use register() for uncontrolled inputs, Controller for controlled (MUI, Radix)',
      'Define validation with zod resolver — avoid inline validate functions',
    ],
    pitfalls: [
      'Forgetting to call handleSubmit() wrapper — form submits without validation',
      'watch() causes re-render on every change — use getValues() for one-time reads',
    ],
  },
  'tailwindcss': {
    rules: [
      'Use Tailwind utility classes — avoid custom CSS unless absolutely necessary',
      'Use cn() or clsx() for conditional class merging',
    ],
    pitfalls: [
      'Dynamic class names like `bg-${color}-500` are purged — use full class names',
      'Order matters for conflicting utilities — last class wins',
    ],
  },
  'vite': {
    rules: [
      'Use import.meta.env for env variables — must be prefixed with VITE_',
      'Configure aliases in vite.config.ts resolve.alias',
    ],
    pitfalls: [
      'process.env is not available in Vite — use import.meta.env instead',
      'Environment variables without VITE_ prefix are not exposed to client code',
    ],
  },
  'next': {
    rules: [
      'Use server components by default — add "use client" only when needed',
      'Data fetching in server components — no useEffect for initial data',
    ],
    pitfalls: [
      'Importing client-only code (useState, useEffect) in server components crashes build',
      'next/image requires explicit width/height or fill prop — missing causes error',
    ],
  },
  'framer-motion': {
    rules: [
      'Use motion.div (not regular div) for animated elements',
      'Define variants objects for reusable animation states',
    ],
    pitfalls: [
      'AnimatePresence requires direct children to have unique key props',
      'Exit animations only work when component is direct child of AnimatePresence',
    ],
  },
  'd3': {
    rules: [
      'Use D3 for data transforms/scales, React for DOM rendering — avoid d3.select in React',
      'Use useRef to get DOM reference for D3 direct DOM manipulation when needed',
    ],
    pitfalls: [
      'Mixing D3 DOM manipulation with React causes conflicts — pick one rendering strategy',
      'D3 scales are mutable — creating them in render without useMemo causes bugs',
    ],
  },
  'zustand': {
    rules: [
      'Create stores with create() — use selectors to prevent unnecessary re-renders',
      'Keep store state serializable — no functions or class instances in state',
    ],
    pitfalls: [
      'Not using selectors subscribes to entire store — causes excess re-renders',
      'Mutating state directly (state.x = y) does not trigger re-render — use set()',
    ],
  },
  '@tanstack/react-query': {
    rules: [
      'Use useQuery for GET, useMutation for POST/PUT/DELETE',
      'Set staleTime to avoid unnecessary refetches — default 0 refetches every mount',
    ],
    pitfalls: [
      'Forgetting queryClient.invalidateQueries after mutation shows stale data',
      'Query keys must be serializable arrays — objects in keys cause cache misses',
    ],
  },
};

// ============================================================================
// Feature Name Rules & Pitfalls (from generator.ts)
// ============================================================================

export const FEATURE_NAME_RULES: Record<string, string[]> = {
  server: [
    'All tool/resource handlers must validate inputs before processing',
    'Return structured error responses — never throw raw errors to clients',
  ],
  storage: [
    'All database access should go through this module — no direct imports elsewhere',
    'Use transactions for multi-step operations to ensure consistency',
  ],
  indexing: [
    'Index operations should be idempotent — reindexing same file produces same result',
    'Handle parse errors gracefully — a broken file should not crash the indexer',
  ],
  core: [
    'Core modules should have no side effects on import',
    'Export types alongside functions for downstream consumers',
  ],
  test: [
    'Tests should be deterministic — no reliance on external services or timing',
    'Clean up temporary files and directories in afterEach/afterAll hooks',
  ],
  knowledge: [
    'Skill files must follow the agentskills.io SKILL.md format',
    'Generated content must use marker comments to preserve manual edits',
  ],
  doc: [
    'Generated docs must be kept in sync with source code changes',
    'Use relative paths for internal links',
  ],
  auth: [
    'Never store plain-text passwords — use bcrypt or argon2',
    'Validate and sanitize all user inputs before processing',
  ],
  api: [
    'All endpoints must validate request bodies/params before processing',
    'Return consistent error response shapes across all endpoints',
  ],
  components: [
    'Components should be pure — derive UI from props, avoid internal side effects',
    'Use composition over inheritance — prefer small, focused components',
    'Co-locate styles, types, and tests with the component file',
  ],
  pages: [
    'Pages handle routing and data fetching — delegate UI to components',
    'Keep page components thin — extract business logic to hooks or services',
  ],
  hooks: [
    'Custom hooks must start with "use" prefix',
    'Keep hooks focused on one concern — avoid monolithic hooks',
    'Hooks should be reusable — avoid coupling to specific component internals',
  ],
  layouts: [
    'Layouts define page structure — children should not assume layout behavior',
    'Keep layouts thin — avoid business logic in layout wrappers',
  ],
  views: [
    'Views handle routing and data fetching — delegate UI to components',
    'Keep view components thin — extract business logic to hooks or services',
  ],
  services: [
    'Services handle API communication — keep HTTP details out of components',
    'Return typed responses — avoid returning raw API responses',
  ],
  stores: [
    'Keep store state minimal — derive computed values instead of storing them',
    'Actions should be thin — delegate complex logic to services',
  ],
  store: [
    'Keep store state minimal — derive computed values instead of storing them',
    'Actions should be thin — delegate complex logic to services',
  ],
  contexts: [
    'Context should hold only values that many components need — avoid overuse',
    'Split large contexts into focused providers to prevent unnecessary re-renders',
  ],
  providers: [
    'Provider order matters — auth before data fetching, theme before UI',
    'Keep providers thin — initialize services, do not embed business logic',
  ],
  routes: [
    'Route definitions should be declarative — avoid complex inline logic',
    'Use lazy loading for route components to optimize bundle size',
  ],
};

export const FEATURE_NAME_PITFALLS: Record<string, string[]> = {
  server: [
    'Unhandled promise rejections in handlers crash the process — always catch async errors',
    'Adding middleware order matters — auth before route handlers',
  ],
  storage: [
    'Forgetting to close database connections leaks file handles',
    'Concurrent writes without transactions may cause data corruption',
  ],
  indexing: [
    'Large files can cause out-of-memory — set size limits on parsed content',
    'File paths must be normalized (forward slashes) for cross-platform compatibility',
  ],
  core: [
    'Circular imports between core modules cause runtime errors — check dependency direction',
    'Changing public API signatures breaks downstream consumers',
  ],
  test: [
    'Tests sharing mutable state between runs cause flaky failures',
    'Temp directories not cleaned up fill disk over repeated test runs',
  ],
  components: [
    'Missing key prop in lists causes React reconciliation bugs — always use stable keys',
    'Direct DOM manipulation bypasses React — use refs only when necessary',
    'Prop drilling through 3+ levels signals need for context or composition',
  ],
  pages: [
    'Data fetching in render causes waterfall requests — use loaders or top-level hooks',
    'Missing error boundaries let one page crash the whole app',
  ],
  hooks: [
    'Missing deps in useEffect cause stale closures — React will warn but won\'t auto-fix',
    'Hooks called conditionally break React — hooks must be called in same order every render',
  ],
  services: [
    'Not handling API errors shows raw errors to users — always catch and transform',
    'Caching stale data causes UI inconsistency — invalidate cache on mutations',
  ],
  stores: [
    'Mutating state directly causes silent bugs — always return new references',
    'Large store updates trigger unnecessary re-renders — split into focused slices',
  ],
  store: [
    'Mutating state directly causes silent bugs — always return new references',
    'Large store updates trigger unnecessary re-renders — split into focused slices',
  ],
};

export const WELL_KNOWN_FEATURES = new Set([
  'server', 'storage', 'indexing', 'core', 'test', 'knowledge', 'doc',
  'auth', 'api', 'billing', 'cli',
  'components', 'pages', 'hooks', 'layouts', 'views', 'services',
  'stores', 'store', 'contexts', 'providers', 'routes',
]);

// ============================================================================
// Directory Purpose Map (from generator.ts + orchestrator.ts)
// ============================================================================

export const DIR_PURPOSE_MAP: Record<string, string> = {
  // Backend
  core: 'Core business logic and domain modules',
  server: 'Server, transports, and request handling',
  storage: 'Database access and persistence',
  indexing: 'Code indexing and symbol extraction',
  api: 'API routes and handlers',
  auth: 'Authentication and authorization',
  billing: 'Payment processing',
  test: 'Tests and evaluation harness',
  tests: 'Tests and evaluation harness',
  doc: 'Documentation',
  knowledge: 'AI knowledge system',
  cli: 'Command-line interface',
  base: 'Base configuration and fixtures',
  src: 'Application source code',
  lib: 'Shared utilities',
  // Frontend / React
  components: 'Reusable UI components',
  pages: 'Page-level route components',
  hooks: 'Custom React hooks',
  layouts: 'Page layout wrappers',
  views: 'View components (page-level)',
  features: 'Feature modules (co-located logic + UI)',
  services: 'API client and service layer',
  stores: 'State management (stores/slices)',
  store: 'State management (stores/slices)',
  utils: 'Utility functions and helpers',
  contexts: 'React context providers',
  providers: 'App-level providers and wrappers',
  routes: 'Route definitions and navigation',
  assets: 'Static assets (images, fonts, icons)',
  styles: 'Global styles and theme configuration',
  types: 'TypeScript type definitions',
  config: 'App configuration',
  middleware: 'Request/response middleware',
  models: 'Data models and schemas',
  controllers: 'Request handlers (MVC)',
  resolvers: 'GraphQL resolvers',
  schemas: 'Data schemas and validation',
  migrations: 'Database migrations',
  // Go
  cmd: 'CLI entry points and commands',
  pkg: 'Reusable library packages',
  internal: 'Private packages (unexported)',
  // Rust
  bin: 'Binary entry points',
  benches: 'Benchmarks',
  // Python
  templates: 'Template files (HTML, Jinja2)',
  static: 'Static files for web serving',
  management: 'Management commands (Django)',
  // General
  scripts: 'Build/deploy/automation scripts',
  tools: 'Developer tools and utilities',
  docs: 'Documentation',
  examples: 'Example code and demos',
  fixtures: 'Test fixtures and sample data',
  mocks: 'Mock objects for testing',
  helpers: 'Helper functions and utilities',
  adapters: 'External service adapters',
  ports: 'Port interfaces (hexagonal architecture)',
  domain: 'Domain logic (DDD)',
  entities: 'Domain entities',
  repositories: 'Data access repositories',
  handlers: 'Request/event handlers',
  events: 'Event definitions and dispatchers',
  jobs: 'Background jobs and workers',
  workers: 'Background workers',
  queues: 'Job queue definitions',
  cron: 'Scheduled task definitions',
};

// ============================================================================
// Scope Labels (from generator.ts)
// ============================================================================

export const SCOPE_LABELS: Record<string, string> = {
  '@radix-ui': 'Radix UI (shadcn/ui primitives)',
  '@tanstack': 'TanStack (query/router/table)',
  '@trpc': 'tRPC',
  '@nestjs': 'NestJS',
  '@prisma': 'Prisma',
  '@aws-sdk': 'AWS SDK',
  '@google-cloud': 'Google Cloud SDK',
  '@azure': 'Azure SDK',
  '@mui': 'Material UI',
  '@chakra-ui': 'Chakra UI',
  '@headlessui': 'Headless UI',
  '@mantine': 'Mantine',
  '@emotion': 'Emotion CSS',
  '@testing-library': 'Testing Library',
  '@storybook': 'Storybook',
  '@sentry': 'Sentry',
  '@opentelemetry': 'OpenTelemetry',
  '@supabase': 'Supabase',
  '@firebase': 'Firebase',
  '@stripe': 'Stripe SDK',
};

// ============================================================================
// Doc Source Registry (from research-engine.ts)
// ============================================================================

export const DOC_SOURCE_REGISTRY: DocSource[] = [
  {
    packageNames: ['express'],
    docsUrl: 'https://expressjs.com/en/api.html',
    apiRefUrl: 'https://expressjs.com/en/4x/api.html',
    changelogUrl: 'https://github.com/expressjs/express/blob/master/History.md',
  },
  {
    packageNames: ['react', 'react-dom'],
    docsUrl: 'https://react.dev/reference/react',
    apiRefUrl: 'https://react.dev/reference/react',
    changelogUrl: 'https://github.com/facebook/react/blob/main/CHANGELOG.md',
  },
  {
    packageNames: ['next'],
    docsUrl: 'https://nextjs.org/docs',
    apiRefUrl: 'https://nextjs.org/docs/api-reference',
    changelogUrl: 'https://github.com/vercel/next.js/releases',
  },
  {
    packageNames: ['typescript'],
    docsUrl: 'https://www.typescriptlang.org/docs/',
    changelogUrl: 'https://www.typescriptlang.org/docs/handbook/release-notes/overview.html',
  },
  {
    packageNames: ['vitest'],
    docsUrl: 'https://vitest.dev/api/',
    apiRefUrl: 'https://vitest.dev/api/',
    changelogUrl: 'https://github.com/vitest-dev/vitest/releases',
  },
  {
    packageNames: ['jest'],
    docsUrl: 'https://jestjs.io/docs/api',
    apiRefUrl: 'https://jestjs.io/docs/expect',
  },
  {
    packageNames: ['prisma', '@prisma/client'],
    docsUrl: 'https://www.prisma.io/docs',
    apiRefUrl: 'https://www.prisma.io/docs/reference/api-reference',
    changelogUrl: 'https://github.com/prisma/prisma/releases',
  },
  {
    packageNames: ['stripe'],
    docsUrl: 'https://docs.stripe.com/api',
    changelogUrl: 'https://docs.stripe.com/changelog',
  },
  {
    packageNames: ['@modelcontextprotocol/sdk'],
    docsUrl: 'https://modelcontextprotocol.io/docs',
    apiRefUrl: 'https://github.com/modelcontextprotocol/typescript-sdk',
  },
  {
    packageNames: ['better-sqlite3'],
    docsUrl: 'https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md',
    apiRefUrl: 'https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md',
  },
  {
    packageNames: ['zod'],
    docsUrl: 'https://zod.dev/',
    apiRefUrl: 'https://zod.dev/',
  },
  {
    packageNames: ['tailwindcss'],
    docsUrl: 'https://tailwindcss.com/docs',
  },
  {
    packageNames: ['vite'],
    docsUrl: 'https://vitejs.dev/guide/',
    apiRefUrl: 'https://vitejs.dev/config/',
  },
  {
    packageNames: ['passport'],
    docsUrl: 'https://www.passportjs.org/docs/',
  },
  {
    packageNames: ['jsonwebtoken'],
    docsUrl: 'https://github.com/auth0/node-jsonwebtoken#readme',
  },
  {
    packageNames: ['axios'],
    docsUrl: 'https://axios-http.com/docs/intro',
    apiRefUrl: 'https://axios-http.com/docs/api_intro',
  },
  {
    packageNames: ['fastify'],
    docsUrl: 'https://fastify.dev/docs/latest/',
    apiRefUrl: 'https://fastify.dev/docs/latest/Reference/',
  },
  {
    packageNames: ['drizzle-orm'],
    docsUrl: 'https://orm.drizzle.team/docs/overview',
  },
  {
    packageNames: ['trpc', '@trpc/server', '@trpc/client'],
    docsUrl: 'https://trpc.io/docs',
  },
  {
    packageNames: ['hono'],
    docsUrl: 'https://hono.dev/docs/',
    apiRefUrl: 'https://hono.dev/docs/api/hono',
  },
];
