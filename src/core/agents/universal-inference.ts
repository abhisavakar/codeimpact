/**
 * Universal Inference Engine — replaces hardcoded maps with a 4-tier fallback system.
 *
 * Tier 1: Research-extracted (parse .code-impact/research/*.md files)
 * Tier 2: Hardcoded knowledge (existing maps — optional boost, never required)
 * Tier 3: Structural inference (deterministic heuristics from code signals)
 * Tier 4: Sensible defaults (always produces something useful)
 *
 * Every function works for ANY language/framework. Hardcoded knowledge
 * is an optional boost layer that improves output for known technologies.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { DetectedTechnology, DetectedFeature, DocSource } from './types.js';
import {
  TECH_KNOWLEDGE,
  FEATURE_NAME_RULES,
  FEATURE_NAME_PITFALLS,
  WELL_KNOWN_FEATURES,
  DIR_PURPOSE_MAP,
  SCOPE_LABELS,
  DOC_SOURCE_REGISTRY,
} from './hardcoded-knowledge.js';

// ============================================================================
// A. inferTechRulesAndPitfalls
// ============================================================================

export interface TechRulesAndPitfalls {
  rules: string[];
  pitfalls: string[];
}

/**
 * Infer rules and pitfalls for a technology using the 4-tier system.
 * Works for ANY technology — not just the 25 hardcoded entries.
 */
export function inferTechRulesAndPitfalls(
  tech: DetectedTechnology,
  researchDir?: string,
): TechRulesAndPitfalls {
  const result: TechRulesAndPitfalls = { rules: [], pitfalls: [] };

  // Tier 1: Research-extracted
  if (researchDir) {
    const research = extractRulesFromResearch(tech, researchDir);
    result.rules.push(...research.rules);
    result.pitfalls.push(...research.pitfalls);
  }

  // Tier 2: Hardcoded knowledge
  const hardcoded = TECH_KNOWLEDGE[tech.name];
  if (hardcoded) {
    // Only add non-duplicate entries
    for (const rule of hardcoded.rules) {
      if (!result.rules.includes(rule)) result.rules.push(rule);
    }
    for (const pitfall of hardcoded.pitfalls) {
      if (!result.pitfalls.includes(pitfall)) result.pitfalls.push(pitfall);
    }
  }

  // Tier 3: Category-based inference
  if (result.rules.length === 0 || result.pitfalls.length === 0) {
    const category = classifyTechnology(tech);
    const categoryKnowledge = CATEGORY_RULES[category];
    if (categoryKnowledge) {
      if (result.rules.length === 0) result.rules.push(...categoryKnowledge.rules);
      if (result.pitfalls.length === 0) result.pitfalls.push(...categoryKnowledge.pitfalls);
    }
  }

  // Tier 4: Sensible defaults
  if (result.rules.length === 0) {
    result.rules.push(
      `Follow ${tech.name} documentation for API usage patterns`,
      'Pin dependency version to avoid unexpected breaking changes',
    );
  }
  if (result.pitfalls.length === 0) {
    result.pitfalls.push(
      `Check ${tech.name} changelog when upgrading for breaking changes`,
      'Ensure error handling covers all library-specific error types',
    );
  }

  return result;
}

// ============================================================================
// B. classifyFeature
// ============================================================================

export type FeatureCategory =
  | 'api-layer'
  | 'data-layer'
  | 'business-logic'
  | 'ui-components'
  | 'state-management'
  | 'testing'
  | 'cli'
  | 'auth'
  | 'documentation'
  | 'infrastructure'
  | 'utility'
  | 'generic';

/**
 * Classify a feature by structural signals — works for ANY language.
 */
