import { readFileSync, statSync } from 'fs';
import { glob } from 'glob';
import { join, relative } from 'path';
import { EventEmitter } from 'events';
import { EmbeddingGenerator } from './embeddings.js';
import { ASTParser } from './ast.js';
import { FileWatcher, type FileEvent } from './watcher.js';
import { Tier2Storage } from '../storage/tier2.js';
import { isCodeFile, detectLanguage, hashContent, getPreview, countLines } from '../utils/files.js';
import type { CodeImpactConfig, IndexingProgress } from '../types/index.js';

/**
 * Hard exclusion segments — if ANY of these appear as a path segment,
 * the file is unconditionally rejected.  This is the last-resort safety net
 * that works regardless of glob/chokidar ignore behaviour.
 */
const EXCLUDED_PATH_SEGMENTS = [
  'node_modules',
  '.git',
  'venv',
  '.venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  'vendor',
  '.gradle',
  'Pods',
  'DerivedData',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'knowledge',
];

/** Returns true if the given relative path should be excluded from indexing. */
function isExcludedPath(relPath: string): boolean {
  // Normalise to forward-slashes, split on separator
  const segments = relPath.replace(/\\/g, '/').split('/');
  return segments.some(seg => EXCLUDED_PATH_SEGMENTS.includes(seg));
}

export class Indexer extends EventEmitter {
  private config: CodeImpactConfig;
  private embeddingGenerator: EmbeddingGenerator;
  private astParser: ASTParser;
  private watcher: FileWatcher;
  private tier2: Tier2Storage;
  private isIndexing = false;
  private pendingFiles: Set<string> = new Set();
  private processTimeout: NodeJS.Timeout | null = null;

  constructor(config: CodeImpactConfig, tier2: Tier2Storage) {
    super();
    this.config = config;
    this.tier2 = tier2;
    this.embeddingGenerator = new EmbeddingGenerator(config.embeddingModel);
    this.astParser = new ASTParser(config.dataDir);
    this.watcher = new FileWatcher(config.projectPath, config.watchIgnore);

    this.setupWatcher();
  }

  private setupWatcher(): void {
    this.watcher.on('file', (event: FileEvent) => {
      this.handleFileEvent(event);
    });

    this.watcher.on('ready', () => {
      this.emit('watcherReady');
    });

    this.watcher.on('error', (error) => {
      this.emit('error', error);
    });
  }

  private handleFileEvent(event: FileEvent): void {
    // Only process code files
    if (!isCodeFile(event.path)) {
      return;
    }

    if (event.type === 'unlink') {
      // File deleted
      this.tier2.deleteFile(event.relativePath);
      this.emit('fileRemoved', event.relativePath);
      return;
    }

    // Add or change - queue for processing
    this.pendingFiles.add(event.path);
    this.schedulePendingProcessing();
  }

  private schedulePendingProcessing(): void {
    // Debounce processing
    if (this.processTimeout) {
      clearTimeout(this.processTimeout);
    }

    this.processTimeout = setTimeout(() => {
      this.processPendingFiles();
    }, 500);
  }

  private async processPendingFiles(): Promise<void> {
    if (this.isIndexing || this.pendingFiles.size === 0) {
      return;
    }

    const files = Array.from(this.pendingFiles);
    this.pendingFiles.clear();

    for (const file of files) {
      try {
        await this.indexFile(file);
      } catch (error) {
        console.error(`Error indexing ${file}:`, error);
      }
    }
  }

