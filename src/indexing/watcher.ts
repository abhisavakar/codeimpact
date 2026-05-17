import chokidar, { type FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { relative } from 'path';

export interface FileEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  relativePath: string;
}

/**
 * Convert glob-style ignore patterns (e.g. `** /node_modules/**`) into a
 * function matcher that chokidar v4 understands.
 * Chokidar v4 treats plain strings as *literal* filename matches, not globs.
 * We convert `** /{name}/**` patterns into a fast path-segment check.
 */
function buildIgnoreMatcher(patterns: string[]): (path: string) => boolean {
  // Extract unique directory segment names from `** /{name}/**` or `** /{name}/*` patterns
  const segments = new Set<string>();

  for (const p of patterns) {
    // Match patterns like **/node_modules/** or **/venv/**
    const m = p.match(/^\*\*\/([^/*]+)\/\*\*?$/);
    if (m && m[1]) {
      segments.add(m[1]);
    }
    // Match patterns like **/.env.* or **/*.min.js (skip — not directory patterns)
  }

  // Also add hard-coded critical exclusions as safety net
  for (const s of ['node_modules', '.git', 'venv', '.venv', 'env', '__pycache__', 'vendor', 'knowledge', '.next', '.nuxt']) {
    segments.add(s);
  }

  const segmentArray = [...segments];

  return (testPath: string): boolean => {
    // Normalise to forward slashes for consistent matching
    const normalised = testPath.replace(/\\/g, '/');
    for (const seg of segmentArray) {
      if (normalised.includes('/' + seg + '/') || normalised.endsWith('/' + seg) || normalised === seg) {
        return true;
      }
    }
    return false;
  };
}

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private projectPath: string;
  private ignorePatterns: string[];

  constructor(projectPath: string, ignorePatterns: string[] = []) {
    super();
    this.projectPath = projectPath;
    this.ignorePatterns = ignorePatterns;
  }

  start(): void {
    if (this.watcher) {
      return;
    }

    // Build a function-based ignore matcher compatible with chokidar v4
    const ignoreFn = buildIgnoreMatcher(this.ignorePatterns);

    this.watcher = chokidar.watch(this.projectPath, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        ignoreFn,
      ],
      persistent: true,
      ignoreInitial: true, // Don't emit 'add' for existing files — initial index uses glob
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      },
      usePolling: false, // Use native events when possible
      depth: 20 // Limit recursion depth
    });

    this.watcher
      .on('add', (path) => this.handleEvent('add', path))
      .on('change', (path) => this.handleEvent('change', path))
      .on('unlink', (path) => this.handleEvent('unlink', path))
      .on('error', (error) => {
        console.error('File watcher error:', error);
        this.emit('error', error);
      })
      .on('ready', () => {
        console.error('File watcher ready');
        this.emit('ready');
      });
  }

  private handleEvent(type: 'add' | 'change' | 'unlink', path: string): void {
    // Normalise to forward slashes for consistent DB lookups on Windows
    const relativePath = relative(this.projectPath, path).replace(/\\/g, '/');

    const event: FileEvent = {
      type,
      path,
      relativePath
    };

    this.emit('file', event);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  isRunning(): boolean {
    return this.watcher !== null;
  }
}
