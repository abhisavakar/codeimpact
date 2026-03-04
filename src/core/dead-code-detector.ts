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

    // Estimate dead lines from unused files (excluding entry points)
    const estimatedDeadLines = unusedFiles
      .filter(f => !f.isEntryPoint && f.confidence >= 70)
      .reduce((sum, f) => sum + f.lineCount, 0);

    // Calculate overall confidence
    const highConfidenceExports = unusedExports.filter(e => e.confidence >= 80);
    const overallConfidence = unusedExports.length > 0
      ? Math.round(highConfidenceExports.length / unusedExports.length * 100)
      : 100;

    // Items safe to delete (high confidence)
    const safeToDelete = unusedExports.filter(e => e.confidence >= 85);

    return {
      unusedExports,
      unusedFiles,
      totalExports: allExports.length,
      totalFiles: allFiles.length,
      estimatedDeadLines,
      overallConfidence,
      safeToDelete,
    };
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

    // Lower confidence for index files (often re-export for external use)
    if (fileName.startsWith('index.')) {
      confidence -= 30;
    }

    // Lower confidence for default exports (commonly used by external tools)
    if (exp.isDefault) {
      confidence -= 10;
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
    return Math.max(10, Math.min(100, confidence));
  }

  /**
   * Calculate confidence that a file is truly unused.
   */
  private calculateFileConfidence(filePath: string, isEntryPoint: boolean, exportCount: number): number {
    let confidence = 85; // Start reasonably high

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

    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

    // Type definition files might be used by external tools
    if (normalizedPath.endsWith('.d.ts')) {
      confidence -= 30;
    }

    // Files in certain directories are more likely to be used externally
    if (normalizedPath.includes('/types/') || normalizedPath.includes('/interfaces/')) {
      confidence -= 20;
    }

    return Math.max(10, Math.min(100, confidence));
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
