import type { CodeImpactEngine } from '../engine.js';

export interface DependencyHotspot {
  file: string;
  dependentCount: number;
  riskScore: number;
  riskLevel: string;
}

export interface PatternSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  rulesCount: number;
  usageCount: number;
  topRules: Array<{ rule: string; severity: string }>;
}

export interface BugSummary {
  error: string;
  file?: string;
  date?: string;
  fix?: string;
  cause?: string;
}

export interface FeatureSummary {
  name: string;
  files: string[];
  touchCounts: number[];
  recentQueries: string[];
}

export interface DeadCodeDetail {
  unusedExportCount: number;
  unusedFileCount: number;
  estimatedDeadLines: number;
  safeToDeleteCount: number;
  safeToDeletePaths: Array<{ file: string; exportName: string }>;
  unusedFilePaths: string[];
}

export interface ProjectIntelligence {
  collectedAt: string;

  codebase: {
    fileCount: number;
    totalLines: number;
    languages: string[];
    keyDirectories: string[];
    symbolCount: number;
    description: string;
    architectureNotes: string;
  };

  architecture: {
    layers: Array<{ name: string; directory: string; fileCount: number; purpose: string }>;
    dataFlow: string[];
    keyComponents: Array<{ name: string; file: string; purpose: string }>;
    patternCategories: Record<string, number>;
    topPatterns: Array<{ name: string; usageCount: number }>;
    functionStats: { total: number; exported: number };
  } | null;

  dependencyHotspots: DependencyHotspot[];

  patterns: PatternSummary[];

  decisions: Array<{
    title: string;
    description: string;
    tags: string[];
    files: string[];
    status?: string;
  }>;

  riskFiles: Array<{
    file: string;
    riskScore: number;
    riskLevel: string;
    directDependents: number;
    criticalPaths: string[];
    recommendation: string;
  }>;

  deadCode: DeadCodeDetail | null;

  tests: {
    framework: string;
    testCount: number;
    coverageGaps: string[];
    uncoveredFunctions: Array<{ file: string; functions: string[] }>;
  };

  recentBugs: BugSummary[];

  changeHotspots: Array<{ file: string; changeCount: number }>;

  activeFeature: FeatureSummary | null;

  docHealth: {
    score: number;
    outdatedCount: number;
    undocumentedCount: number;
    outdatedFiles: string[];
  } | null;

  detectedTechnologies: Array<{
    name: string;
    source: string;
    importPaths: string[];
  }>;
}

export class IntelligenceCollector {
  constructor(private readonly engine: CodeImpactEngine) {}

  collect(): ProjectIntelligence {
    const now = new Date().toISOString();

    return {
      collectedAt: now,
      codebase: this.collectCodebase(),
      architecture: this.collectArchitecture(),
      dependencyHotspots: this.collectDependencyHotspots(),
      patterns: this.collectPatterns(),
      decisions: this.collectDecisions(),
      riskFiles: this.collectRiskFiles(),
      deadCode: this.collectDeadCode(),
      tests: this.collectTests(),
      recentBugs: this.collectRecentBugs(),
      changeHotspots: this.collectChangeHotspots(),
      activeFeature: this.collectActiveFeature(),
      docHealth: this.collectDocHealth(),
      detectedTechnologies: this.collectTechnologies(),
    };
  }

  private collectCodebase(): ProjectIntelligence['codebase'] {
    const summary = this.engine.getProjectSummary();
    return {
      fileCount: summary.totalFiles,
      totalLines: summary.totalLines,
      languages: summary.languages,
      keyDirectories: summary.keyDirectories,
      symbolCount: this.engine.getSymbolCount(),
      description: summary.description || '',
      architectureNotes: summary.architectureNotes || '',
    };
  }

  private collectArchitecture(): ProjectIntelligence['architecture'] {
    try {
      const stats = this.engine.getArchitectureStats();
      if (!stats) return null;

      const cachedArch = this.engine.getCachedArchitectureDoc();

      const layers = cachedArch?.layers?.map((l: any) => ({
        name: l.name,
        directory: l.directory,
        fileCount: l.files?.length ?? 0,
        purpose: l.purpose,
      })) ?? [];

      const dataFlow = cachedArch?.dataFlow?.map(
        (f: any) => typeof f === 'string' ? f : `${f.from} → ${f.to}: ${f.description}`,
      ) ?? [];

      const keyComponents = cachedArch?.keyComponents?.map((c: any) => ({
        name: c.name,
        file: c.file,
        purpose: c.purpose,
      })) ?? [];

      return {
        layers,
        dataFlow,
        keyComponents,
        patternCategories: stats.patterns.byCategory,
        topPatterns: stats.patterns.topPatterns.slice(0, 10),
        functionStats: {
          total: stats.functions.total,
          exported: stats.functions.exported,
        },
      };
    } catch {
      return null;
    }
  }