export function classifyFeature(
  feature: DetectedFeature,
  importGraph?: Map<string, string[]>,
): FeatureCategory {
  const name = feature.name.toLowerCase();

  // Name patterns (language-agnostic)
  if (/^(server|api|routes?|controllers?|handlers?|endpoints?)$/.test(name)) return 'api-layer';
  if (/^(storage|db|database|models?|repositories|entities|migrations?)$/.test(name)) return 'data-layer';
  if (/^(core|domain|business|logic|engine|services?)$/.test(name)) return 'business-logic';
  if (/^(components?|ui|views?|pages?|layouts?|widgets?)$/.test(name)) return 'ui-components';
  if (/^(stores?|state|contexts?|providers?|hooks?)$/.test(name)) return 'state-management';
  if (/^(tests?|spec|__tests__|e2e|integration|fixtures?)$/.test(name)) return 'testing';
  if (/^(cli|cmd|commands?)$/.test(name)) return 'cli';
  if (/^(auth|authentication|authorization|security|identity)$/.test(name)) return 'auth';
  if (/^(docs?|documentation|knowledge)$/.test(name)) return 'documentation';
  if (/^(infra|infrastructure|deploy|ci|scripts?|tools?|config)$/.test(name)) return 'infrastructure';
  if (/^(utils?|helpers?|lib|shared|common|pkg|internal)$/.test(name)) return 'utility';

  // Test file ratio
  if (feature.testFiles.length > 0 && feature.fileCount > 0) {
    if (feature.testFiles.length / feature.fileCount > 0.5) return 'testing';
  }

  // Import direction (if graph available)
  if (importGraph) {
    const featurePaths = new Set(feature.paths.map(p => p.replace('/**', '')));
    let importedByOthers = 0;
    for (const [file, imports] of importGraph) {
      if (featurePaths.has(file)) continue;
      for (const imp of imports) {
        for (const fp of featurePaths) {
          if (imp.startsWith(fp)) importedByOthers++;
        }
      }
    }
    if (importedByOthers > 10) return 'utility';
  }

  // Technology presence
  const techNames = feature.technologies.map(t => t.toLowerCase());
  if (techNames.some(t => /prisma|typeorm|sqlalchemy|diesel|gorm|sequelize|drizzle/.test(t))) return 'data-layer';
  if (techNames.some(t => /react|vue|svelte|angular|solid/.test(t))) return 'ui-components';
  if (techNames.some(t => /express|fastify|hono|flask|gin|actix|django|rails/.test(t))) return 'api-layer';

  return 'generic';
}

// ============================================================================
// C. inferDirectoryPurpose
// ============================================================================

export interface DirContext {
  dominantExtensions?: string[];
  technologies?: string[];
  fileCount?: number;
}

/**
 * Infer the purpose of a directory — replaces both inferDirPurpose() and inferLayerPurpose().
 * Works for Go cmd/, Python templates/, Rust src/bin/, etc.
 */
export function inferDirectoryPurpose(dirName: string, context?: DirContext): string {
  const lower = dirName.toLowerCase();

  // Tier 2: Hardcoded lookup
  const hardcoded = DIR_PURPOSE_MAP[lower];
  if (hardcoded) return hardcoded;

  // Tier 3: Universal regex patterns
  if (/^(spec|__tests__|test_|_test)/.test(lower)) return 'Tests and test helpers';
  if (/^(build|dist|out|target|bin)$/.test(lower)) return 'Build output';
  if (/^(vendor|third[_-]?party|extern)/.test(lower)) return 'Third-party vendored code';
  if (/^(proto|protobuf|grpc)/.test(lower)) return 'Protocol buffer definitions';
  if (/^(gen|generated)/.test(lower)) return 'Auto-generated code';
  if (/^(i18n|l10n|locale|translations?)/.test(lower)) return 'Internationalization and localization';
  if (/^(plugin|extension|addon)s?$/.test(lower)) return 'Plugin/extension modules';
  if (/^(seed|seeds|fixtures|testdata)$/.test(lower)) return 'Seed data and test fixtures';
  if (/^(public|static|assets|resources|res)$/.test(lower)) return 'Static assets and resources';
  if (/^(cache|tmp|temp)$/.test(lower)) return 'Temporary/cache files';

  // Tier 3b: Context-based inference
  if (context) {
    if (context.dominantExtensions) {
      const exts = context.dominantExtensions;
      if (exts.some(e => /\.(test|spec)\.(ts|js|py|go|rs)$/.test(e))) return 'Tests and test helpers';
      if (exts.some(e => /\.(css|scss|less|styl)$/.test(e))) return 'Stylesheets';
      if (exts.some(e => /\.(html|hbs|ejs|pug|jinja2?)$/.test(e))) return 'Template files';
      if (exts.some(e => /\.(proto)$/.test(e))) return 'Protocol buffer definitions';
    }
    if (context.technologies) {
      if (context.technologies.some(t => /react|vue|svelte|angular/.test(t))) return 'UI components';
      if (context.technologies.some(t => /express|fastify|flask|gin/.test(t))) return 'Server handlers';
    }
  }

  // Tier 4: Capitalize name
  return `${capitalize(dirName)} module`;
}

