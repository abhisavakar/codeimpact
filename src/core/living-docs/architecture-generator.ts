import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import type { Tier2Storage } from '../../storage/tier2.js';
import type {
  ArchitectureDoc,
  ArchitectureLayer,
  DataFlowStep,
  ComponentReference,
  DependencyInfo
} from '../../types/documentation.js';

export class ArchitectureGenerator {
  private projectPath: string;
  private tier2: Tier2Storage;

  // Layer name mappings (NO-AI)
  private static LAYER_MAPPING: Record<string, string> = {
    'server': 'API Layer',
    'api': 'API Layer',
    'routes': 'API Layer',
    'controllers': 'API Layer',
    'routers': 'API Layer',
    'core': 'Business Logic',
    'services': 'Business Logic',
    'domain': 'Business Logic',
    'modules': 'Business Logic',
    'storage': 'Data Layer',
    'db': 'Data Layer',
    'database': 'Data Layer',
    'repositories': 'Data Layer',
    'models': 'Data Layer',
    'alembic': 'Data Layer',
    'migrations': 'Data Layer',
    'utils': 'Utilities',
    'helpers': 'Utilities',
    'lib': 'Utilities',
    'types': 'Type Definitions',
    'interfaces': 'Type Definitions',
    'schemas': 'Type Definitions',
    'indexing': 'Indexing Layer',
    'search': 'Indexing Layer',
    'components': 'UI Components',
    'views': 'UI Components',
    'pages': 'UI Components',
    'app': 'UI Components',
    'hooks': 'React Hooks',
    'context': 'State Management',
    'store': 'State Management',
    'config': 'Configuration',
    'cli': 'CLI Interface',
    'commands': 'CLI Interface',
    'test': 'Testing',
    'tests': 'Testing',
    '__tests__': 'Testing',
    'spec': 'Testing',
    'infrastructure': 'Infrastructure',
    'docker': 'Infrastructure',
    'terraform': 'Infrastructure'
  };

  // Monorepo package patterns - directories that contain their own src/app structure
  private static MONOREPO_PATTERNS: RegExp[] = [
    /^.*[-_]?backend$/i,
    /^.*[-_]?frontend$/i,
    /^.*[-_]?api$/i,
    /^.*[-_]?web$/i,
    /^.*[-_]?app$/i,
    /^.*[-_]?server$/i,
    /^.*[-_]?client$/i,
    /^packages$/i,
    /^apps$/i,
  ];

  // Monorepo package to layer type mapping
  private static MONOREPO_LAYER_TYPES: Record<string, string> = {
    'backend': 'Backend',
    'frontend': 'Frontend',
    'api': 'Backend',
    'web': 'Frontend',
    'app': 'Application',
    'server': 'Backend',
    'client': 'Frontend',
  };

  // Layer purpose descriptions
  private static LAYER_PURPOSES: Record<string, string> = {
    'API Layer': 'Handles external requests and responses, routing, and protocol handling',
    'Business Logic': 'Core application logic, domain rules, and orchestration',
    'Data Layer': 'Data persistence, database access, and storage management',
    'Utilities': 'Shared utility functions and helper modules',
    'Type Definitions': 'TypeScript interfaces, types, and shared contracts',
    'Indexing Layer': 'Content indexing, search, and retrieval functionality',
    'UI Components': 'User interface components and presentation logic',
    'React Hooks': 'Custom React hooks for state and side effects',
    'State Management': 'Application state management and data flow',
    'Configuration': 'Application configuration and environment setup',
    'CLI Interface': 'Command-line interface and commands',
    'Testing': 'Test files and testing utilities',
    'Infrastructure': 'Infrastructure as code, deployment, and DevOps configuration',
    'Backend': 'Server-side application code and APIs',
    'Frontend': 'Client-side application code and UI',
    'Application': 'Main application code'
  };

  constructor(projectPath: string, tier2: Tier2Storage) {
    this.projectPath = projectPath;
    this.tier2 = tier2;
  }

  async generate(): Promise<ArchitectureDoc> {
    const layers = this.detectLayers();
    const keyComponents = this.extractKeyComponents(layers);
    const dataFlow = this.inferDataFlow(layers);
    const diagram = this.generateASCIIDiagram(layers, dataFlow);
    const dependencies = this.getProjectDependencies();

    return {
      name: basename(this.projectPath),
      description: this.inferDescription(layers, keyComponents),
      diagram,
      layers,
      dataFlow,
      keyComponents,
      dependencies,
      generatedAt: new Date()
    };
  }

