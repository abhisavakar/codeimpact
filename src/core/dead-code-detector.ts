import type { Tier2Storage } from '../storage/tier2.js';
import type { Export, Import } from '../types/index.js';

/**
 * Represents an export that appears to be unused (not imported anywhere).
 */
export interface UnusedExport {
  filePath: string;
  exportedName: string;
  localName?: string;
  lineNumber: number;
  isDefault: boolean;
  confidence: number; // 0-100, higher = more confident it's truly unused
}

/**
 * Represents a file that appears to have no dependents (nothing imports it).
 */
export interface UnusedFile {
  filePath: string;
  lineCount: number;
  exportCount: number;
  isEntryPoint: boolean;
  confidence: number; // 0-100
}

/**
 * Complete dead code analysis report.
 */
export interface DeadCodeReport {
  unusedExports: UnusedExport[];
  unusedFiles: UnusedFile[];
  totalExports: number;
  totalFiles: number;
  estimatedDeadLines: number;
  overallConfidence: number;
  safeToDelete: UnusedExport[]; // High confidence items
}

// ==================== Framework Detection ====================

// ==================== FRONTEND FRAMEWORKS ====================

/**
 * Next.js special files that are used by the framework, not imported directly.
 */
const NEXTJS_SPECIAL_FILES = new Set([
  'page', 'layout', 'loading', 'error', 'not-found', 'template',
  'default', 'route', 'middleware', 'instrumentation',
  'apple-icon', 'icon', 'opengraph-image', 'twitter-image',
  'sitemap', 'robots', 'manifest', 'global-error',
]);

/**
 * Next.js special exports that are read by the framework.
 */
const NEXTJS_SPECIAL_EXPORTS = new Set([
  // Metadata
  'metadata', 'generateMetadata', 'generateStaticParams', 'generateViewport',
  // Route segment config
  'dynamic', 'dynamicParams', 'revalidate', 'fetchCache',
  'runtime', 'preferredRegion', 'maxDuration',
  // Image exports
  'size', 'contentType', 'alt',
  // API route handlers
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  // Middleware
  'config', 'matcher',
  // getServerSideProps / getStaticProps (Pages Router)
  'getServerSideProps', 'getStaticProps', 'getStaticPaths', 'getInitialProps',
]);

/**
 * Remix special files and exports.
 */
const REMIX_SPECIAL_FILES = new Set([
  'root', 'entry.client', 'entry.server',
]);

const REMIX_SPECIAL_EXPORTS = new Set([
  'loader', 'action', 'meta', 'links', 'headers', 'handle',
  'shouldRevalidate', 'ErrorBoundary', 'CatchBoundary',
  'HydrateFallback', 'clientLoader', 'clientAction',
]);

/**
 * Nuxt.js (Vue) special files and exports.
 */
const NUXT_SPECIAL_FILES = new Set([
  'app', 'error', 'nuxt.config', 'app.config',
]);

const NUXT_SPECIAL_EXPORTS = new Set([
  'definePageMeta', 'useHead', 'useSeoMeta',
  'defineNuxtConfig', 'defineAppConfig', 'defineNuxtPlugin',
  'defineEventHandler', 'defineNuxtRouteMiddleware',
]);

/**
 * SvelteKit special files and exports.
 */
const SVELTEKIT_SPECIAL_FILES = new Set([
  '+page', '+layout', '+error', '+server', '+page.server', '+layout.server',
  'hooks.server', 'hooks.client', 'params',
]);

const SVELTEKIT_SPECIAL_EXPORTS = new Set([
  'load', 'actions', 'prerender', 'ssr', 'csr', 'trailingSlash',
  'handle', 'handleError', 'handleFetch', 'match',
]);

/**
 * Astro special files and exports.
 */
const ASTRO_SPECIAL_FILES = new Set([
  'astro.config', 'env.d',
]);

const ASTRO_SPECIAL_EXPORTS = new Set([
  'getStaticPaths', 'prerender', 'partial',
]);

/**
 * Vue.js special exports (Options API & Composition API).
 */