// ============================================================================
// D. inferDataFlowFromGraph
// ============================================================================

/**
 * Infer data flow from import graph topology + name-based fallback.
 * Works for ANY language — not just frontend/backend JS patterns.
 */
export function inferDataFlowFromGraph(
  features: DetectedFeature[],
  importGraph?: Map<string, string[]>,
): string[] {
  const names = features.map(f => f.name);

  // If we have an import graph, use topology analysis
  if (importGraph && importGraph.size > 0) {
    const flow = inferFlowFromTopology(features, importGraph);
    if (flow.length >= 2) return flow;
  }

  // Fallback: name-based regex patterns (universal, not JS-specific)
  return inferFlowFromNames(names);
}

function inferFlowFromTopology(
  features: DetectedFeature[],
  importGraph: Map<string, string[]>,
): string[] {
  // Build feature-to-feature edge weights
  const featurePathMap = new Map<string, string>();
  for (const f of features) {
    for (const p of f.paths) {
      const clean = p.replace('/**', '');
      featurePathMap.set(clean, f.name);
    }
  }

  const edges = new Map<string, Map<string, number>>();
  for (const [file, imports] of importGraph) {
    const sourceFeature = findFeatureForFile(file, featurePathMap);
    if (!sourceFeature) continue;

    for (const imp of imports) {
      const targetFeature = findFeatureForFile(imp, featurePathMap);
      if (!targetFeature || targetFeature === sourceFeature) continue;

      if (!edges.has(sourceFeature)) edges.set(sourceFeature, new Map());
      const edgeMap = edges.get(sourceFeature)!;
      edgeMap.set(targetFeature, (edgeMap.get(targetFeature) || 0) + 1);
    }
  }

  // Build flow: find entry points (imported by none or few) → most-imported
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const f of features) {
    inDegree.set(f.name, 0);
    outDegree.set(f.name, 0);
  }

  for (const [source, targets] of edges) {
    for (const [target, weight] of targets) {
      inDegree.set(target, (inDegree.get(target) || 0) + weight);
      outDegree.set(source, (outDegree.get(source) || 0) + weight);
    }
  }

  // Sort by: high out-degree and low in-degree first (entry points)
  // to low out-degree and high in-degree last (leaf dependencies)
  const sorted = features
    .map(f => ({
      name: f.name,
      score: (outDegree.get(f.name) || 0) - (inDegree.get(f.name) || 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(f => capitalize(f.name));

  return sorted.slice(0, 6);
}

function findFeatureForFile(file: string, featurePathMap: Map<string, string>): string | null {
  for (const [path, feature] of featurePathMap) {
    if (file.startsWith(path)) return feature;
  }
  return null;
}

function inferFlowFromNames(names: string[]): string[] {
  const flow: string[] = [];

  // Frontend patterns (universal)
  const isFrontend = names.some(n => /^(components?|pages?|views?|hooks?|widgets?)$/.test(n));
  if (isFrontend) {
    flow.push('User');
    if (names.some(n => /^(pages?|views?)$/.test(n))) flow.push('Pages');
    if (names.some(n => /^(components?|widgets?)$/.test(n))) flow.push('Components');
    if (names.some(n => /^hooks?$/.test(n))) flow.push('Hooks');
    if (names.some(n => /^services?$/.test(n))) flow.push('Services');
    if (names.some(n => /^(stores?|state)$/.test(n))) flow.push('Store');
    return flow.length >= 2 ? flow : [];
  }

  // Backend/API patterns (universal)
  if (names.some(n => /^(server|api)$/.test(n))) flow.push('Request');
  if (names.includes('server')) flow.push('Server');
  if (names.includes('api')) flow.push('API');
  if (names.some(n => /^(controllers?|handlers?)$/.test(n))) flow.push('Controllers');
  if (names.includes('core')) flow.push('Core');
  if (names.some(n => /^services?$/.test(n))) flow.push('Services');
  if (names.some(n => /^(storage|db|database)$/.test(n))) flow.push('Storage');
  if (names.some(n => /^(indexing|search)$/.test(n))) flow.push('Indexer');

  // CLI patterns
  if (names.some(n => /^(cmd|cli)$/.test(n)) && flow.length === 0) {
    flow.push('CLI');
    if (names.includes('core')) flow.push('Core');
    if (names.some(n => /^(pkg|lib)$/.test(n))) flow.push('Lib');
  }

  return flow.length >= 2 ? flow : [];
}

// ============================================================================
// E. inferScopeLabel
// ============================================================================

/**
 * Infer a human-friendly label for a scoped package family.
 */
export function inferScopeLabel(
  scope: string,
  memberCount: number,
  researchDir?: string,
): string {
  // Tier 2: Hardcoded label
  const hardcoded = SCOPE_LABELS[scope];
  if (hardcoded) return hardcoded;

  // Tier 1: Extract from research file title
  if (researchDir) {
    try {
      if (existsSync(researchDir)) {
        const files = readdirSync(researchDir) as string[];
        const scopeClean = scope.replace('@', '');
        const match = files.find(f => f.startsWith(scopeClean));
        if (match) {
          const content = readFileSync(join(researchDir, match), 'utf-8');
          const titleMatch = content.match(/^#\s+(.+?)(?:\s+—|\s+v)/m);
          if (titleMatch?.[1]) return titleMatch[1];
        }
      }
    } catch { /* ignore */ }
  }

  // Tier 4: Default
  return `${scope} (${memberCount} packages)`;
}

// ============================================================================
// F. inferDocSource
// ============================================================================

/**
 * Infer documentation source for a package — works for ANY ecosystem.
 * Returns null only if no heuristic applies (extremely unlikely).
 */
export function inferDocSource(packageName: string, source?: string): DocSource | null {
  // Tier 2: Registry lookup
  for (const entry of DOC_SOURCE_REGISTRY) {
    if (entry.packageNames.includes(packageName)) return entry;
  }

  // Tier 3: Ecosystem-aware URL construction
  const ecosystem = detectEcosystem(packageName, source);
  switch (ecosystem) {
    case 'npm':
      return {
        packageNames: [packageName],
        docsUrl: `https://www.npmjs.com/package/${packageName}`,
      };
    case 'go':
      return {
        packageNames: [packageName],
        docsUrl: `https://pkg.go.dev/${packageName}`,
      };
    case 'rust':
      return {
        packageNames: [packageName],
        docsUrl: `https://docs.rs/${packageName}`,
      };
    case 'python':
      return {
        packageNames: [packageName],
        docsUrl: `https://pypi.org/project/${packageName}`,
      };
    case 'ruby':
      return {
        packageNames: [packageName],
        docsUrl: `https://rubygems.org/gems/${packageName}`,
      };
    case 'java':
      return {
        packageNames: [packageName],
        docsUrl: `https://mvnrepository.com/artifact/${packageName}`,
      };
    case 'dotnet':
      return {
        packageNames: [packageName],
        docsUrl: `https://www.nuget.org/packages/${packageName}`,
      };
    default:
      return null;
  }
}

type Ecosystem = 'npm' | 'go' | 'rust' | 'python' | 'ruby' | 'java' | 'dotnet' | 'unknown';

function detectEcosystem(packageName: string, source?: string): Ecosystem {
  if (source) {
    if (/package\.json|package-lock|yarn\.lock|pnpm-lock|bun\.lock/.test(source)) return 'npm';
    if (/go\.mod|go\.sum/.test(source)) return 'go';
    if (/Cargo\.toml|Cargo\.lock/.test(source)) return 'rust';
    if (/requirements\.txt|setup\.py|pyproject\.toml|Pipfile|poetry\.lock/.test(source)) return 'python';
    if (/Gemfile|\.gemspec/.test(source)) return 'ruby';
    if (/pom\.xml|build\.gradle/.test(source)) return 'java';
    if (/\.csproj|\.sln|nuget/.test(source)) return 'dotnet';
  }

  // Heuristics from package name patterns
  if (packageName.startsWith('@') || /^[a-z][\w.-]*$/.test(packageName)) return 'npm';
  if (packageName.includes('/') && !packageName.startsWith('@')) return 'go';

  return 'unknown';
}

// ============================================================================
// G. extractRulesFromResearch
// ============================================================================

export interface ExtractedResearchRules {
  rules: string[];
  pitfalls: string[];
}

/**
 * Parse research markdown files → extract bullet points from structured sections.
 * Returns empty arrays if no research found or trust_score < 0.5.
 */
export function extractRulesFromResearch(
  tech: DetectedTechnology,
  researchDir: string,
): ExtractedResearchRules {
  const result: ExtractedResearchRules = { rules: [], pitfalls: [] };

  // Find research file
  const safeName = tech.name.replace(/^@/, '').replace(/\//g, '__');
  const candidates = [
    join(researchDir, `${safeName}@${tech.version}.md`),
    join(researchDir, `${tech.name}@${tech.version}.md`),
  ];

  let content: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        content = readFileSync(candidate, 'utf-8');
        break;
      } catch { /* skip */ }
    }
  }

  // Also try to find any version match
  if (!content) {
    try {
      if (existsSync(researchDir)) {
        const files = readdirSync(researchDir) as string[];
        const match = files.find(f => f.startsWith(`${safeName}@`));
        if (match) {
          content = readFileSync(join(researchDir, match), 'utf-8');
        }
      }
    } catch { /* skip */ }
  }

  if (!content) return result;

  // Check trust_score in frontmatter
  const trustMatch = content.match(/trust_score:\s*([\d.]+)/);
  if (trustMatch) {
    const trustScore = parseFloat(trustMatch[1]!);
    if (trustScore < 0.5) return result;
  }

  // Extract from "Key API Patterns" → rules
  const apiRules = extractBulletPoints(content, 'Key API Patterns');
  result.rules.push(...apiRules.slice(0, 5));

  // Extract from "Common Pitfalls" → pitfalls
  const pitfalls = extractBulletPoints(content, 'Common Pitfalls');
  result.pitfalls.push(...pitfalls.slice(0, 5));

  // Extract from "Breaking Changes" → pitfalls
  const breakingChanges = extractBulletPoints(content, 'Breaking Changes');
  result.pitfalls.push(...breakingChanges.slice(0, 3));

  return result;
}

function extractBulletPoints(content: string, sectionName: string): string[] {
  const lines = content.split('\n');
  const points: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.match(new RegExp(`^##\\s+.*${escapeRegex(sectionName)}`, 'i'))) {
      inSection = true;
      continue;
    }
    if (inSection && line.match(/^##\s/)) {
      break; // Next section
    }
    if (inSection) {
      const bulletMatch = line.match(/^[-*]\s+(.+)/);
      if (bulletMatch?.[1]) {
        const text = bulletMatch[1].trim();
        if (text.length > 10 && text.length < 200) {
          points.push(text);
        }
      }
    }
  }

  return points;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Technology Classification
// ============================================================================

export type TechCategory =
  | 'web-framework'
  | 'ui-framework'
  | 'orm'
  | 'testing'
  | 'auth'
  | 'payment'
  | 'build-tool'
  | 'state-management'
  | 'css-framework'
  | 'validation'
  | 'api-client'
  | 'database-driver'
  | 'logging'
  | 'general';

/**
 * Classify a technology into a category using regex on package name.
 * These are structural classifiers, not hardcoded knowledge.
 */
export function classifyTechnology(tech: DetectedTechnology): TechCategory {
  const name = tech.name.toLowerCase();

  if (/^(express|fastify|hono|koa|flask|gin|actix|django|rails|spring|laravel|fiber|echo|chi|rocket|axum|phoenix|sinatra|bottle)$/.test(name)) return 'web-framework';
  if (/^(react|vue|svelte|angular|solid|preact|lit|qwik|next|nuxt|gatsby|remix|astro|sveltekit)$/.test(name)) return 'ui-framework';
  if (/prisma|typeorm|sqlalchemy|diesel|gorm|sequelize|mongoose|drizzle|knex|bookshelf|objection|mikro-orm|ecto/.test(name)) return 'orm';
  if (/vitest|jest|pytest|mocha|jasmine|chai|supertest|testing-library|playwright|cypress|selenium/.test(name)) return 'testing';
  if (/passport|jsonwebtoken|jwt|oauth|bcrypt|argon2|lucia|next-auth|auth0|clerk|supertokens/.test(name)) return 'auth';
  if (/stripe|paypal|braintree|square|adyen|mollie/.test(name)) return 'payment';
  if (/vite|webpack|esbuild|rollup|parcel|turbopack|swc|babel|tsc/.test(name)) return 'build-tool';
  if (/zustand|redux|mobx|jotai|recoil|pinia|vuex|xstate|ngrx/.test(name)) return 'state-management';
  if (/tailwind|styled-components|emotion|css-modules|sass|less|postcss|bootstrap|bulma/.test(name)) return 'css-framework';
  if (/^(zod|yup|joi|ajv|superstruct|io-ts|valibot|typebox)$/.test(name)) return 'validation';
  if (/^(axios|got|ky|node-fetch|undici|superagent|request)$/.test(name)) return 'api-client';
  if (/better-sqlite3|pg|mysql2|redis|ioredis|mongodb|mariadb|sqlite3|tedious/.test(name)) return 'database-driver';
  if (/winston|pino|bunyan|log4js|morgan|loglevel|consola/.test(name)) return 'logging';

  return 'general';
}

// ============================================================================
// Category Rules — universal truths about technology categories
// ============================================================================

interface CategoryKnowledge {
  rules: string[];
  pitfalls: string[];
}

const CATEGORY_RULES: Record<TechCategory, CategoryKnowledge> = {
  'web-framework': {
    rules: [
      'Validate all user inputs at the boundary — never trust request data',
      'Use middleware for cross-cutting concerns (auth, logging, CORS)',
      'Return consistent error response shapes across all endpoints',
    ],
    pitfalls: [
      'Unhandled async errors crash the server — always use error middleware',
      'Missing input validation leads to injection vulnerabilities',
    ],
  },
  'ui-framework': {
    rules: [
      'Components should be pure — same props must produce same output',
      'Use composition over inheritance — prefer small, focused components',
      'Keep components focused on one responsibility',
    ],
    pitfalls: [
      'Mutating state directly causes rendering bugs — always create new references',
      'Missing key props in lists causes reconciliation bugs',
    ],
  },
  'orm': {
    rules: [
      'Use migrations for all schema changes — never modify production DB directly',
      'Use transactions for multi-table operations',
      'Select only needed fields to avoid over-fetching',
    ],
    pitfalls: [
      'N+1 query problem — use eager loading or batch queries for relations',
      'Forgetting to run migrations after schema changes causes runtime errors',
    ],
  },
  'testing': {
    rules: [
      'Tests should be deterministic — no reliance on external services or timing',
      'Clean up test state between runs to prevent flaky failures',
      'Use descriptive test names that explain the expected behavior',
    ],
    pitfalls: [
      'Shared mutable state between tests causes flaky failures',
      'Mocking too much makes tests pass but misses real integration bugs',
    ],
  },
  'auth': {
    rules: [
      'Never store plain-text passwords — use bcrypt or argon2',
      'Set explicit token expiration — never issue non-expiring tokens',
      'Validate tokens on every request — never trust client-side auth state',
    ],
    pitfalls: [
      'Using weak algorithms (MD5, SHA1) for password hashing is a security vulnerability',
      'Not revoking tokens on logout allows session reuse',
    ],
  },
  'payment': {
    rules: [
      'Always verify webhook signatures before processing payment events',
      'Use idempotency keys for payment operations to prevent double-charges',
      'Log all payment events for audit trails',
    ],
    pitfalls: [
      'Webhook events may arrive out of order — handle idempotently',
      'Not handling declined payments gracefully shows raw errors to users',
    ],
  },
  'build-tool': {
    rules: [
      'Configure source maps for debugging in development',
      'Set up separate dev/prod build configurations',
    ],
    pitfalls: [
      'Large bundle sizes slow page load — use code splitting and tree shaking',
      'Misconfigured output paths overwrite source files',
    ],
  },
  'state-management': {
    rules: [
      'Keep store state minimal — derive computed values instead of storing them',
      'Use selectors to prevent unnecessary re-renders',
      'Keep store state serializable for debugging and persistence',
    ],
    pitfalls: [
      'Mutating state directly causes silent bugs — always use the update API',
      'Subscribing to entire store causes excessive re-renders',
    ],
  },
  'css-framework': {
    rules: [
      'Follow the framework\'s utility-first or component-based approach consistently',
      'Use conditional class merging utilities for dynamic styles',
    ],
    pitfalls: [
      'Dynamic class names may be purged in production — use full static class names',
      'Overriding framework styles with !important leads to unmaintainable CSS',
    ],
  },
  'validation': {
    rules: [
      'Define schemas once — derive types from schemas to keep them in sync',
      'Validate at system boundaries — user input, API responses, config files',
    ],
    pitfalls: [
      'Throwing on validation failure crashes the app — use safe parse methods in handlers',
      'Missing optional field validation causes runtime errors on undefined access',
    ],
  },
  'api-client': {
    rules: [
      'Set request timeouts to prevent hanging on unresponsive servers',
      'Handle network errors and HTTP errors separately',
    ],
    pitfalls: [
      'Not handling network errors shows cryptic errors to users',
      'Forgetting to set Content-Type header causes request parsing failures',
    ],
  },
  'database-driver': {
    rules: [
      'Use parameterized queries — never concatenate user input into SQL',
      'Use connection pooling for concurrent requests',
      'Close connections properly to prevent resource leaks',
    ],
    pitfalls: [
      'SQL injection from string concatenation — always use parameterized queries',
      'Not closing connections leaks file handles or socket connections',
    ],
  },
  'logging': {
    rules: [
      'Use structured logging (JSON) for machine-parseable log output',
      'Set appropriate log levels — debug in dev, info/warn in production',
    ],
    pitfalls: [
      'Logging sensitive data (passwords, tokens) is a security risk',
      'Synchronous logging in hot paths impacts performance',
    ],
  },
  'general': {
    rules: [
      'Follow existing patterns in this module for consistency',
      'Pin dependency versions to avoid unexpected breaking changes',
    ],
    pitfalls: [
      'Check changelog when upgrading for breaking changes',
      'Ensure error handling covers library-specific error types',
    ],
  },
};

// ============================================================================
// Feature-aware rule derivation (combines feature classification with tech rules)
// ============================================================================

/**
 * Derive context-aware rules for a feature based on its name, technologies,
 * and structural classification. Replaces the old deriveRules() function.
 */
export function deriveFeatureRules(
  feature: DetectedFeature,
  technologies: DetectedTechnology[],
  researchDir?: string,
): string[] {
  const rules: string[] = [];

  // Well-known features: use name-based rules first, then supplement with tech rules
  if (WELL_KNOWN_FEATURES.has(feature.name)) {
    const nameRules = FEATURE_NAME_RULES[feature.name];
    if (nameRules) rules.push(...nameRules);

    // Add tech rules that aren't redundant (limit to 2 extra)
    const techRules: string[] = [];
    for (const tech of technologies) {
      const inferred = inferTechRulesAndPitfalls(tech, researchDir);
      techRules.push(...inferred.rules);
    }
    for (const tr of techRules.slice(0, 2)) {
      if (!rules.some(r => r.includes(tr.split(' ')[0] || ''))) {
        rules.push(tr);
      }
    }
  } else {
    // Unknown feature: use tech rules first, then category fallback
    for (const tech of technologies) {
      const inferred = inferTechRulesAndPitfalls(tech, researchDir);
      rules.push(...inferred.rules);
    }
    if (rules.length === 0) {
      // Try feature classification
      const category = classifyFeature(feature);
      const categoryRules = FEATURE_CATEGORY_RULES[category];
      if (categoryRules) {
        rules.push(...categoryRules);
      } else {
        const nameRules = FEATURE_NAME_RULES[feature.name];
        rules.push(...(nameRules || [
          'Follow existing patterns in this module for consistency',
          'Export public API from index file — keep internal helpers unexported',
        ]));
      }
    }
  }

  // Always add scope awareness
  if (feature.paths.length > 0) {
    const scope = feature.paths[0]?.replace('/**', '') || '';
    rules.push(`Changes here should not import from other feature directories — keep ${scope} self-contained`);
  }

  return rules;
}

/**
 * Derive pitfalls for a feature. Replaces the old derivePitfalls() function.
 */
export function deriveFeaturePitfalls(
  feature: DetectedFeature,
  technologies: DetectedTechnology[],
  researchDir?: string,
): string[] {
  const pitfalls: string[] = [];

  if (WELL_KNOWN_FEATURES.has(feature.name)) {
    const namePitfalls = FEATURE_NAME_PITFALLS[feature.name];
    if (namePitfalls) pitfalls.push(...namePitfalls);
    for (const tech of technologies) {
      const inferred = inferTechRulesAndPitfalls(tech, researchDir);
      for (const p of inferred.pitfalls.slice(0, 1)) {
        if (!pitfalls.includes(p)) pitfalls.push(p);
      }
    }
  } else {
    for (const tech of technologies) {
      const inferred = inferTechRulesAndPitfalls(tech, researchDir);
      pitfalls.push(...inferred.pitfalls);
    }
    if (pitfalls.length === 0) {
      const namePitfalls = FEATURE_NAME_PITFALLS[feature.name];
      if (namePitfalls) {
        pitfalls.push(...namePitfalls);
      } else {
        // Tier 3: category-based pitfalls
        const category = classifyFeature(feature);
        const categoryPitfalls = FEATURE_CATEGORY_PITFALLS[category];
        if (categoryPitfalls) {
          pitfalls.push(...categoryPitfalls);
        } else {
          pitfalls.push(
            'Check for null/undefined before property access on external data',
            'Changing exports may break other modules that depend on this feature',
          );
        }
      }
    }
  }

  return pitfalls;
}

// Feature category → rules mapping for Tier 3
const FEATURE_CATEGORY_RULES: Record<FeatureCategory, string[]> = {
  'api-layer': [
    'All endpoints must validate request bodies/params before processing',
    'Return consistent error response shapes across all endpoints',
  ],
  'data-layer': [
    'All database access should go through this module — no direct imports elsewhere',
    'Use transactions for multi-step operations to ensure consistency',
  ],
  'business-logic': [
    'Core modules should have no side effects on import',
    'Export types alongside functions for downstream consumers',
  ],
  'ui-components': [
    'Components should be pure — derive UI from props, avoid internal side effects',
    'Use composition over inheritance — prefer small, focused components',
  ],
  'state-management': [
    'Keep store state minimal — derive computed values instead of storing them',
    'Actions should be thin — delegate complex logic to services',
  ],
  'testing': [
    'Tests should be deterministic — no reliance on external services or timing',
    'Clean up temporary files and directories in teardown hooks',
  ],
  'cli': [
    'Validate all command-line arguments before processing',
    'Provide helpful error messages with usage hints on invalid input',
  ],
  'auth': [
    'Never store plain-text passwords — use bcrypt or argon2',
    'Validate and sanitize all user inputs before processing',
  ],
  'documentation': [
    'Generated docs must be kept in sync with source code changes',
    'Use relative paths for internal links',
  ],
  'infrastructure': [
    'Configuration should be environment-aware (dev/staging/prod)',
    'Scripts should be idempotent — safe to run multiple times',
  ],
  'utility': [
    'Utility functions should be pure — no side effects',
    'Export public API from index file — keep internal helpers unexported',
  ],
  'generic': [
    'Follow existing patterns in this module for consistency',
    'Export public API from index file — keep internal helpers unexported',
  ],
};

const FEATURE_CATEGORY_PITFALLS: Record<FeatureCategory, string[]> = {
  'api-layer': [
    'Unhandled async errors crash the server — always catch errors in handlers',
    'Missing input validation leads to injection vulnerabilities',
  ],
  'data-layer': [
    'Forgetting to close connections leaks file handles',
    'Concurrent writes without transactions may cause data corruption',
  ],
  'business-logic': [
    'Circular imports between core modules cause runtime errors — check dependency direction',
    'Changing public API signatures breaks downstream consumers',
  ],
  'ui-components': [
    'Missing key prop in lists causes reconciliation bugs — always use stable keys',
    'Direct DOM manipulation bypasses the framework — use refs only when necessary',
  ],
  'state-management': [
    'Mutating state directly causes silent bugs — always return new references',
    'Large store updates trigger unnecessary re-renders — split into focused slices',
  ],
  'testing': [
    'Tests sharing mutable state between runs cause flaky failures',
    'Temp directories not cleaned up fill disk over repeated test runs',
  ],
  'cli': [
    'Missing error handling on subprocess execution causes silent failures',
    'Not quoting file paths breaks on paths with spaces',
  ],
  'auth': [
    'Using weak hashing algorithms is a security vulnerability',
    'Not revoking tokens on logout allows session reuse',
  ],
  'documentation': [
    'Stale documentation is worse than no documentation',
    'Broken internal links confuse users — validate links on changes',
  ],
  'infrastructure': [
    'Hardcoded secrets in config files are a security risk — use environment variables',
    'Non-idempotent scripts cause issues on re-run',
  ],
  'utility': [
    'Changing utility signatures breaks all callers — check usage before modifying',
    'Missing error handling in utilities propagates errors to all consumers',
  ],
  'generic': [
    'Check for null/undefined before property access on external data',
    'Changing exports may break other modules that depend on this feature',
  ],
};

// ============================================================================
// Helpers
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, ' ');
}