  private detectLayers(): ArchitectureLayer[] {
    const layerMap = new Map<string, ArchitectureLayer>();

    // First, check for monorepo structure at root
    const monorepoPackages = this.detectMonorepoPackages();

    if (monorepoPackages.length > 0) {
      // Monorepo: scan inside each package
      for (const pkg of monorepoPackages) {
        this.scanDirectoryForLayers(pkg.path, layerMap, pkg.name);
      }
    } else {
      // Standard project: scan src/ or root
      const srcDir = existsSync(join(this.projectPath, 'src'))
        ? join(this.projectPath, 'src')
        : this.projectPath;
      this.scanDirectoryForLayers(srcDir, layerMap);
    }

    // Sort layers by typical architecture order
    const layerOrder = [
      'Backend',
      'Frontend',
      'Application',
      'CLI Interface',
      'API Layer',
      'UI Components',
      'React Hooks',
      'State Management',
      'Business Logic',
      'Indexing Layer',
      'Data Layer',
      'Configuration',
      'Type Definitions',
      'Utilities',
      'Infrastructure',
      'Testing'
    ];

    const layers: ArchitectureLayer[] = [];
    for (const layerName of layerOrder) {
      if (layerMap.has(layerName)) {
        layers.push(layerMap.get(layerName)!);
      }
    }

    // Add any remaining layers not in the order list
    for (const [name, layer] of layerMap) {
      if (!layerOrder.includes(name)) {
        layers.push(layer);
      }
    }

    return layers;
  }

  /**
   * Detect monorepo packages (directories that contain their own src/app structure)
   */
  private detectMonorepoPackages(): Array<{ name: string; path: string; type: string }> {
    const packages: Array<{ name: string; path: string; type: string }> = [];

    try {
      const entries = readdirSync(this.projectPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const dirName = entry.name;
        const dirPath = join(this.projectPath, dirName);

        // Check if this matches monorepo patterns
        const isMonorepoPackage = ArchitectureGenerator.MONOREPO_PATTERNS.some(
          pattern => pattern.test(dirName)
        );

        if (isMonorepoPackage) {
          // Verify it has a recognizable internal structure (src/, app/, or direct code)
          const hasInternalStructure = this.hasCodeStructure(dirPath);

          if (hasInternalStructure) {
            // Determine the package type from the name
            const type = this.inferPackageType(dirName);
            packages.push({
              name: dirName,
              path: dirPath,
              type
            });
          }
        }
      }
    } catch {
      // Directory scan failed
    }

    return packages;
  }