  async indexFile(absolutePath: string): Promise<boolean> {
    try {
      // Normalise to forward slashes so DB paths are consistent across platforms.
      // On Windows, path.relative() returns backslashes which breaks SQL lookups.
      const relativePath = relative(this.config.projectPath, absolutePath).replace(/\\/g, '/');

      // Hard safety-net: reject excluded paths regardless of how they arrived
      if (isExcludedPath(relativePath)) {
        return false;
      }

      const content = readFileSync(absolutePath, 'utf-8');
      const stats = statSync(absolutePath);

      const contentHash = hashContent(content);
      const existingFile = this.tier2.getFile(relativePath);

      // Skip if content hasn't changed
      if (existingFile && existingFile.contentHash === contentHash) {
        return false; // Not indexed, skipped
      }

      const language = detectLanguage(absolutePath);
      const preview = getPreview(content);
      const lineCount = countLines(content);

      // Store file metadata
      const fileId = this.tier2.upsertFile(
        relativePath,
        contentHash,
        preview,
        language,
        stats.size,
        lineCount,
        Math.floor(stats.mtimeMs / 1000)
      );

      // Generate and store embedding
      const embedding = await this.embeddingGenerator.embed(content);
      this.tier2.upsertEmbedding(fileId, embedding);

      // Phase 2: Parse AST and extract symbols
      try {
        const parsed = await this.astParser.parseFile(relativePath, content);
        if (parsed) {
          // Clear old symbols/imports/exports for this file
          this.tier2.clearSymbols(fileId);
          this.tier2.clearImports(fileId);
          this.tier2.clearExports(fileId);

          // Insert new symbols with fileId
          if (parsed.symbols.length > 0) {
            const symbolsWithFileId = parsed.symbols.map(s => ({ ...s, fileId }));
            this.tier2.insertSymbols(symbolsWithFileId);
          }

          // Insert imports with fileId
          if (parsed.imports.length > 0) {
            const importsWithFileId = parsed.imports.map(i => ({ ...i, fileId }));
            this.tier2.insertImports(importsWithFileId);
          }

          // Insert exports with fileId
          if (parsed.exports.length > 0) {
            const exportsWithFileId = parsed.exports.map(e => ({ ...e, fileId }));
            this.tier2.insertExports(exportsWithFileId);
          }

          // Build dependency edges from imports
          if (parsed.imports.length > 0) {
            this.tier2.clearDependencies(fileId);
            for (const imp of parsed.imports) {
              const targetFile = this.tier2.resolveImportToFile(relativePath, imp.importedFrom, this.config.projectPath);
              if (targetFile) {
                this.tier2.addDependency(fileId, targetFile.id, 'imports');
              }
            }
          }
        }
      } catch (astError) {
        // AST parsing is optional, don't fail the whole index
        console.error(`AST parsing failed for ${relativePath}:`, astError);
      }

      this.emit('fileIndexed', relativePath);

      // Emit impact warning for changed files (not during initial indexing)
      if (!this.isIndexing) {
        const dependents = this.tier2.getFileDependents(relativePath);
        if (dependents.length > 0) {
          this.emit('fileImpact', {
            file: relativePath,
            affectedFiles: dependents.map(d => d.file),
            affectedCount: dependents.length,
            imports: dependents.map(d => ({ file: d.file, symbols: d.imports }))
          });
        }
      }

      return true; // Actually indexed
    } catch (error) {
      console.error(`Error indexing ${absolutePath}:`, error);
      this.emit('indexError', { path: absolutePath, error });
      return false;
    }
  }

  async performInitialIndex(): Promise<void> {
    if (this.isIndexing) {
      return;
    }

    this.isIndexing = true;
    this.emit('indexingStarted');

    try {
      // Purge any previously-indexed files that match exclusion patterns
      // (node_modules, venv, etc.). This cleans stale data from older versions.
      const purged = this.tier2.purgeExcludedFiles();
      if (purged > 0) {
        console.error(`[Index] Purged ${purged} excluded files from database`);
      }

      // Find all code files
      const patterns = [
        '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs',
        '**/*.py', '**/*.rb', '**/*.go', '**/*.rs', '**/*.java', '**/*.kt',
        '**/*.cs', '**/*.cpp', '**/*.c', '**/*.h', '**/*.hpp',
        '**/*.php', '**/*.swift', '**/*.vue', '**/*.svelte',
        '**/*.md', '**/*.json', '**/*.yaml', '**/*.yml',
        '**/*.sql', '**/*.sh', '**/*.dockerfile',
        '**/*.prisma', '**/*.graphql'
      ];

      const files: string[] = [];

      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          cwd: this.config.projectPath,
          ignore: this.config.watchIgnore,
          absolute: true,
          nodir: true
        });
        files.push(...matches);
      }

      // Deduplicate
      const uniqueFiles = [...new Set(files)];

      let checked = 0;
      let indexed = 0;
      const total = uniqueFiles.length;

      // Index files (only shows progress for actually indexed files)
      for (const file of uniqueFiles) {
        try {
          const wasIndexed = await this.indexFile(file);
          checked++;
          if (wasIndexed) {
            indexed++;
            this.emit('progress', { total, indexed, current: relative(this.config.projectPath, file) });
          }
        } catch (error) {
          console.error(`Error indexing ${file}:`, error);
        }
      }

      // Second pass: resolve dependencies now that ALL files are in the DB.
      // During the first pass, imports to not-yet-indexed files couldn't resolve.
      const depCount = this.rebuildDependencies();
      if (depCount > 0) {
        console.error(`[Index] Built ${depCount} dependency edges`);
      }

      this.emit('indexingComplete', {
        total: checked,
        indexed,
        skipped: checked - indexed
      });
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Rebuild all dependency edges from stored imports.
   * Run after initial indexing so all target files are in the DB.
   */
  private rebuildDependencies(): number {
    // Clear all existing deps and rebuild from imports table
    this.tier2.clearAllDependencies();

    const allImports = this.tier2.getAllImports();
    let count = 0;

    for (const imp of allImports) {
      const targetFile = this.tier2.resolveImportToFile(imp.filePath, imp.importedFrom, this.config.projectPath);
      if (targetFile) {
        this.tier2.addDependency(imp.fileId, targetFile.id, 'imports');
        count++;
      }
    }

    return count;
  }

  startWatching(): void {
    this.watcher.start();
  }

  stopWatching(): void {
    this.watcher.stop();
  }

  getEmbeddingGenerator(): EmbeddingGenerator {
    return this.embeddingGenerator;
  }

  isCurrentlyIndexing(): boolean {
    return this.isIndexing;
  }
}