  private collectDependencyHotspots(): DependencyHotspot[] {
    try {
      const frequentFiles = this.engine.getFrequentFiles(20);
      const hotspots: DependencyHotspot[] = [];

      for (const file of frequentFiles.slice(0, 10)) {
        try {
          const result = this.engine.getBlastRadius(file, 2);
          if (result.riskScore > 30) {
            hotspots.push({
              file: result.file,
              dependentCount: result.totalAffected,
              riskScore: result.riskScore,
              riskLevel: result.riskLevel,
            });
          }
        } catch {
          // skip files that can't be analyzed
        }
      }

      return hotspots.sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
    } catch {
      return [];
    }
  }

  private collectPatterns(): PatternSummary[] {
    try {
      const patterns = this.engine.listPatterns();
      return patterns.slice(0, 20).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description.slice(0, 150),
        rulesCount: p.rules.length,
        usageCount: p.usageCount,
        topRules: p.rules.slice(0, 3).map((r) => ({
          rule: r.rule,
          severity: r.severity,
        })),
      }));
    } catch {
      return [];
    }
  }

  private collectDecisions(): ProjectIntelligence['decisions'] {
    try {
      const decisions = this.engine.getAllDecisions();
      return decisions
        .filter((d) => d.status !== 'deprecated' && d.status !== 'superseded')
        .slice(0, 20)
        .map((d) => ({
          title: d.title,
          description: d.description.slice(0, 300),
          tags: d.tags,
          files: d.files,
          status: d.status,
        }));
    } catch {
      return [];
    }
  }

  private collectRiskFiles(): ProjectIntelligence['riskFiles'] {
    try {
      const frequentFiles = this.engine.getFrequentFiles(30);
      const riskFiles: ProjectIntelligence['riskFiles'] = [];

      for (const file of frequentFiles.slice(0, 15)) {
        try {
          const result = this.engine.getBlastRadius(file, 2);
          if (result.riskScore >= 50) {
            riskFiles.push({
              file: result.file,
              riskScore: result.riskScore,
              riskLevel: result.riskLevel,
              directDependents: result.directDependents,
              criticalPaths: result.criticalPaths,
              recommendation: result.recommendation,
            });
          }
        } catch {
          // skip
        }
      }

      return riskFiles.sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
    } catch {
      return [];
    }
  }

  private collectDeadCode(): DeadCodeDetail | null {
    try {
      const report = this.engine.findDeadCode();
      return {
        unusedExportCount: report.unusedExports.length,
        unusedFileCount: report.unusedFiles.length,
        estimatedDeadLines: report.estimatedDeadLines,
        safeToDeleteCount: report.safeToDelete.length,
        safeToDeletePaths: report.safeToDelete.slice(0, 10).map((e) => ({
          file: e.filePath,
          exportName: e.exportedName,
        })),
        unusedFilePaths: report.unusedFiles.slice(0, 5).map((f) => f.filePath),
      };
    } catch {
      return null;
    }
  }

  private collectTests(): ProjectIntelligence['tests'] {
    try {
      const framework = this.engine.getTestFramework();
      const testCount = this.engine.getTestCount();
      const allTests = this.engine.getAllTests();
      const coveredFiles = new Set(allTests.flatMap((t) => t.coversFiles));
      const summary = this.engine.getProjectSummary();
      const gaps: string[] = [];

      for (const dir of summary.keyDirectories) {
        if (!Array.from(coveredFiles).some((f) => f.startsWith(dir))) {
          gaps.push(dir);
        }
      }

      const uncoveredFunctions: Array<{ file: string; functions: string[] }> = [];
      for (const dir of summary.keyDirectories.slice(0, 5)) {
        try {
          const coverage = this.engine.getTestCoverage(dir);
          if (coverage.uncoveredFunctions.length > 0) {
            uncoveredFunctions.push({
              file: coverage.file,
              functions: coverage.uncoveredFunctions.slice(0, 5),
            });
          }
        } catch {
          // skip
        }
      }

      return { framework, testCount, coverageGaps: gaps.slice(0, 10), uncoveredFunctions: uncoveredFunctions.slice(0, 5) };
    } catch {
      return { framework: 'unknown', testCount: 0, coverageGaps: [], uncoveredFunctions: [] };
    }
  }

  private collectRecentBugs(): BugSummary[] {
    try {
      const changeHotspots = this.engine.getRecentChanges(168);
      const hotFiles = [...new Set(changeHotspots.map((c) => c.file))].slice(0, 5);

      const allBugs: BugSummary[] = [];
      for (const file of hotFiles) {
        try {
          const bugs = this.engine.findSimilarBugs(file, 3);
          for (const b of bugs) {
            if (b.similarity > 0.3) {
              allBugs.push({
                error: b.error.slice(0, 150),
                file: b.file,
                date: b.date instanceof Date ? b.date.toISOString().split('T')[0] : undefined,
                fix: b.fix?.slice(0, 150),
                cause: b.cause?.slice(0, 100),
              });
            }
          }
        } catch {
          // skip
        }
      }

      if (allBugs.length === 0) {
        const fallback = this.engine.findSimilarBugs('error', 5);
        for (const b of fallback) {
          allBugs.push({
            error: b.error.slice(0, 150),
            file: b.file,
            date: b.date instanceof Date ? b.date.toISOString().split('T')[0] : undefined,
            fix: b.fix?.slice(0, 150),
            cause: b.cause?.slice(0, 100),
          });
        }
      }

      const seen = new Set<string>();
      return allBugs.filter((b) => {
        if (seen.has(b.error)) return false;
        seen.add(b.error);
        return true;
      }).slice(0, 5);
    } catch {
      return [];
    }
  }

  private collectChangeHotspots(): ProjectIntelligence['changeHotspots'] {
    try {
      const changes = this.engine.getRecentChanges(168);
      const counts = new Map<string, number>();
      for (const change of changes) {
        counts.set(change.file, (counts.get(change.file) || 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([file, changeCount]) => ({ file, changeCount }));
    } catch {
      return [];
    }
  }

  private collectActiveFeature(): FeatureSummary | null {
    try {
      const ctx = this.engine.getActiveFeatureContext();
      if (!ctx || ctx.status !== 'active') return null;
      return {
        name: ctx.name,
        files: ctx.files.slice(0, 10).map((f) => f.path),
        touchCounts: ctx.files.slice(0, 10).map((f) => f.touchCount),
        recentQueries: ctx.queries.slice(-5).map((q) => q.query),
      };
    } catch {
      return null;
    }
  }

  private collectDocHealth(): ProjectIntelligence['docHealth'] {
    try {
      const cached = this.engine.getCachedDocValidation();
      if (!cached) return null;
      return {
        score: cached.score,
        outdatedCount: cached.outdatedDocs.length,
        undocumentedCount: cached.undocumentedCode.length,
        outdatedFiles: cached.outdatedDocs.slice(0, 5).map((d: any) => d.file || 'unknown'),
      };
    } catch {
      return null;
    }
  }

  private collectTechnologies(): ProjectIntelligence['detectedTechnologies'] {
    try {
      const summary = this.engine.getProjectSummary();
      const deps = summary.dependencies || [];
      const techs: ProjectIntelligence['detectedTechnologies'] = [];

      const frameworkMap: Record<string, string> = {
        express: 'Express.js',
        fastify: 'Fastify',
        'next': 'Next.js',
        react: 'React',
        vue: 'Vue.js',
        svelte: 'Svelte',
        angular: 'Angular',
        fastapi: 'FastAPI',
        django: 'Django',
        flask: 'Flask',
        prisma: 'Prisma',
        typeorm: 'TypeORM',
        mongoose: 'Mongoose',
        jsonwebtoken: 'JWT Auth',
        passport: 'Passport.js',
        'aws-sdk': 'AWS SDK',
        '@aws-sdk': 'AWS SDK v3',
        stripe: 'Stripe',
        'socket.io': 'Socket.IO',
        graphql: 'GraphQL',
        '@modelcontextprotocol': 'MCP SDK',
        'better-sqlite3': 'SQLite',
        '@xenova/transformers': 'Transformers.js',
        'web-tree-sitter': 'Tree-sitter',
      };

      for (const dep of deps) {
        const depLower = dep.toLowerCase();
        for (const [key, name] of Object.entries(frameworkMap)) {
          if (depLower.includes(key)) {
            const importPaths = this.engine.getTopImportedModules(key, 5);
            techs.push({ name, source: dep, importPaths });
          }
        }
      }

      if (techs.length === 0) {
        for (const lang of summary.languages) {
          techs.push({ name: lang, source: 'language', importPaths: [] });
        }
      }

      return techs;
    } catch {
      return [];
    }
  }
}
