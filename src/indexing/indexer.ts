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
      const content = readFileSync(absolutePath, 'utf-8');
      const stats = statSync(absolutePath);
      const relativePath = relative(this.config.projectPath, absolutePath);

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
        Math.floor(stats.mtimeMs)
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
              const targetFile = this.tier2.resolveImportToFile(relativePath, imp.importedFrom);
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

      this.emit('indexingComplete', {
        total: checked,
        indexed,
        skipped: checked - indexed
      });
    } finally {
      this.isIndexing = false;
    }
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