const VUE_SPECIAL_EXPORTS = new Set([
  'defineComponent', 'defineProps', 'defineEmits', 'defineExpose',
  'defineOptions', 'defineSlots', 'defineModel',
  // Options API
  'data', 'methods', 'computed', 'watch', 'props', 'emits',
  'components', 'directives', 'mixins', 'extends',
  'beforeCreate', 'created', 'beforeMount', 'mounted',
  'beforeUpdate', 'updated', 'beforeUnmount', 'unmounted',
  // Vue Router
  'beforeRouteEnter', 'beforeRouteUpdate', 'beforeRouteLeave',
]);

/**
 * Angular special exports and decorators.
 */
const ANGULAR_SPECIAL_EXPORTS = new Set([
  // Decorators (often appear as exports)
  'Component', 'Directive', 'Pipe', 'Injectable', 'NgModule',
  'Input', 'Output', 'ViewChild', 'ContentChild', 'HostListener',
  // Lifecycle hooks
  'ngOnInit', 'ngOnDestroy', 'ngOnChanges', 'ngAfterViewInit',
  'ngAfterContentInit', 'ngDoCheck',
  // Module exports
  'AppModule', 'AppComponent', 'AppRoutingModule',
]);

/**
 * Angular special files.
 */
const ANGULAR_SPECIAL_FILES = new Set([
  'app.module', 'app.component', 'app-routing.module',
  'main', 'polyfills', 'environment', 'environments',
]);

// ==================== BACKEND FRAMEWORKS ====================

/**
 * FastAPI (Python) special patterns.
 */
const FASTAPI_SPECIAL_EXPORTS = new Set([
  // Decorators and functions
  'app', 'router', 'APIRouter', 'FastAPI',
  'Depends', 'Query', 'Path', 'Body', 'Header', 'Cookie', 'Form', 'File',
  'HTTPException', 'Request', 'Response', 'BackgroundTasks',
  // Pydantic
  'BaseModel', 'Field', 'validator', 'root_validator',
  // Lifecycle
  'on_event', 'lifespan',
]);

const FASTAPI_SPECIAL_FILES = new Set([
  'main', 'app', 'deps', 'dependencies', 'config', 'settings',
  'schemas', 'models', 'crud', 'routers', 'api',
]);

/**
 * Django (Python) special patterns.
 */
const DJANGO_SPECIAL_EXPORTS = new Set([
  // Views
  'urlpatterns', 'app_name',
  // Models
  'Meta', 'objects', 'DoesNotExist', 'MultipleObjectsReturned',
  // Admin
  'admin', 'ModelAdmin', 'TabularInline', 'StackedInline',
  // Settings
  'INSTALLED_APPS', 'MIDDLEWARE', 'DATABASES', 'TEMPLATES',
  'STATIC_URL', 'MEDIA_URL', 'SECRET_KEY', 'DEBUG', 'ALLOWED_HOSTS',
  // Management commands
  'Command', 'handle',
]);

const DJANGO_SPECIAL_FILES = new Set([
  'settings', 'urls', 'wsgi', 'asgi', 'admin', 'apps', 'models',
  'views', 'forms', 'serializers', 'signals', 'tasks', 'celery',
  'conftest', 'manage',
]);

/**
 * Flask (Python) special patterns.
 */
const FLASK_SPECIAL_EXPORTS = new Set([
  'app', 'Flask', 'Blueprint', 'request', 'g', 'session',
  'current_app', 'render_template', 'redirect', 'url_for',
  'before_request', 'after_request', 'teardown_request',
]);

const FLASK_SPECIAL_FILES = new Set([
  'app', 'wsgi', 'config', 'extensions', 'blueprints',
]);

/**
 * Express.js / Node.js backend special patterns.
 */
const EXPRESS_SPECIAL_EXPORTS = new Set([
  'app', 'router', 'express', 'Router',
  // Middleware
  'use', 'get', 'post', 'put', 'delete', 'patch', 'all',
  // Common patterns
  'middleware', 'errorHandler', 'notFound',
]);

const EXPRESS_SPECIAL_FILES = new Set([
  'app', 'server', 'index', 'routes', 'middleware', 'controllers',
  'config', 'db', 'database', 'models',
]);

/**
 * NestJS special patterns.
 */
const NESTJS_SPECIAL_EXPORTS = new Set([
  // Decorators
  'Controller', 'Get', 'Post', 'Put', 'Delete', 'Patch',
  'Module', 'Injectable', 'Inject',
  'UseGuards', 'UseInterceptors', 'UsePipes', 'UseFilters',
  'Body', 'Param', 'Query', 'Headers', 'Req', 'Res',
  // Lifecycle
  'onModuleInit', 'onModuleDestroy', 'onApplicationBootstrap',
  'onApplicationShutdown', 'beforeApplicationShutdown',
  // Module exports
  'AppModule', 'AppController', 'AppService',
]);

