import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename, resolve } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import type { CodeImpactConfig } from '../types/index.js';

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  dataDir: string;
  lastAccessed: number;
  totalFiles: number;
  totalDecisions: number;
  languages: string[];
}

export interface ProjectRegistry {
  version: number;
  activeProject: string | null;
  projects: Record<string, ProjectInfo>;
}

export class ProjectManager {
  private registryPath: string;
  private registry: ProjectRegistry;
  private baseDataDir: string;

  constructor() {
    this.baseDataDir = join(homedir(), '.codeimpact');
    this.registryPath = join(this.baseDataDir, 'registry.json');

    // Ensure base directory exists
    if (!existsSync(this.baseDataDir)) {
      mkdirSync(this.baseDataDir, { recursive: true });
    }

    this.registry = this.loadRegistry();
  }

  private loadRegistry(): ProjectRegistry {
    try {
      if (existsSync(this.registryPath)) {
        const data = JSON.parse(readFileSync(this.registryPath, 'utf-8'));
        return data;
      }
    } catch (error) {
      console.error('Error loading registry:', error);
    }

    return {
      version: 1,
      activeProject: null,
      projects: {}
    };
  }

  private saveRegistry(): void {
    try {
      writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
    } catch (error) {
      console.error('Error saving registry:', error);
    }
  }

  private generateProjectId(projectPath: string): string {
    const normalizedPath = resolve(projectPath);
    return createHash('md5').update(normalizedPath).digest('hex').slice(0, 12);
  }

  private getProjectDataDir(projectPath: string): string {
    // Store data locally in the project's .codeimpact folder
    // This ensures each project has isolated data that travels with the repo
    return join(resolve(projectPath), '.codeimpact');
  }

  // Register a new project or update existing
  registerProject(projectPath: string): ProjectInfo {
    const normalizedPath = resolve(projectPath);
    const projectId = this.generateProjectId(normalizedPath);
    const dataDir = this.getProjectDataDir(normalizedPath);

    // Check if project directory exists
    if (!existsSync(normalizedPath)) {
      throw new Error(`Project path does not exist: ${normalizedPath}`);
    }

    const existingProject = this.registry.projects[projectId];

    const projectInfo: ProjectInfo = {
      id: projectId,
      name: basename(normalizedPath),
      path: normalizedPath,
      dataDir,
      lastAccessed: Date.now(),
      totalFiles: existingProject?.totalFiles || 0,
      totalDecisions: existingProject?.totalDecisions || 0,
      languages: existingProject?.languages || []
    };

    this.registry.projects[projectId] = projectInfo;
    this.saveRegistry();

    return projectInfo;
  }

  // Remove a project from registry
  removeProject(projectId: string): boolean {
    if (!this.registry.projects[projectId]) {
      return false;
    }

    delete this.registry.projects[projectId];

    if (this.registry.activeProject === projectId) {
      this.registry.activeProject = null;
    }

    this.saveRegistry();
    return true;
  }

  // Get all registered projects
  listProjects(): ProjectInfo[] {
    return Object.values(this.registry.projects)
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
  }

  // Get a specific project
  getProject(projectId: string): ProjectInfo | null {
    return this.registry.projects[projectId] || null;
  }

  // Get project by path
  getProjectByPath(projectPath: string): ProjectInfo | null {
    const projectId = this.generateProjectId(projectPath);
    return this.registry.projects[projectId] || null;
  }

  // Set active project
  setActiveProject(projectId: string): boolean {
    if (!this.registry.projects[projectId]) {
      return false;
    }

    this.registry.activeProject = projectId;
    this.registry.projects[projectId]!.lastAccessed = Date.now();
    this.saveRegistry();
    return true;
  }

  // Get active project
  getActiveProject(): ProjectInfo | null {
    if (!this.registry.activeProject) {
      return null;
    }
    return this.registry.projects[this.registry.activeProject] || null;
  }

  // Update project stats
  updateProjectStats(projectId: string, stats: { totalFiles?: number; totalDecisions?: number; languages?: string[] }): void {
    const project = this.registry.projects[projectId];
    if (!project) return;

    if (stats.totalFiles !== undefined) {
      project.totalFiles = stats.totalFiles;
    }
    if (stats.totalDecisions !== undefined) {
      project.totalDecisions = stats.totalDecisions;
    }
    if (stats.languages !== undefined) {
      project.languages = stats.languages;
    }

    this.saveRegistry();
  }

  // Get config for a project
  getProjectConfig(projectPath: string): CodeImpactConfig {
    const normalizedPath = resolve(projectPath);
    const dataDir = this.getProjectDataDir(normalizedPath);

    return {
      projectPath: normalizedPath,
      dataDir,
      maxTokens: 6000,
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      watchIgnore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/coverage/**',
        '**/*.min.js',
        '**/*.min.css',
        '**/*.map',
        '**/package-lock.json',
        '**/yarn.lock',
        '**/pnpm-lock.yaml',
        '**/.env*',
        '**/*.log'
      ]
    };
  }

  // Scan for projects in common locations
  discoverProjects(): string[] {
    const discovered: string[] = [];
    const homeDir = homedir();

    // Common project locations
    const searchDirs = [
      join(homeDir, 'projects'),
      join(homeDir, 'Projects'),
      join(homeDir, 'code'),
      join(homeDir, 'Code'),
      join(homeDir, 'dev'),
      join(homeDir, 'Development'),
      join(homeDir, 'workspace'),
      join(homeDir, 'repos'),
      join(homeDir, 'github'),
      join(homeDir, 'Desktop'),
      join(homeDir, 'Documents'),
    ];

    for (const searchDir of searchDirs) {
      if (!existsSync(searchDir)) continue;

      try {
        const entries = readdirSync(searchDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const projectPath = join(searchDir, entry.name);

          // Check if it looks like a project (has common project files)
          const projectIndicators = [
            'package.json',
            'Cargo.toml',
            'go.mod',
            'requirements.txt',
            'pyproject.toml',
            'pom.xml',
            'build.gradle',
            '.git'
          ];

          const isProject = projectIndicators.some(indicator =>
            existsSync(join(projectPath, indicator))
          );

          if (isProject) {
            discovered.push(projectPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }

    return discovered;
  }

  // Get cross-project database connections for search
  getProjectDatabases(): Array<{ project: ProjectInfo; db: Database.Database }> {
    const result: Array<{ project: ProjectInfo; db: Database.Database }> = [];

    for (const project of this.listProjects()) {
      // Check project-local .codeimpact folder (primary location)
      let dbPath = join(project.path, '.codeimpact', 'codeimpact.db');

      // Fallback to legacy centralized location
      if (!existsSync(dbPath)) {
        dbPath = join(project.dataDir, 'codeimpact.db');
      }

      if (existsSync(dbPath)) {
        try {
          const db = new Database(dbPath, { readonly: true });
          result.push({ project, db });
        } catch {
          // Skip databases we can't open
        }
      }
    }

    return result;
  }

  // Close all database connections
  closeAllDatabases(dbs: Array<{ db: Database.Database }>): void {
    for (const { db } of dbs) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}