  /**
   * Check if a directory has a recognizable code structure
   */
  private hasCodeStructure(dirPath: string): boolean {
    const structureDirs = ['src', 'app', 'lib', 'core', 'api', 'components', 'pages', 'modules'];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && structureDirs.includes(entry.name.toLowerCase())) {
          return true;
        }
        // Also check for direct code files
        if (entry.isFile() && this.isCodeFile(entry.name)) {
          return true;
        }
      }
    } catch {
      // Ignore
    }

    return false;
  }

  /**
   * Infer the package type from its name
   */
  private inferPackageType(dirName: string): string {
    const lowerName = dirName.toLowerCase();

    for (const [pattern, type] of Object.entries(ArchitectureGenerator.MONOREPO_LAYER_TYPES)) {
      if (lowerName.includes(pattern)) {
        return type;
      }
    }

    return 'Application';
  }

  /**
   * Scan a directory for architectural layers
   */
  private scanDirectoryForLayers(
    scanDir: string,
    layerMap: Map<string, ArchitectureLayer>,
    packagePrefix?: string
  ): void {
    // Directories to scan: the given dir, plus src/ and app/ inside it
    const dirsToScan: string[] = [scanDir];

    const srcDir = join(scanDir, 'src');
    const appDir = join(scanDir, 'app');

    if (existsSync(srcDir)) dirsToScan.push(srcDir);
    if (existsSync(appDir)) dirsToScan.push(appDir);

    for (const dir of dirsToScan) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (this.shouldSkipDirectory(entry.name)) continue;

          const dirName = entry.name.toLowerCase();
          let layerName = ArchitectureGenerator.LAYER_MAPPING[dirName];

          // If this is a monorepo package root, use the package type as layer
          if (!layerName && packagePrefix && dir === scanDir) {
            const packageType = this.inferPackageType(packagePrefix);
            layerName = packageType;
          }

          if (layerName) {
            const dirPath = join(dir, entry.name);
            const relativePath = dirPath.replace(this.projectPath, '').replace(/^[/\\]/, '');
            const files = this.getFilesInDirectoryRecursive(relativePath, 2); // Limit depth

            if (files.length > 0) {
              // Create a unique key with package prefix if in monorepo
              const layerKey = packagePrefix ? `${packagePrefix}/${layerName}` : layerName;
              const displayName = packagePrefix ? `${layerName} (${packagePrefix})` : layerName;

              if (layerMap.has(layerKey)) {
                const existing = layerMap.get(layerKey)!;
                existing.files.push(...files);
              } else {
                layerMap.set(layerKey, {
                  name: displayName,
                  directory: relativePath,
                  files,
                  purpose: ArchitectureGenerator.LAYER_PURPOSES[layerName] || ''
                });
              }
            }
          }
        }
      } catch {
        // Directory scan failed
      }
    }

    // If in a monorepo package and no layers found yet, add the package itself as a layer
    if (packagePrefix && layerMap.size === 0) {
      const packageType = this.inferPackageType(packagePrefix);
      const relativePath = scanDir.replace(this.projectPath, '').replace(/^[/\\]/, '');
      const files = this.getFilesInDirectoryRecursive(relativePath, 3);

      if (files.length > 0) {
        layerMap.set(packagePrefix, {
          name: `${packageType} (${packagePrefix})`,
          directory: relativePath,
          files,
          purpose: ArchitectureGenerator.LAYER_PURPOSES[packageType] || 'Application code'
        });
      }
    }
  }

  /**
   * Get files recursively up to a certain depth
   */
  private getFilesInDirectoryRecursive(relativePath: string, maxDepth: number, currentDepth = 0): string[] {
    if (currentDepth > maxDepth) return [];

    const files: string[] = [];
    const absolutePath = join(this.projectPath, relativePath);

    try {
      const entries = readdirSync(absolutePath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = join(relativePath, entry.name);

        if (entry.isFile() && this.isCodeFile(entry.name)) {
          files.push(entryRelativePath);
        } else if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name)) {
          files.push(...this.getFilesInDirectoryRecursive(entryRelativePath, maxDepth, currentDepth + 1));
        }
      }
    } catch {
      // Directory read failed
    }

    return files;
  }

  /**
   * Check if a directory should be skipped during scanning
   */
  private shouldSkipDirectory(name: string): boolean {
    const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.pytest_cache', 'venv', '.venv', 'coverage'];
    return skipDirs.includes(name) || name.startsWith('.');
  }

  private getFilesInDirectory(relativePath: string): string[] {
    const files: string[] = [];
    const absolutePath = join(this.projectPath, relativePath);

    try {
      const entries = readdirSync(absolutePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && this.isCodeFile(entry.name)) {
          files.push(join(relativePath, entry.name));
        }
      }
    } catch {
      // Directory read failed
    }

    return files;
  }

  private isCodeFile(filename: string): boolean {
    const codeExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java'];
    return codeExtensions.some(ext => filename.endsWith(ext));
  }

  private extractKeyComponents(layers: ArchitectureLayer[]): ComponentReference[] {
    const components: ComponentReference[] = [];

    for (const layer of layers) {
      for (const filePath of layer.files.slice(0, 5)) { // Limit per layer
        const file = this.tier2.getFile(filePath);
        if (!file) continue;

        const symbols = this.tier2.getSymbolsByFile(file.id);
        const exports = symbols.filter(s => s.exported);

        if (exports.length > 0) {
          const mainExport = exports.find(s => s.kind === 'class') || exports[0];

          components.push({
            name: mainExport?.name || basename(filePath, '.ts'),
            file: filePath,
            purpose: this.inferComponentPurpose(filePath, symbols),
            exports: exports.map(s => s.name)
          });
        }
      }
    }

    return components;
  }

  private inferComponentPurpose(filePath: string, symbols: Array<{ name: string; kind: string }>): string {
    const name = basename(filePath, '.ts').toLowerCase();
    const mainExport = symbols.find(s => s.kind === 'class' || s.kind === 'function');

    if (name.includes('engine')) return 'Main orchestration engine';
    if (name.includes('server')) return 'Server implementation';
    if (name.includes('storage')) return 'Data storage management';
    if (name.includes('indexer')) return 'Content indexing';
    if (name.includes('context')) return 'Context management';
    if (name.includes('config')) return 'Configuration handling';

    if (mainExport) {
      return `Provides ${mainExport.name}`;
    }

    return 'Module';
  }

  private inferDataFlow(layers: ArchitectureLayer[]): DataFlowStep[] {
    const flow: DataFlowStep[] = [];
    const layerNames = layers.map(l => l.name);

    // Infer common data flows based on detected layers
    if (layerNames.includes('API Layer') && layerNames.includes('Business Logic')) {
      flow.push({
        from: 'API Layer',
        to: 'Business Logic',
        description: 'Request handling and routing'
      });
    }

    if (layerNames.includes('Business Logic') && layerNames.includes('Data Layer')) {
      flow.push({
        from: 'Business Logic',
        to: 'Data Layer',
        description: 'Data persistence and retrieval'
      });
    }

    if (layerNames.includes('Business Logic') && layerNames.includes('Indexing Layer')) {
      flow.push({
        from: 'Business Logic',
        to: 'Indexing Layer',
        description: 'Content indexing and search'
      });
    }

    if (layerNames.includes('CLI Interface') && layerNames.includes('Business Logic')) {
      flow.push({
        from: 'CLI Interface',
        to: 'Business Logic',
        description: 'Command execution'
      });
    }

    if (layerNames.includes('UI Components') && layerNames.includes('State Management')) {
      flow.push({
        from: 'UI Components',
        to: 'State Management',
        description: 'UI state updates'
      });
    }

    return flow;
  }

  private generateASCIIDiagram(layers: ArchitectureLayer[], dataFlow: DataFlowStep[]): string {
    const maxWidth = 45;
    const lines: string[] = [];

    // Header
    lines.push('┌' + '─'.repeat(maxWidth) + '┐');
    lines.push('│' + this.centerText('PROJECT ARCHITECTURE', maxWidth) + '│');
    lines.push('├' + '─'.repeat(maxWidth) + '┤');

    // Each layer
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      const layerName = layer.name;
      const fileCount = `(${layer.files.length} files)`;

      // Layer name line
      lines.push('│  ' + layerName.padEnd(maxWidth - 4) + '  │');

      // Directory line
      lines.push('│  └── ' + layer.directory.padEnd(maxWidth - 8) + '  │');

      // Add connector if there's a next layer with data flow
      if (i < layers.length - 1) {
        const flowToNext = dataFlow.find(f =>
          f.from === layer.name && f.to === layers[i + 1]?.name
        );

        if (flowToNext) {
          lines.push('│' + this.centerText('│', maxWidth) + '│');
          lines.push('│' + this.centerText('▼', maxWidth) + '│');
        } else {
          lines.push('│' + ' '.repeat(maxWidth) + '│');
        }
      }
    }

    // Footer
    lines.push('└' + '─'.repeat(maxWidth) + '┘');

    // Add legend if there are data flows
    if (dataFlow.length > 0) {
      lines.push('');
      lines.push('Data Flow:');
      for (const flow of dataFlow) {
        lines.push(`  ${flow.from} → ${flow.to}`);
        lines.push(`    ${flow.description}`);
      }
    }

    return lines.join('\n');
  }

  private centerText(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }

  private getProjectDependencies(): DependencyInfo[] {
    const deps: DependencyInfo[] = [];

    // Check package.json
    const packageJsonPath = join(this.projectPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        // Runtime dependencies
        if (pkg.dependencies) {
          for (const [name, version] of Object.entries(pkg.dependencies)) {
            deps.push({
              name,
              version: String(version),
              type: 'runtime'
            });
          }
        }

        // Dev dependencies (limit to important ones)
        if (pkg.devDependencies) {
          const importantDevDeps = ['typescript', 'vitest', 'jest', 'eslint', 'prettier', 'esbuild', 'webpack', 'vite'];
          for (const [name, version] of Object.entries(pkg.devDependencies)) {
            if (importantDevDeps.some(d => name.includes(d))) {
              deps.push({
                name,
                version: String(version),
                type: 'dev'
              });
            }
          }
        }
      } catch {
        // Parse error
      }
    }

    // Check requirements.txt for Python
    const requirementsPath = join(this.projectPath, 'requirements.txt');
    if (existsSync(requirementsPath)) {
      try {
        const content = readFileSync(requirementsPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

        for (const line of lines.slice(0, 20)) {
          const match = line.match(/^([a-zA-Z0-9_-]+)(?:[=<>~!]+(.+))?/);
          if (match) {
            deps.push({
              name: match[1]!,
              version: match[2],
              type: 'runtime'
            });
          }
        }
      } catch {
        // Read error
      }
    }

    return deps;
  }

  private inferDescription(layers: ArchitectureLayer[], components: ComponentReference[]): string {
    const parts: string[] = [];

    // Describe the project type based on layers
    const layerNames = layers.map(l => l.name);

    if (layerNames.includes('API Layer') && layerNames.includes('Data Layer')) {
      parts.push('Backend application');
    } else if (layerNames.includes('UI Components')) {
      parts.push('Frontend application');
    } else if (layerNames.includes('CLI Interface')) {
      parts.push('CLI tool');
    }

    // Describe key capabilities
    if (layerNames.includes('Indexing Layer')) {
      parts.push('with search/indexing capabilities');
    }
    if (layerNames.includes('State Management')) {
      parts.push('with centralized state management');
    }

    // File count
    const totalFiles = layers.reduce((sum, l) => sum + l.files.length, 0);
    parts.push(`(${totalFiles} source files across ${layers.length} layers)`);

    return parts.join(' ');
  }
}