const NESTJS_SPECIAL_FILES = new Set([
  'main', 'app.module', 'app.controller', 'app.service',
]);

/**
 * Spring Boot (Java) special patterns - for Kotlin/TS ports.
 */
const SPRING_SPECIAL_EXPORTS = new Set([
  'RestController', 'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping',
  'RequestMapping', 'Service', 'Repository', 'Component', 'Autowired',
  'Bean', 'Configuration', 'Value', 'SpringBootApplication',
]);

/**
 * Ruby on Rails patterns (for similar Node/TS implementations).
 */
const RAILS_SPECIAL_FILES = new Set([
  'application_controller', 'application_record', 'application_helper',
  'routes', 'schema', 'seeds',
]);

// ==================== TESTING FRAMEWORKS ====================

/**
 * Test framework special exports and files.
 */
const TEST_SPECIAL_EXPORTS = new Set([
  // Jest/Vitest
  'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach',
  'beforeAll', 'afterAll', 'jest', 'vi',
  // Pytest
  'pytest', 'fixture', 'mark', 'parametrize',
  // Mocha
  'suite', 'setup', 'teardown',
  // Cypress
  'cy', 'Cypress',
  // Playwright
  'test', 'expect', 'Page', 'Browser',
]);

const TEST_SPECIAL_FILES = new Set([
  'conftest', 'setup', 'teardown', 'fixtures', 'mocks',
  'jest.setup', 'vitest.setup', 'setupTests',
]);

// ==================== CONFIG FILES ====================

/**
 * Config files that are loaded by tools, not imported.
 */
const CONFIG_FILE_PATTERNS = [
  // JavaScript/TypeScript config
  /eslint\.config\.(m?js|ts)$/i,
  /\.eslintrc(\.(js|json|ya?ml))?$/i,
  /next\.config\.(m?js|ts)$/i,
  /nuxt\.config\.(js|ts)$/i,
  /svelte\.config\.(js|ts)$/i,
  /astro\.config\.(m?js|ts)$/i,
  /vite\.config\.(js|ts|mjs)$/i,
  /vitest\.config\.(js|ts|mts)$/i,
  /webpack\.config\.(js|ts)$/i,
  /rollup\.config\.(js|ts|mjs)$/i,
  /jest\.config\.(js|ts|mjs)$/i,
  /babel\.config\.(js|json|cjs)$/i,
  /\.babelrc(\.json)?$/i,
  /prettier\.config\.(js|ts|cjs|mjs)$/i,
  /\.prettierrc(\.(js|json|ya?ml))?$/i,
  /tailwind\.config\.(js|ts|cjs|mjs)$/i,
  /postcss\.config\.(js|ts|cjs|mjs)$/i,
  /tsconfig.*\.json$/i,
  /jsconfig\.json$/i,
  /package\.json$/i,
  /\.env(\..*)?$/i,
  // Python config
  /pyproject\.toml$/i,
  /setup\.py$/i,
  /setup\.cfg$/i,
  /requirements.*\.txt$/i,
  /Pipfile$/i,
  /poetry\.lock$/i,
  /tox\.ini$/i,
  /pytest\.ini$/i,
  /\.flake8$/i,
  /mypy\.ini$/i,
  // Docker/DevOps
  /Dockerfile$/i,
  /docker-compose\.ya?ml$/i,
  /\.dockerignore$/i,
  /Makefile$/i,
  /\.gitlab-ci\.ya?ml$/i,
  /\.github\/.*\.ya?ml$/i,
  /Jenkinsfile$/i,
  // Other
  /\.gitignore$/i,
  /\.editorconfig$/i,
  /\.nvmrc$/i,
  /\.node-version$/i,
  /\.ruby-version$/i,
  /\.python-version$/i,
];

// ==================== FRAMEWORK DIRECTORIES ====================

/**
 * Directories that indicate framework-managed files.
 */
