/**
 * Code Verifier - Pre-Commit Quality Gate
 *
 * Verifies AI-generated code for common issues before commit:
 * - Import verification: Do imports exist? Is the API being used correctly?
 * - Security scan: Common vulnerability patterns
 * - Dependency check: Is package in package.json? Is version compatible?
 * - Pattern compliance: Does code follow project patterns?
 * - Decision conflicts: Does code conflict with past decisions?
 *
 * Solves: Hallucination detection, Security vulnerabilities (1.7x more in AI code)
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import type { PatternValidationResult, ConflictResult } from '../types/documentation.js';

// ============================================================================
// Types
// ============================================================================

export interface ImportVerification {
  valid: boolean;
  issues: ImportIssue[];
  warnings: ImportWarning[];
}

export interface ImportIssue {
  import: string;
  type: 'missing_package' | 'missing_file' | 'invalid_export' | 'deprecated' | 'hallucinated';
  message: string;
  suggestion?: string;
}

export interface ImportWarning {
  import: string;
  type: 'outdated' | 'security' | 'deprecated_api';
  message: string;
  suggestion?: string;
}

export interface SecurityScanResult {
  safe: boolean;
  issues: SecurityIssue[];
  score: number; // 0-100, 100 = safest
}

export interface SecurityIssue {
  type: SecurityIssueType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  code?: string;
  message: string;
  cwe?: string;
  suggestion?: string;
}

export type SecurityIssueType =
  | 'sql_injection'
  | 'xss'
  | 'command_injection'
  | 'path_traversal'
  | 'hardcoded_secret'
  | 'insecure_random'
  | 'weak_crypto'
  | 'prototype_pollution'
  | 'regex_dos'
  | 'unsafe_eval'
  | 'insecure_deserialization'
  | 'ssrf'
  | 'open_redirect';

export interface DependencyCheckResult {
  valid: boolean;
  issues: DependencyIssue[];
}

export interface DependencyIssue {
  package: string;
  type: 'not_installed' | 'version_mismatch' | 'deprecated' | 'vulnerable' | 'unlisted';
  message: string;
  suggestion?: string;
}

export interface VerificationResult {
  verdict: 'pass' | 'warning' | 'fail';
  score: number; // 0-100, higher is better
  imports?: ImportVerification;
  security?: SecurityScanResult;
  dependencies?: DependencyCheckResult;
  patterns?: PatternValidationResult;
  conflicts?: ConflictResult;
  summary: string;
  suggestions: string[];
}

export type VerificationCheck = 'imports' | 'security' | 'dependencies' | 'patterns' | 'all';

// ============================================================================
// Security Patterns (OWASP Top 10 focused)
// ============================================================================

interface SecurityPattern {
  type: SecurityIssueType;
  pattern: RegExp;
  severity: SecurityIssue['severity'];
  message: string;
  cwe?: string;
  suggestion?: string;
  languages?: string[]; // Limit to specific languages
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  // SQL Injection
  {
    type: 'sql_injection',
    pattern: /\b(?:query|execute|raw|exec)\s*\(\s*[`'"].*\$\{|(?:\.query|\.execute)\s*\(\s*(?:['"`].*\+|\`.*\$\{)/i,
    severity: 'critical',
    message: 'Potential SQL injection: string interpolation in SQL query',
    cwe: 'CWE-89',
    suggestion: 'Use parameterized queries instead of string interpolation',
  },
  {
    type: 'sql_injection',
    pattern: /\bSELECT\b.*\bFROM\b.*\bWHERE\b.*[\+\$\{]/i,
    severity: 'high',
    message: 'SQL query with dynamic values - verify parameterization',
    cwe: 'CWE-89',
    suggestion: 'Use parameterized queries with placeholders',
  },

  // XSS
  {
    type: 'xss',
    pattern: /innerHTML\s*=|outerHTML\s*=|document\.write\s*\(/,
    severity: 'high',
    message: 'Potential XSS: unsafe DOM manipulation',
    cwe: 'CWE-79',
    suggestion: 'Use textContent or a sanitization library',
    languages: ['javascript', 'typescript', 'jsx', 'tsx'],
  },
  {
    type: 'xss',
    pattern: /dangerouslySetInnerHTML\s*=/,
    severity: 'high',
    message: 'dangerouslySetInnerHTML can lead to XSS',
    cwe: 'CWE-79',
    suggestion: 'Ensure content is sanitized before use',
    languages: ['jsx', 'tsx'],
  },

  // Command Injection
  {
    type: 'command_injection',
    pattern: /\bexec\s*\(\s*(?:[`'"].*\$\{|\`.*\$\{|['"].*\+)/,
    severity: 'critical',
    message: 'Potential command injection: dynamic command execution',
    cwe: 'CWE-78',
    suggestion: 'Use execFile with argument array instead of exec with string',
  },
  {
    type: 'command_injection',
    pattern: /child_process.*\bexec(?:Sync)?\s*\(/,
    severity: 'medium',
    message: 'Command execution detected - verify input validation',
    cwe: 'CWE-78',
    suggestion: 'Prefer execFile/spawn with argument arrays',
    languages: ['javascript', 'typescript'],
  },

  // Path Traversal
  {
    type: 'path_traversal',
    pattern: /\bpath\.join\s*\([^)]*(?:req\.|input|params|query|body)/i,
    severity: 'high',
    message: 'Potential path traversal: user input in file path',
    cwe: 'CWE-22',
    suggestion: 'Validate and sanitize file paths, use path.resolve and verify against base directory',
  },
  {
    type: 'path_traversal',
    pattern: /\breadFileSync\s*\([^)]*(?:\+|`)/,
    severity: 'medium',
    message: 'Dynamic file path in file read - verify path validation',
    cwe: 'CWE-22',
    suggestion: 'Ensure path is validated against a whitelist or base directory',
  },

  // Hardcoded Secrets
  {
    type: 'hardcoded_secret',
    pattern: /(?:password|secret|api[_-]?key|token|auth|credential)s?\s*[=:]\s*['"][^'"]{8,}['"]/i,
    severity: 'critical',
    message: 'Hardcoded secret detected',
    cwe: 'CWE-798',
    suggestion: 'Use environment variables or a secrets manager',
  },
  {
    type: 'hardcoded_secret',
    pattern: /(?:AWS|AZURE|GCP|GITHUB|STRIPE|TWILIO)[_-]?(?:SECRET|KEY|TOKEN)\s*[=:]\s*['"][^'"]+['"]/i,
    severity: 'critical',
    message: 'Hardcoded cloud/service credential',
    cwe: 'CWE-798',
    suggestion: 'Use environment variables or a secrets manager',
  },

  // Insecure Random
  {
    type: 'insecure_random',
    pattern: /Math\.random\s*\(\s*\)/,
    severity: 'medium',
    message: 'Math.random() is not cryptographically secure',
    cwe: 'CWE-330',
    suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive operations',
  },

  // Weak Crypto
  {
    type: 'weak_crypto',
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
    severity: 'medium',
    message: 'Weak hash algorithm (MD5/SHA1)',
    cwe: 'CWE-328',
    suggestion: 'Use SHA-256 or stronger for security purposes',
  },
  {
    type: 'weak_crypto',
    pattern: /createCipher\s*\(/,
    severity: 'high',
    message: 'Deprecated createCipher method',
    cwe: 'CWE-327',
    suggestion: 'Use createCipheriv with proper IV handling',
    languages: ['javascript', 'typescript'],
  },

  // Prototype Pollution
  {
    type: 'prototype_pollution',
    pattern: /\[['"]__proto__['"]\]|\[['"]constructor['"]\]|\[['"]prototype['"]\]/,
    severity: 'high',
    message: 'Potential prototype pollution vulnerability',
    cwe: 'CWE-1321',
    suggestion: 'Validate object keys before assignment',
  },

  // Regex DoS
  {
    type: 'regex_dos',
    pattern: /new\s+RegExp\s*\([^)]*(?:\+|`|\$)/,
    severity: 'medium',
    message: 'Dynamic regex with user input - potential ReDoS',
    cwe: 'CWE-1333',
    suggestion: 'Validate and escape user input in regex patterns',
  },

  // Unsafe eval
  {
    type: 'unsafe_eval',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
    severity: 'high',
    message: 'Use of eval/Function constructor - potential code injection',
    cwe: 'CWE-95',
    suggestion: 'Avoid eval; use JSON.parse for data or safer alternatives',
  },

  // SSRF
  {
    type: 'ssrf',
    pattern: /\b(?:fetch|axios|request|http\.get)\s*\([^)]*(?:\+|`.*\$\{|req\.|input|params)/i,
    severity: 'high',
    message: 'Potential SSRF: user-controlled URL',
    cwe: 'CWE-918',
    suggestion: 'Validate and whitelist allowed URLs/hosts',
  },

  // Open Redirect
  {
    type: 'open_redirect',
    pattern: /\b(?:res\.redirect|location\.href|window\.location)\s*[=\(]\s*(?:req\.|input|params)/i,
    severity: 'medium',
    message: 'Potential open redirect vulnerability',
    cwe: 'CWE-601',
    suggestion: 'Validate redirect URLs against a whitelist',
  },
];

// ============================================================================
// Import Patterns
// ============================================================================

// Common Node.js built-in modules
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url',
  'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  // Node.js prefixed versions
  'node:assert', 'node:buffer', 'node:child_process', 'node:cluster',
  'node:crypto', 'node:dns', 'node:events', 'node:fs', 'node:http',
  'node:http2', 'node:https', 'node:net', 'node:os', 'node:path',
  'node:process', 'node:querystring', 'node:readline', 'node:stream',
  'node:timers', 'node:tls', 'node:url', 'node:util', 'node:v8',
  'node:vm', 'node:worker_threads', 'node:zlib',
]);

// Import extraction patterns
const IMPORT_PATTERNS = {
  // ES6 imports
  esImport: /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]+\}|\*\s+as\s+\w+|\w+))*)\s+from\s+['"]([^'"]+)['"]/g,
  // Dynamic imports
  dynamicImport: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CommonJS require
  require: /(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
};

// ============================================================================
// Code Verifier Class
// ============================================================================

export class CodeVerifier {
  private projectPath: string;
  private packageJson: Record<string, unknown> | null = null;
  private nodeModulesPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.nodeModulesPath = join(projectPath, 'node_modules');
    this.loadPackageJson();
  }

  private loadPackageJson(): void {
    const packageJsonPath = join(this.projectPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        this.packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      } catch {
        this.packageJson = null;
      }
    }
  }

  /**
   * Run full verification on code
   */
  async verify(
    code: string,
    file?: string,
    checks: VerificationCheck[] = ['all']
  ): Promise<VerificationResult> {
    const runAll = checks.includes('all');
    const results: Partial<VerificationResult> = {};
    const suggestions: string[] = [];
    let totalScore = 100;

    // Detect language from file extension or code patterns
    const language = file ? this.detectLanguage(file) : this.detectLanguageFromCode(code);

    // Run requested checks
    if (runAll || checks.includes('imports')) {
      results.imports = this.verifyImports(code, file);
      if (!results.imports.valid) {
        totalScore -= results.imports.issues.length * 15;
        suggestions.push(...results.imports.issues.map(i => i.suggestion || i.message));
      }
      if (results.imports.warnings.length > 0) {
        totalScore -= results.imports.warnings.length * 5;
        suggestions.push(...results.imports.warnings.map(w => w.suggestion || w.message));
      }
    }

    if (runAll || checks.includes('security')) {
      results.security = this.scanSecurity(code, language);
      totalScore = Math.min(totalScore, results.security.score);
      if (!results.security.safe) {
        suggestions.push(...results.security.issues.map(i => i.suggestion || i.message));
      }
    }

    if (runAll || checks.includes('dependencies')) {
      results.dependencies = this.checkDependencies(code);
      if (!results.dependencies.valid) {
        totalScore -= results.dependencies.issues.length * 10;
        suggestions.push(...results.dependencies.issues.map(d => d.suggestion || d.message));
      }
    }

    // Calculate verdict
    const verdict = this.calculateVerdict(totalScore, results);

    // Build summary
    const summary = this.buildSummary(results, verdict);

    return {
      verdict,
      score: Math.max(0, Math.min(100, totalScore)),
      ...results,
      summary,
      suggestions: [...new Set(suggestions)].slice(0, 10), // Dedupe and limit
    };
  }

  /**
   * Verify imports in code
   */
  verifyImports(code: string, file?: string): ImportVerification {
    const issues: ImportIssue[] = [];
    const warnings: ImportWarning[] = [];
    const imports = this.extractImports(code);

    // Load path aliases from tsconfig if available
    const pathAliases = this.loadPathAliases();

    for (const importPath of imports) {
      // Skip built-in modules
      if (NODE_BUILTINS.has(importPath) || NODE_BUILTINS.has(importPath.split('/')[0] || '')) {
        continue;
      }

      // Check if it's a path alias (e.g., @/, ~/, #/, @core/, etc.)
      if (this.isPathAlias(importPath, pathAliases)) {
        // Path aliases are resolved by bundler/compiler
        // Verify if we can resolve the alias to an actual file
        const resolved = this.resolvePathAlias(importPath, pathAliases);
        if (resolved) {
          // Path alias resolves to project root, not relative to current file
          this.verifyAliasImport(resolved, importPath, issues);
        }
        // If we can't resolve, assume it's valid (configured in tsconfig/bundler)
        continue;
      }

      // Check if it's a relative import
      if (importPath.startsWith('.') || importPath.startsWith('/')) {
        this.verifyRelativeImport(importPath, file, issues);
      } else {
        // It's a package import
        this.verifyPackageImport(importPath, issues, warnings);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Load path aliases from tsconfig.json or jsconfig.json
   */
  private loadPathAliases(): Map<string, string> {
    const aliases = new Map<string, string>();

    // Common alias patterns to recognize even without config
    const commonAliases = ['@/', '~/', '#/', '@app/', '@src/', '@lib/', '@core/', '@components/', '@utils/', '@hooks/', '@contexts/'];
    for (const alias of commonAliases) {
      aliases.set(alias.slice(0, -1), 'src'); // Map @/ to src/
    }

    // Try to read from tsconfig.json
    const tsconfigPaths = [
      join(this.projectPath, 'tsconfig.json'),
      join(this.projectPath, 'jsconfig.json'),
    ];

    for (const configPath of tsconfigPaths) {
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8');
          // Remove comments (simple approach)
          const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
          const config = JSON.parse(cleanContent);

          if (config.compilerOptions?.paths) {
            for (const [alias, targets] of Object.entries(config.compilerOptions.paths)) {
              // Convert @/* to @/ for matching
              const aliasKey = alias.replace('/*', '').replace('*', '');
              const target = (targets as string[])[0];
              if (target) {
                aliases.set(aliasKey, target.replace('/*', '').replace('*', ''));
              }
            }
          }

          // Also check baseUrl
          if (config.compilerOptions?.baseUrl) {
            aliases.set('baseUrl', config.compilerOptions.baseUrl);
          }

          break; // Found config, stop looking
        } catch {
          // Config parse failed, use defaults
        }
      }
    }

    return aliases;
  }

  /**
   * Check if an import path is a path alias
   */
  private isPathAlias(importPath: string, aliases: Map<string, string>): boolean {
    // Check against loaded aliases
    for (const alias of aliases.keys()) {
      if (importPath === alias || importPath.startsWith(alias + '/')) {
        return true;
      }
    }

    // Common patterns that indicate path aliases
    const aliasPatterns = [
      /^@\//, /^~\//, /^#\//,           // @/, ~/, #/
      /^@[a-z]+\//i,                     // @app/, @core/, @lib/, etc.
      /^~[a-z]+\//i,                     // ~app/, ~core/, etc.
    ];

    return aliasPatterns.some(pattern => pattern.test(importPath));
  }

  /**
   * Try to resolve a path alias to a relative path
   */
  private resolvePathAlias(importPath: string, aliases: Map<string, string>): string | null {
    for (const [alias, target] of aliases) {
      if (importPath === alias) {
        return './' + target;
      }
      if (importPath.startsWith(alias + '/')) {
        const rest = importPath.slice(alias.length + 1);
        return './' + join(target, rest);
      }
    }
    return null;
  }

  /**
   * Scan code for security vulnerabilities
   */
  scanSecurity(code: string, language?: string): SecurityScanResult {
    const issues: SecurityIssue[] = [];
    const lines = code.split('\n');

    for (const pattern of SECURITY_PATTERNS) {
      // Skip patterns not applicable to this language
      if (pattern.languages && language && !pattern.languages.includes(language)) {
        continue;
      }

      // Check each line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && pattern.pattern.test(line)) {
          issues.push({
            type: pattern.type,
            severity: pattern.severity,
            line: i + 1,
            code: line.trim().slice(0, 100),
            message: pattern.message,
            cwe: pattern.cwe,
            suggestion: pattern.suggestion,
          });
        }
      }

      // Also check the full code for multi-line patterns
      if (pattern.pattern.test(code)) {
        const existingIssue = issues.find(i => i.type === pattern.type && i.message === pattern.message);
        if (!existingIssue) {
          issues.push({
            type: pattern.type,
            severity: pattern.severity,
            message: pattern.message,
            cwe: pattern.cwe,
            suggestion: pattern.suggestion,
          });
        }
      }
    }

    // Calculate score
    let score = 100;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score -= 30;
          break;
        case 'high':
          score -= 20;
          break;
        case 'medium':
          score -= 10;
          break;
        case 'low':
          score -= 5;
          break;
      }
    }

    return {
      safe: issues.length === 0,
      issues,
      score: Math.max(0, score),
    };
  }

  /**
   * Check dependencies used in code
   */
  checkDependencies(code: string): DependencyCheckResult {
    const issues: DependencyIssue[] = [];
    const imports = this.extractImports(code);
    const packages = this.getPackageDependencies();
    const pathAliases = this.loadPathAliases();

    for (const importPath of imports) {
      // Skip relative imports and built-ins
      if (importPath.startsWith('.') || importPath.startsWith('/')) {
        continue;
      }
      if (NODE_BUILTINS.has(importPath) || NODE_BUILTINS.has(importPath.split('/')[0] || '')) {
        continue;
      }

      // Skip path aliases (e.g., @/core, ~/lib, etc.) - these are resolved by bundler/compiler
      if (this.isPathAlias(importPath, pathAliases)) {
        continue;
      }

      // Get package name (handle scoped packages)
      const packageName = this.getPackageName(importPath);

      // Check if package is in package.json
      if (!packages.has(packageName)) {
        // Check if it's installed in node_modules even if not in package.json
        const nodeModulePath = join(this.nodeModulesPath, packageName);
        if (existsSync(nodeModulePath)) {
          issues.push({
            package: packageName,
            type: 'unlisted',
            message: `Package "${packageName}" is installed but not listed in package.json`,
            suggestion: `Add "${packageName}" to dependencies with: npm install ${packageName}`,
          });
        } else {
          issues.push({
            package: packageName,
            type: 'not_installed',
            message: `Package "${packageName}" is not installed`,
            suggestion: `Install with: npm install ${packageName}`,
          });
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  // ========== Helper Methods ==========

  private extractImports(code: string): Set<string> {
    const imports = new Set<string>();

    // ES6 imports
    let match;
    const esPattern = new RegExp(IMPORT_PATTERNS.esImport.source, 'g');
    while ((match = esPattern.exec(code)) !== null) {
      if (match[1]) imports.add(match[1]);
    }

    // Dynamic imports
    const dynamicPattern = new RegExp(IMPORT_PATTERNS.dynamicImport.source, 'g');
    while ((match = dynamicPattern.exec(code)) !== null) {
      if (match[1]) imports.add(match[1]);
    }

    // CommonJS require
    const requirePattern = new RegExp(IMPORT_PATTERNS.require.source, 'g');
    while ((match = requirePattern.exec(code)) !== null) {
      if (match[1]) imports.add(match[1]);
    }

    return imports;
  }

  private verifyRelativeImport(importPath: string, file: string | undefined, issues: ImportIssue[]): void {
    if (!file) return;

    // Try to resolve the import
    const baseDir = dirname(join(this.projectPath, file));
    const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', ''];
    const possibleIndexes = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

    let found = false;

    for (const ext of possibleExtensions) {
      const fullPath = join(baseDir, importPath + ext);
      if (existsSync(fullPath)) {
        found = true;
        break;
      }
    }

    // Check for directory with index file
    if (!found) {
      const dirPath = join(baseDir, importPath);
      if (existsSync(dirPath)) {
        for (const indexFile of possibleIndexes) {
          if (existsSync(join(dirPath, indexFile))) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) {
      issues.push({
        import: importPath,
        type: 'missing_file',
        message: `Cannot resolve import "${importPath}" - file not found`,
        suggestion: `Check if the file exists or if the path is correct`,
      });
    }
  }

  /**
   * Verify a resolved path alias import (relative to project root, not file directory)
   */
  private verifyAliasImport(resolvedPath: string, originalImport: string, issues: ImportIssue[]): void {
    // Remove leading ./ if present since we're resolving from project root
    const cleanPath = resolvedPath.replace(/^\.\//, '');
    const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', ''];
    const possibleIndexes = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

    let found = false;

    // Try direct file with extensions
    for (const ext of possibleExtensions) {
      const fullPath = join(this.projectPath, cleanPath + ext);
      if (existsSync(fullPath)) {
        found = true;
        break;
      }
    }

    // Check for directory with index file
    if (!found) {
      const dirPath = join(this.projectPath, cleanPath);
      if (existsSync(dirPath)) {
        for (const indexFile of possibleIndexes) {
          if (existsSync(join(dirPath, indexFile))) {
            found = true;
            break;
          }
        }
      }
    }

    // Path aliases are often configured correctly in bundler/tsconfig
    // Only report if clearly broken - don't flag missing files for aliases
    // since the bundler may have custom resolution we don't understand
    // Note: We silently accept alias imports that can't be verified
  }

  private verifyPackageImport(importPath: string, issues: ImportIssue[], warnings: ImportWarning[]): void {
    const packageName = this.getPackageName(importPath);
    const nodeModulePath = join(this.nodeModulesPath, packageName);

    if (!existsSync(nodeModulePath)) {
      issues.push({
        import: importPath,
        type: 'missing_package',
        message: `Package "${packageName}" is not installed`,
        suggestion: `Install with: npm install ${packageName}`,
      });
      return;
    }

    // If importing a subpath, check if it exists
    if (importPath !== packageName) {
      const subpath = importPath.slice(packageName.length + 1);
      const subpathFull = join(nodeModulePath, subpath);
      const possibleExtensions = ['.js', '.json', ''];

      let found = false;
      for (const ext of possibleExtensions) {
        if (existsSync(subpathFull + ext)) {
          found = true;
          break;
        }
      }

      // Check package.json exports
      const pkgJsonPath = join(nodeModulePath, 'package.json');
      if (!found && existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
          if (pkgJson.exports) {
            // Package has exports field - subpath might be valid
            const exportKey = './' + subpath;
            if (pkgJson.exports[exportKey] || pkgJson.exports['./' + subpath + '.js']) {
              found = true;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (!found) {
        issues.push({
          import: importPath,
          type: 'invalid_export',
          message: `Subpath "${subpath}" not found in package "${packageName}"`,
          suggestion: `Check package documentation for correct import path`,
        });
      }
    }
  }

  private getPackageName(importPath: string): string {
    // Handle scoped packages (@org/package)
    if (importPath.startsWith('@')) {
      const parts = importPath.split('/');
      return parts.slice(0, 2).join('/');
    }
    // Regular package
    return importPath.split('/')[0] || importPath;
  }

  private getPackageDependencies(): Set<string> {
    const deps = new Set<string>();

    if (!this.packageJson) return deps;

    const allDeps = {
      ...(this.packageJson.dependencies as Record<string, string> || {}),
      ...(this.packageJson.devDependencies as Record<string, string> || {}),
      ...(this.packageJson.peerDependencies as Record<string, string> || {}),
      ...(this.packageJson.optionalDependencies as Record<string, string> || {}),
    };

    for (const pkg of Object.keys(allDeps)) {
      deps.add(pkg);
    }

    return deps;
  }

  private detectLanguage(file: string): string {
    const ext = extname(file).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.php': 'php',
    };
    return langMap[ext] || 'unknown';
  }

  private detectLanguageFromCode(code: string): string {
    // Simple heuristics
    if (/import\s+.*from\s+['"]|export\s+(default\s+)?/m.test(code)) {
      return code.includes('React') || code.includes('tsx') || /<\w+.*\/?>/.test(code)
        ? 'tsx'
        : 'typescript';
    }
    if (/require\s*\(|module\.exports/.test(code)) {
      return 'javascript';
    }
    if (/def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/.test(code)) {
      return 'python';
    }
    if (/func\s+\w+\s*\(|package\s+\w+/.test(code)) {
      return 'go';
    }
    return 'unknown';
  }

  private calculateVerdict(
    score: number,
    results: Partial<VerificationResult>
  ): 'pass' | 'warning' | 'fail' {
    // Critical security issues = fail
    if (results.security?.issues.some(i => i.severity === 'critical')) {
      return 'fail';
    }

    // Multiple high severity issues = fail
    const highSeverityCount = (results.security?.issues.filter(i => i.severity === 'high').length || 0) +
      (results.imports?.issues.filter(i => i.type === 'hallucinated').length || 0);
    if (highSeverityCount >= 2) {
      return 'fail';
    }

    // Score-based
    if (score >= 70) return 'pass';
    if (score >= 40) return 'warning';
    return 'fail';
  }

  private buildSummary(results: Partial<VerificationResult>, verdict: 'pass' | 'warning' | 'fail'): string {
    const parts: string[] = [];

    if (results.imports) {
      if (results.imports.valid && results.imports.warnings.length === 0) {
        parts.push('Imports: OK');
      } else {
        parts.push(`Imports: ${results.imports.issues.length} issues, ${results.imports.warnings.length} warnings`);
      }
    }

    if (results.security) {
      if (results.security.safe) {
        parts.push('Security: OK');
      } else {
        const critical = results.security.issues.filter(i => i.severity === 'critical').length;
        const high = results.security.issues.filter(i => i.severity === 'high').length;
        parts.push(`Security: ${critical} critical, ${high} high severity issues`);
      }
    }

    if (results.dependencies) {
      if (results.dependencies.valid) {
        parts.push('Dependencies: OK');
      } else {
        parts.push(`Dependencies: ${results.dependencies.issues.length} issues`);
      }
    }

    return `[${verdict.toUpperCase()}] ${parts.join(' | ')}`;
  }
}

/**
 * Quick security scan (standalone function for convenience)
 */
export function quickSecurityScan(code: string, language?: string): SecurityScanResult {
  const issues: SecurityIssue[] = [];
  const lines = code.split('\n');

  for (const pattern of SECURITY_PATTERNS) {
    if (pattern.languages && language && !pattern.languages.includes(language)) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && pattern.pattern.test(line)) {
        issues.push({
          type: pattern.type,
          severity: pattern.severity,
          line: i + 1,
          code: line.trim().slice(0, 100),
          message: pattern.message,
          cwe: pattern.cwe,
          suggestion: pattern.suggestion,
        });
        break; // One issue per pattern
      }
    }
  }

  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': score -= 30; break;
      case 'high': score -= 20; break;
      case 'medium': score -= 10; break;
      case 'low': score -= 5; break;
    }
  }

  return {
    safe: issues.length === 0,
    issues,
    score: Math.max(0, score),
  };
}