const FRAMEWORK_DIRS = [
  // Next.js
  '/app/',
  '/pages/',
  '/.next/',
  // Nuxt
  '/.nuxt/',
  '/composables/',
  '/plugins/',
  // SvelteKit
  '/.svelte-kit/',
  '/routes/',
  // Astro
  '/.astro/',
  // General
  '/api/',
  '/public/',
  '/static/',
  '/assets/',
  // Python
  '/migrations/',
  '/alembic/',
  '/__pycache__/',
  // Build outputs
  '/dist/',
  '/build/',
  '/out/',
  '/node_modules/',
  '/.venv/',
  '/venv/',
];

// ==================== COMBINED SETS ====================

/**
 * All framework special files combined.
 */
const ALL_FRAMEWORK_SPECIAL_FILES = new Set([
  ...NEXTJS_SPECIAL_FILES,
  ...REMIX_SPECIAL_FILES,
  ...NUXT_SPECIAL_FILES,
  ...SVELTEKIT_SPECIAL_FILES,
  ...ASTRO_SPECIAL_FILES,
  ...ANGULAR_SPECIAL_FILES,
  ...FASTAPI_SPECIAL_FILES,
  ...DJANGO_SPECIAL_FILES,
  ...FLASK_SPECIAL_FILES,
  ...EXPRESS_SPECIAL_FILES,
  ...NESTJS_SPECIAL_FILES,
  ...RAILS_SPECIAL_FILES,
  ...TEST_SPECIAL_FILES,
]);

/**
 * All framework special exports combined.
 */
const ALL_FRAMEWORK_SPECIAL_EXPORTS = new Set([
  ...NEXTJS_SPECIAL_EXPORTS,
  ...REMIX_SPECIAL_EXPORTS,
  ...NUXT_SPECIAL_EXPORTS,
  ...SVELTEKIT_SPECIAL_EXPORTS,
  ...ASTRO_SPECIAL_EXPORTS,
  ...VUE_SPECIAL_EXPORTS,
  ...ANGULAR_SPECIAL_EXPORTS,
  ...FASTAPI_SPECIAL_EXPORTS,
  ...DJANGO_SPECIAL_EXPORTS,
  ...FLASK_SPECIAL_EXPORTS,
  ...EXPRESS_SPECIAL_EXPORTS,
  ...NESTJS_SPECIAL_EXPORTS,
  ...SPRING_SPECIAL_EXPORTS,
  ...TEST_SPECIAL_EXPORTS,
]);

/**
 * DeadCodeDetector - Finds unused exports and files in a codebase.
 *
 * Uses the imports/exports tables to identify:
 * 1. Exports that are never imported anywhere
 * 2. Files that have no dependents (nothing imports from them)
 *
 * Confidence scoring accounts for:
 * - Entry points (index.ts, main.ts) which may be used externally
 * - Re-exports which may be used by external consumers
 * - Test files which are run by test frameworks
 * - Dynamic imports which can't be statically analyzed
 * - Framework conventions (Next.js, React, etc.)
 */
export class DeadCodeDetector {
  private tier2: Tier2Storage;

  constructor(tier2: Tier2Storage) {
    this.tier2 = tier2;
  }

  /**
   * Find all exports that are not imported anywhere in the codebase.
   */
  findUnusedExports(): UnusedExport[] {
    const allExports = this.tier2.getAllExports();
    const allImports = this.tier2.getAllImports();

    // Build a set of all imported symbols for fast lookup
    // Key: normalized import target + symbol name
    const importedSymbols = this.buildImportedSymbolsSet(allImports);

    const unusedExports: UnusedExport[] = [];

    for (const exp of allExports) {
      const isUsed = this.isExportUsed(exp, importedSymbols, allImports);

      if (!isUsed) {
        const confidence = this.calculateExportConfidence(exp);
        unusedExports.push({
          filePath: exp.filePath,
          exportedName: exp.exportedName,
          localName: exp.localName,
          lineNumber: exp.lineNumber,
          isDefault: exp.isDefault,
          confidence,
        });
      }
    }

    // Sort by confidence (highest first) then by file path
    return unusedExports.sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.filePath.localeCompare(b.filePath);
    });
  }

  /**
   * Find all files that have no dependents (nothing imports from them).
   */
  findUnusedFiles(): UnusedFile[] {
    const allFiles = this.tier2.getAllFiles();
    const unusedFiles: UnusedFile[] = [];

    for (const file of allFiles) {
      // Skip non-code files
      if (!this.isCodeFile(file.path)) {
        continue;
      }

      const dependents = this.tier2.getFileDependents(file.path);
      const isEntryPoint = this.tier2.isEntryPoint(file.path);
      const exports = this.tier2.getExportsByFile(file.id);

      if (dependents.length === 0) {
        const confidence = this.calculateFileConfidence(file.path, isEntryPoint, exports.length);
        unusedFiles.push({
          filePath: file.path,
          lineCount: file.lineCount || 0,
          exportCount: exports.length,
          isEntryPoint,
          confidence,
        });
      }
    }

    // Sort by confidence (highest first), excluding entry points from top
    return unusedFiles.sort((a, b) => {
      // Entry points always go to the bottom
      if (a.isEntryPoint !== b.isEntryPoint) {
        return a.isEntryPoint ? 1 : -1;
      }
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.filePath.localeCompare(b.filePath);
    });
  }

  /**
   * Run full dead code analysis and return a complete report.
   */
  analyze(): DeadCodeReport {
    const unusedExports = this.findUnusedExports();
    const unusedFiles = this.findUnusedFiles();
    const allExports = this.tier2.getAllExports();
    const allFiles = this.tier2.getAllFiles().filter(f => this.isCodeFile(f.path));

    // Filter out framework files from unused exports for accurate counts
    const nonFrameworkExports = unusedExports.filter(e => !this.isFrameworkExport(e));

    // Estimate dead lines from unused files (excluding entry points and framework files)
    const estimatedDeadLines = unusedFiles
      .filter(f => !f.isEntryPoint && f.confidence >= 50 && !this.isFrameworkFile(f.filePath.replace(/\\/g, '/').toLowerCase()))
      .reduce((sum, f) => sum + f.lineCount, 0);

    // Calculate overall confidence (only for non-framework exports)
    const highConfidenceExports = nonFrameworkExports.filter(e => e.confidence >= 80);
    const overallConfidence = nonFrameworkExports.length > 0
      ? Math.round(highConfidenceExports.length / nonFrameworkExports.length * 100)
      : 100;

    // Items safe to delete (high confidence, non-framework)
    const safeToDelete = nonFrameworkExports.filter(e => e.confidence >= 85);

    return {
      unusedExports: nonFrameworkExports,
      unusedFiles: unusedFiles.filter(f => f.confidence >= 30), // Filter very low confidence
      totalExports: allExports.length,
      totalFiles: allFiles.length,
      estimatedDeadLines,
      overallConfidence,
      safeToDelete,
    };
  }

  /**
   * Check if an export is a framework export (Next.js, etc.)
   */
  private isFrameworkExport(exp: UnusedExport): boolean {
    const normalizedPath = exp.filePath.replace(/\\/g, '/').toLowerCase();
    const fileName = normalizedPath.split('/').pop() || '';
    const fileBaseName = fileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // Next.js special files
    if (ALL_FRAMEWORK_SPECIAL_FILES.has(fileBaseName)) {
      if (normalizedPath.includes('/app/') || normalizedPath.includes('/pages/')) {
        return true;
      }
    }

    // Next.js special exports
    if (ALL_FRAMEWORK_SPECIAL_EXPORTS.has(exp.exportedName)) {
      return true;
    }

    // Config files
    if (this.isConfigFile(normalizedPath)) {
      return true;
    }

    // Middleware
    if (fileBaseName === 'middleware') {
      return true;
    }

    return false;
  }

  /**
   * Format a dead code report for CLI output.
   */
  formatReport(report: DeadCodeReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('DEAD CODE REPORT');
    lines.push('='.repeat(60));
    lines.push('');

    // Summary
    lines.push('SUMMARY');
    lines.push('-'.repeat(40));
    lines.push(`Total files analyzed: ${report.totalFiles}`);
    lines.push(`Total exports analyzed: ${report.totalExports}`);
    lines.push(`Unused exports found: ${report.unusedExports.length}`);
    lines.push(`Files with no dependents: ${report.unusedFiles.length}`);
    lines.push(`Estimated dead lines: ${report.estimatedDeadLines.toLocaleString()}`);
    lines.push(`Overall confidence: ${report.overallConfidence}%`);
    lines.push('');

    // Safe to delete
    if (report.safeToDelete.length > 0) {
      lines.push('SAFE TO DELETE (85%+ confidence)');
      lines.push('-'.repeat(40));
      for (const exp of report.safeToDelete.slice(0, 20)) {
        lines.push(`  ${exp.filePath}:${exp.lineNumber}`);
        lines.push(`    export: ${exp.isDefault ? 'default' : exp.exportedName} (${exp.confidence}% confidence)`);
      }
      if (report.safeToDelete.length > 20) {
        lines.push(`  ... and ${report.safeToDelete.length - 20} more`);
      }
      lines.push('');
    }

    // Unused exports (medium confidence)
    const mediumConfidence = report.unusedExports.filter(e => e.confidence >= 50 && e.confidence < 85);
    if (mediumConfidence.length > 0) {
      lines.push('POSSIBLY UNUSED (50-84% confidence)');
      lines.push('-'.repeat(40));
      for (const exp of mediumConfidence.slice(0, 15)) {
        lines.push(`  ${exp.filePath}:${exp.lineNumber}`);
        lines.push(`    export: ${exp.isDefault ? 'default' : exp.exportedName} (${exp.confidence}% confidence)`);
      }
      if (mediumConfidence.length > 15) {
        lines.push(`  ... and ${mediumConfidence.length - 15} more`);
      }
      lines.push('');
    }

    // Unused files (not entry points)
    const unusedNonEntryFiles = report.unusedFiles.filter(f => !f.isEntryPoint);
    if (unusedNonEntryFiles.length > 0) {
      lines.push('FILES WITH NO DEPENDENTS');
      lines.push('-'.repeat(40));
      for (const file of unusedNonEntryFiles.slice(0, 15)) {
        lines.push(`  ${file.filePath}`);
        lines.push(`    ${file.lineCount} lines, ${file.exportCount} exports (${file.confidence}% confidence)`);
      }
      if (unusedNonEntryFiles.length > 15) {
        lines.push(`  ... and ${unusedNonEntryFiles.length - 15} more`);
      }
      lines.push('');
    }

    // Entry points (informational)
    const entryPoints = report.unusedFiles.filter(f => f.isEntryPoint);
    if (entryPoints.length > 0) {
      lines.push('ENTRY POINTS (no internal dependents, likely used externally)');
      lines.push('-'.repeat(40));
      for (const file of entryPoints.slice(0, 10)) {
        lines.push(`  ${file.filePath}`);
      }
      if (entryPoints.length > 10) {
        lines.push(`  ... and ${entryPoints.length - 10} more`);
      }
      lines.push('');
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  /**
   * Format report as JSON for programmatic use.
   */
  formatReportJSON(report: DeadCodeReport): string {
    return JSON.stringify({
      summary: {
        totalFiles: report.totalFiles,
        totalExports: report.totalExports,
        unusedExportsCount: report.unusedExports.length,
        unusedFilesCount: report.unusedFiles.length,
        estimatedDeadLines: report.estimatedDeadLines,
        overallConfidence: report.overallConfidence,
      },
      safeToDelete: report.safeToDelete,
      unusedExports: report.unusedExports,
      unusedFiles: report.unusedFiles,
    }, null, 2);
  }

  // ==================== Private Helpers ====================

  /**
   * Build a set of all imported symbols for fast lookup.
   * Returns a Set of strings in format: "normalized_path:symbol_name"
   */
  private buildImportedSymbolsSet(imports: Import[]): Set<string> {
    const imported = new Set<string>();

    for (const imp of imports) {
      const normalizedFrom = this.normalizeImportPath(imp.importedFrom);

      // Add each imported symbol
      for (const symbol of imp.importedSymbols) {
        imported.add(`${normalizedFrom}:${symbol}`);
      }

      // If it's a default import, mark the default as used
      if (imp.isDefault) {
        imported.add(`${normalizedFrom}:default`);
      }

      // If it's a namespace import (import * as X), mark all exports as potentially used
      if (imp.isNamespace) {
        imported.add(`${normalizedFrom}:*`);
      }
    }

    return imported;
  }

  /**
   * Check if an export is used (imported) anywhere.
   */
  private isExportUsed(exp: Export, importedSymbols: Set<string>, allImports: Import[]): boolean {
    const normalizedPath = this.normalizeExportPath(exp.filePath);

    // Check if this specific export is imported
    const symbolKey = exp.isDefault
      ? `${normalizedPath}:default`
      : `${normalizedPath}:${exp.exportedName}`;

    if (importedSymbols.has(symbolKey)) {
      return true;
    }

    // Check if there's a namespace import from this file
    if (importedSymbols.has(`${normalizedPath}:*`)) {
      return true;
    }

    // Check for partial path matches (relative imports)
    // e.g., export from "src/utils/helpers.ts" might be imported as "./helpers"
    for (const imp of allImports) {
      if (this.importsMatch(exp.filePath, imp.importedFrom)) {
        // Check if this symbol is in the import
        if (exp.isDefault && imp.isDefault) {
          return true;
        }
        if (imp.isNamespace) {
          return true;
        }
        if (imp.importedSymbols.includes(exp.exportedName)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if an import path could refer to the given file.
   */
  private importsMatch(filePath: string, importPath: string): boolean {
    const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
    const normalizedImport = importPath.replace(/\\/g, '/').toLowerCase();

    // Remove extension from file path
    const fileBase = normalizedFile.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // Check various matching patterns
    if (normalizedImport === fileBase) return true;
    if (normalizedFile.endsWith(`/${normalizedImport}`)) return true;
    if (normalizedFile.endsWith(`/${normalizedImport}.ts`)) return true;
    if (normalizedFile.endsWith(`/${normalizedImport}.js`)) return true;
    if (fileBase.endsWith(`/${normalizedImport}`)) return true;

    // Handle index files: import from "./utils" → utils/index.ts
    if (fileBase.endsWith('/index')) {
      const dirPath = fileBase.slice(0, -6); // Remove /index
      if (dirPath.endsWith(`/${normalizedImport}`)) return true;
    }

    return false;
  }

  /**
   * Normalize an import path for comparison.
   */
  private normalizeImportPath(importPath: string): string {
    return importPath
      .replace(/\\/g, '/')
      .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
      .toLowerCase();
  }

  /**
   * Normalize an export's file path for comparison.
   */
  private normalizeExportPath(filePath: string): string {
    return filePath
      .replace(/\\/g, '/')
      .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
      .toLowerCase();
  }

  /**
   * Calculate confidence that an export is truly unused.
   */
  private calculateExportConfidence(exp: Export): number {
    let confidence = 90; // Start high

    const normalizedPath = exp.filePath.replace(/\\/g, '/').toLowerCase();
    const fileName = normalizedPath.split('/').pop() || '';
    const fileBaseName = fileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // ==================== Framework Detection ====================

    // Next.js special files (page.tsx, layout.tsx, etc.) - very low confidence
    if (ALL_FRAMEWORK_SPECIAL_FILES.has(fileBaseName)) {
      // Check if it's in app/ or pages/ directory
      if (normalizedPath.includes('/app/') || normalizedPath.includes('/pages/')) {
        confidence -= 70; // These are framework-managed
      }
    }

    // Next.js special exports (metadata, dynamic, GET, etc.)
    if (ALL_FRAMEWORK_SPECIAL_EXPORTS.has(exp.exportedName)) {
      confidence -= 60; // Framework reads these
    }

    // Middleware file
    if (fileBaseName === 'middleware') {
      confidence -= 60;
    }

    // Config file exports
    if (this.isConfigFile(normalizedPath)) {
      confidence -= 70; // Config files are loaded by tools
    }

    // ==================== General Patterns ====================

    // Lower confidence for index files (often re-export for external use)
    if (fileName.startsWith('index.')) {
      confidence -= 30;
    }

    // Lower confidence for default exports (commonly used by external tools)
    if (exp.isDefault) {
      // But only if not already handled by framework detection
      if (!ALL_FRAMEWORK_SPECIAL_FILES.has(fileBaseName)) {
        confidence -= 10;
      }
    }

    // Lower confidence for exports in entry-point-like files
    if (this.tier2.isEntryPoint(exp.filePath)) {
      confidence -= 25;
    }

    // Lower confidence for type exports (might be used by external type consumers)
    if (exp.exportedName.endsWith('Type') || exp.exportedName.endsWith('Interface') ||
        exp.exportedName.endsWith('Props') || exp.exportedName.startsWith('I')) {
      confidence -= 15;
    }

    // Lower confidence for commonly expected exports
    const commonExports = ['default', 'config', 'options', 'settings', 'schema'];
    if (commonExports.includes(exp.exportedName.toLowerCase())) {
      confidence -= 15;
    }

    // Ensure confidence stays in valid range
    return Math.max(5, Math.min(100, confidence));
  }

  /**
   * Check if a file is a config file (loaded by tools, not imported).
   */
  private isConfigFile(normalizedPath: string): boolean {
    return CONFIG_FILE_PATTERNS.some(pattern => pattern.test(normalizedPath));
  }

  /**
   * Check if a file is in a framework-managed directory.
   */
  private isFrameworkFile(normalizedPath: string): boolean {
    const fileName = normalizedPath.split('/').pop() || '';
    const baseName = fileName.replace(/\.(ts|tsx|js|jsx|py|rb)$/, '');

    // Check if file is in a framework directory
    for (const dir of FRAMEWORK_DIRS) {
      if (normalizedPath.includes(dir)) {
        // If in framework dir and has special file name, it's framework-managed
        if (ALL_FRAMEWORK_SPECIAL_FILES.has(baseName)) {
          return true;
        }
      }
    }

    // Next.js App Router files
    if (normalizedPath.includes('/app/')) {
      if (ALL_FRAMEWORK_SPECIAL_FILES.has(baseName)) {
        return true;
      }
    }

    // Next.js Pages Router - all files are routes
    if (normalizedPath.includes('/pages/') && !normalizedPath.includes('/pages/api/')) {
      return true;
    }

    // SvelteKit routes
    if (normalizedPath.includes('/routes/') && baseName.startsWith('+')) {
      return true;
    }

    // Nuxt pages
    if (normalizedPath.includes('/pages/') || normalizedPath.includes('/composables/') || normalizedPath.includes('/plugins/')) {
      return true;
    }

    // Python special files
    if (baseName === '__init__' || baseName === '__main__' || baseName === 'conftest') {
      return true;
    }

    // Django migrations
    if (normalizedPath.includes('/migrations/') && baseName !== '__init__') {
      return true;
    }

    // Alembic migrations
    if (normalizedPath.includes('/alembic/') || normalizedPath.includes('/versions/')) {
      return true;
    }

    return false;
  }

  /**
   * Calculate confidence that a file is truly unused.
   */
  private calculateFileConfidence(filePath: string, isEntryPoint: boolean, exportCount: number): number {
    let confidence = 85; // Start reasonably high

    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    const fileName = normalizedPath.split('/').pop() || '';
    const fileBaseName = fileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // ==================== Framework Detection ====================

    // Next.js special files in app/ or pages/ directories
    if (ALL_FRAMEWORK_SPECIAL_FILES.has(fileBaseName)) {
      if (normalizedPath.includes('/app/') || normalizedPath.includes('/pages/')) {
        confidence -= 70; // Framework-managed files
      }
    }

    // Middleware file at root
    if (fileBaseName === 'middleware' && (
      normalizedPath.includes('/src/middleware') ||
      normalizedPath.endsWith('/middleware.ts') ||
      normalizedPath.endsWith('/middleware.js')
    )) {
      confidence -= 70;
    }

    // Config files
    if (this.isConfigFile(normalizedPath)) {
      confidence -= 70;
    }

    // ==================== General Patterns ====================

    // Entry points are likely used externally
    if (isEntryPoint) {
      confidence -= 50;
    }

    // Files with many exports are more likely to be libraries
    if (exportCount > 10) {
      confidence -= 15;
    } else if (exportCount > 5) {
      confidence -= 10;
    }

    // Files with no exports might be side-effect modules
    if (exportCount === 0) {
      confidence -= 20;
    }

    // Type definition files might be used by external tools
    if (normalizedPath.endsWith('.d.ts')) {
      confidence -= 30;
    }

    // Files in certain directories are more likely to be used externally
    if (normalizedPath.includes('/types/') || normalizedPath.includes('/interfaces/')) {
      confidence -= 20;
    }

    // Test files are run by test frameworks
    if (normalizedPath.includes('.test.') || normalizedPath.includes('.spec.') ||
        normalizedPath.includes('__tests__/') || normalizedPath.includes('/test/') ||
        normalizedPath.includes('/tests/')) {
      confidence -= 50;
    }

    return Math.max(5, Math.min(100, confidence));
  }

  /**
   * Check if a file is a code file (not config, data, etc.)
   */
  private isCodeFile(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const codeExtensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java'];
    return codeExtensions.includes(ext || '');
  }
}
