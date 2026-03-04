import { join, basename } from 'path';
import { existsSync, mkdirSync, readFileSync, statSync, renameSync } from 'fs';
import { initializeDatabase, closeDatabase } from '../storage/database.js';
import { Tier1Storage } from '../storage/tier1.js';
import { Tier2Storage } from '../storage/tier2.js';
import { Tier3Storage } from '../storage/tier3.js';
import { Indexer } from '../indexing/indexer.js';
import { ContextAssembler } from './context.js';
import { DecisionTracker } from './decisions.js';
import { DecisionExtractor } from './decision-extractor.js';
import { LearningEngine } from './learning.js';
import { FileSummarizer } from './summarizer.js';
import { ProjectManager, type ProjectInfo } from './project-manager.js';
import { ADRExporter, type ADRExportOptions } from './adr-exporter.js';
import { FeatureContextManager, type ResurrectedContext, type ContextResurrectionOptions } from './feature-context.js';
import { LivingDocumentationEngine } from './living-docs/index.js';
import { ContextRotPrevention } from './context-rot/index.js';
import { ConfidenceScorer } from './confidence/index.js';
import { ChangeIntelligence } from './change-intelligence/index.js';
import { ArchitectureEnforcement } from './architecture/index.js';
import { TestAwareness } from './test-awareness/index.js';
import { GhostMode, type GhostInsight, type ConflictWarning } from './ghost-mode.js';
import { DejaVuDetector, type DejaVuMatch } from './deja-vu.js';
import { CodeVerifier, type VerificationResult, type VerificationCheck, type ImportVerification, type SecurityScanResult, type DependencyCheckResult } from './code-verifier.js';
import { DeadCodeDetector, type DeadCodeReport, type UnusedExport, type UnusedFile } from './dead-code-detector.js';
import { TestImpactAnalyzer, type TestImpactResult, type AffectedFile } from './test-impact-analyzer.js';
import { BlastRadiusAnalyzer, type BlastRadiusResult, type RiskLevel } from './blast-radius.js';
import { CostTracker, type UsageStats, type StatsPeriod } from './cost-tracker.js';
import { GitStalenessChecker, ActivityGate } from './refresh/index.js';
import { detectLanguage, getPreview, countLines } from '../utils/files.js';
import type { CodeImpactConfig, AssembledContext, Decision, ProjectSummary, SearchResult, CodeSymbol, SymbolKind, ActiveFeatureContext, HotContext } from '../types/index.js';
import type { ArchitectureDoc, ComponentDoc, DailyChangelog, ChangelogOptions, ValidationResult, ActivityResult, UndocumentedItem, ContextHealth, CompactionResult, CompactionOptions, CriticalContext, DriftResult, ConfidenceResult, ConfidenceLevel, ConfidenceSources, ConflictResult, ChangeQueryResult, ChangeQueryOptions, Diagnosis, PastBug, FixSuggestion, Change, Pattern, PatternCategory, PatternValidationResult, ExistingFunction, TestInfo, TestFramework, TestValidationResult, TestUpdate, TestCoverage } from '../types/documentation.js';
import type Database from 'better-sqlite3';

// Re-export types for external use
export type { GhostInsight, ConflictWarning, DejaVuMatch, ResurrectedContext, VerificationResult, VerificationCheck, ImportVerification, SecurityScanResult, DependencyCheckResult, DeadCodeReport, UnusedExport, UnusedFile, TestImpactResult, AffectedFile, BlastRadiusResult, RiskLevel, UsageStats, StatsPeriod };

export class CodeImpactEngine {
  private config: CodeImpactConfig;
  private db: Database.Database;
  private tier1: Tier1Storage;
  private tier2: Tier2Storage;
  private tier3: Tier3Storage;
  private indexer: Indexer;
  private contextAssembler: ContextAssembler;
  private decisionTracker: DecisionTracker;
  private learningEngine: LearningEngine;
  private summarizer: FileSummarizer;
  private projectManager: ProjectManager;
  private adrExporter: ADRExporter;
  private featureContextManager: FeatureContextManager;
  private livingDocs: LivingDocumentationEngine;
  private contextRotPrevention: ContextRotPrevention;
  private confidenceScorer: ConfidenceScorer;
  private changeIntelligence: ChangeIntelligence;
  private architectureEnforcement: ArchitectureEnforcement;
  private testAwareness: TestAwareness;
  private ghostMode: GhostMode;
  private dejaVu: DejaVuDetector;
  private codeVerifier: CodeVerifier;
  private gitStalenessChecker: GitStalenessChecker;
  private activityGate: ActivityGate;
  private initialized = false;
  private initializationStatus: 'pending' | 'indexing' | 'ready' | 'error' = 'pending';
  private indexingProgress: { indexed: number; total: number } = { indexed: 0, total: 0 };

  constructor(config: CodeImpactConfig) {
    this.config = config;

    // Ensure data directory exists
    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true });
    }

    // Initialize database (with migration from old name)
    let dbPath = join(config.dataDir, 'codeimpact.db');
    const oldDbPath = join(config.dataDir, 'codeimpact.db');

    // Migrate from old database name if it exists
    if (!existsSync(dbPath) && existsSync(oldDbPath)) {
      try {
        console.error('Migrating database from codeimpact.db to codeimpact.db...');
        renameSync(oldDbPath, dbPath);
      } catch (err) {
        // If rename fails (file locked), use the old database path
        console.error('Migration skipped (file in use), using existing database');
        dbPath = oldDbPath;
      }
    }

    this.db = initializeDatabase(dbPath);

    // Initialize storage tiers
    this.tier1 = new Tier1Storage(config.dataDir);
    this.tier2 = new Tier2Storage(this.db);
    this.tier3 = new Tier3Storage(this.db);

    // Initialize indexer
    this.indexer = new Indexer(config, this.tier2);

    // Initialize context assembler
    this.contextAssembler = new ContextAssembler(
      this.tier1,
      this.tier2,
      this.tier3,
      this.indexer.getEmbeddingGenerator()
    );

    // Initialize decision tracker
    this.decisionTracker = new DecisionTracker(
      this.tier1,
      this.tier2,
      this.indexer.getEmbeddingGenerator()
    );

    // Phase 3: Initialize learning engine and summarizer
    this.learningEngine = new LearningEngine(this.db);
    this.summarizer = new FileSummarizer(this.db);

    // Phase 4: Initialize project manager and ADR exporter
    this.projectManager = new ProjectManager();
    this.adrExporter = new ADRExporter(config.projectPath);

    // Phase 5: Initialize feature context manager
    this.featureContextManager = new FeatureContextManager(config.projectPath, config.dataDir);

    // Wire up feature context manager to context assembler
    this.contextAssembler.setFeatureContextManager(this.featureContextManager);

    // Phase 6: Initialize living documentation engine
    this.livingDocs = new LivingDocumentationEngine(
      config.projectPath,
      config.dataDir,
      this.db,
      this.tier2
    );

    // Phase 7: Initialize context rot prevention
    this.contextRotPrevention = new ContextRotPrevention(this.db, config.maxTokens);

    // Phase 8: Initialize confidence scorer
    this.confidenceScorer = new ConfidenceScorer(
      this.tier2,
      this.indexer.getEmbeddingGenerator()
    );

    // Phase 9: Initialize change intelligence
    this.changeIntelligence = new ChangeIntelligence(
      config.projectPath,
      this.db,
      this.tier2,
      this.indexer.getEmbeddingGenerator()
    );

    // Phase 10: Initialize architecture enforcement
    this.architectureEnforcement = new ArchitectureEnforcement(
      this.db,
      this.tier2,
      this.indexer.getEmbeddingGenerator()
    );

    // Phase 11: Initialize test awareness
    this.testAwareness = new TestAwareness(
      config.projectPath,
      this.db,
      this.tier2
    );

    // Phase 12: Initialize Ghost Mode (silent intelligence layer)
    this.ghostMode = new GhostMode(
      this.tier2,
      this.indexer.getEmbeddingGenerator()
    );

    // Phase 12: Initialize Déjà Vu Detector
    this.dejaVu = new DejaVuDetector(
      this.db,
      this.tier2,
      this.indexer.getEmbeddingGenerator()
    );

    // Phase 13: Initialize Code Verifier (pre-commit quality gate)
    this.codeVerifier = new CodeVerifier(config.projectPath);

    // Intelligent Refresh System
    this.gitStalenessChecker = new GitStalenessChecker(config.projectPath);
    this.activityGate = new ActivityGate();

    // Register this project
    const projectInfo = this.projectManager.registerProject(config.projectPath);
    this.projectManager.setActiveProject(projectInfo.id);

    this.setupIndexerEvents();
  }

  private setupIndexerEvents(): void {
    this.indexer.on('indexingStarted', () => {
      // Silent start - only show if files need indexing
      this.indexingProgress = { indexed: 0, total: 0 };
    });

    this.indexer.on('progress', (progress) => {
      // Track progress for status visibility
      this.indexingProgress = { indexed: progress.indexed, total: progress.total || 0 };

      // Only show progress when actually indexing files
      if (progress.indexed === 1) {
        console.error('Indexing new/changed files...');
      }
      if (progress.indexed % 10 === 0) {
        console.error(`  ${progress.indexed} files indexed`);
      }
    });

    this.indexer.on('indexingComplete', (stats: { total: number; indexed: number; skipped?: number }) => {
      // Update final progress
      this.indexingProgress = { indexed: stats.indexed, total: stats.total };

      if (stats.indexed > 0) {
        console.error(`Indexing complete: ${stats.indexed} files indexed`);
        // Log activity for indexing
        this.livingDocs.getActivityTracker().logActivity(
          'indexing_complete',
          `Indexed ${stats.indexed} files`,
          undefined,
          { total: stats.total, indexed: stats.indexed }
        );
      } else {
        console.error(`Index up to date (${stats.total} files)`);
      }
      this.updateProjectSummary();
      this.updateProjectStats();
      // Extract decisions from git and comments
      this.extractDecisions().catch(err => console.error('Decision extraction error:', err));

      // Index tests after code indexing is complete
      try {
        const testResult = this.testAwareness.refreshIndex();
        if (testResult.testsIndexed > 0) {
          console.error(`Test index: ${testResult.testsIndexed} tests (${testResult.framework})`);
        }
      } catch (err) {
        console.error('Test indexing error:', err);
      }
    });

    this.indexer.on('fileIndexed', (path) => {
      // Track file in feature context
      this.featureContextManager.onFileOpened(path);

      // Invalidate cached summary when file changes (event-driven, not polling)
      this.summarizer.invalidateSummaryByPath(path);
    });

    this.indexer.on('fileImpact', (impact: { file: string; affectedFiles: string[]; affectedCount: number }) => {
      // Log impact warning for file changes
      if (impact.affectedCount > 0) {
        console.error(`[Impact] ${impact.file} changed → ${impact.affectedCount} file(s) may be affected`);
        if (impact.affectedCount <= 5) {
          impact.affectedFiles.forEach(f => console.error(`  → ${f}`));
        } else {
          impact.affectedFiles.slice(0, 3).forEach(f => console.error(`  → ${f}`));
          console.error(`  ... and ${impact.affectedCount - 3} more`);
        }

        // Track impact in ghost mode for proactive warnings
        this.ghostMode.onFileImpact(impact.file, impact.affectedFiles);
      }
    });

    this.indexer.on('error', (error) => {
      console.error('Indexer error:', error);
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.error(`Initializing CodeImpact for: ${this.config.projectPath}`);

    try {
      // Perform initial indexing
      this.initializationStatus = 'indexing';
      await this.indexer.performInitialIndex();

      // Start watching for changes
      this.indexer.startWatching();

      // Sync change intelligence from git
      const synced = this.changeIntelligence.initialize();
      if (synced > 0) {
        console.error(`Synced ${synced} changes from git history`);
      }

      // Initialize architecture enforcement (learn patterns from codebase)
      const archResult = this.architectureEnforcement.initialize();
      if (archResult.patternsLearned > 0 || archResult.examplesAdded > 0) {
        console.error(`Architecture enforcement: ${archResult.patternsLearned} patterns learned, ${archResult.examplesAdded} examples added`);
      }

      // Initialize test awareness (index tests)
      const testResult = this.testAwareness.initialize();
      if (testResult.testsIndexed > 0) {
        console.error(`Test awareness: ${testResult.testsIndexed} tests indexed (${testResult.framework})`);
      }

      // Scan for bug fixes from git history (one-time on init, not polling)
      this.changeIntelligence.scanForBugFixes();

      // Initialize git staleness checker with current HEAD
      this.gitStalenessChecker.updateCachedHead();

      // Register idle-time maintenance tasks
      this.registerIdleTasks();

      // Start idle monitoring
      this.activityGate.startIdleMonitoring(10_000);

      this.initialized = true;
      this.initializationStatus = 'ready';
      console.error('CodeImpact initialized');
    } catch (error) {
      this.initializationStatus = 'error';
      throw error;
    }
  }

  /**
   * Get the current engine status for visibility
   * Shows database file count when not actively indexing (fixes 0/537 display bug)
   */
  getEngineStatus(): { status: string; ready: boolean; indexing: { indexed: number; total: number } } {
    // When not actively indexing, show actual database counts instead of runtime counter
    // This fixes the misleading "0/537" display after server restart
    const isActivelyIndexing = this.indexer.isCurrentlyIndexing();

    let indexingInfo: { indexed: number; total: number };

    if (isActivelyIndexing) {
      // During active indexing, show progress
      indexingInfo = this.indexingProgress;
    } else {
      // When idle, show actual indexed file count from database
      const dbFileCount = this.tier2.getFileCount();
      indexingInfo = { indexed: dbFileCount, total: dbFileCount };
    }

    return {
      status: this.initializationStatus,
      ready: this.initialized,
      indexing: indexingInfo
    };
  }

  /**
   * Register idle-time maintenance tasks
   */
  private registerIdleTasks(): void {
    // Git sync when idle and HEAD has changed
    this.activityGate.registerIdleTask('git-sync', () => {
      if (this.gitStalenessChecker.hasNewCommits()) {
        const synced = this.changeIntelligence.syncFromGit(20);
        if (synced > 0) {
          this.changeIntelligence.scanForBugFixes();
          console.error(`Idle sync: ${synced} git changes synced`);
        }
      }
    }, {
      minIdleMs: 30_000,     // 30 seconds idle
      intervalMs: 60_000     // Check at most every minute
    });

    // Importance score updates when idle for longer
    this.activityGate.registerIdleTask('importance-update', () => {
      this.learningEngine.updateImportanceScores();
    }, {
      minIdleMs: 60_000,     // 1 minute idle
      intervalMs: 300_000    // Max once per 5 minutes
    });
  }

  /**
   * Sync git changes on-demand with cheap pre-check
   * Only syncs if HEAD has changed, otherwise returns 0
   */
  syncGitChanges(limit: number = 20): number {
    // Record activity
    this.activityGate.recordActivity();

    try {
      // Cheap pre-check: has HEAD changed?
      if (!this.gitStalenessChecker.hasNewCommits()) {
        return 0; // No new commits, skip expensive sync
      }

      const synced = this.changeIntelligence.syncFromGit(limit);
      if (synced > 0) {
        // Also scan for bug fixes when syncing
        this.changeIntelligence.scanForBugFixes();
      }
      return synced;
    } catch {
      return 0;
    }
  }

  /**
   * Force sync git changes, bypassing the staleness check
   */
  forceSyncGitChanges(limit: number = 20): number {
    this.activityGate.recordActivity();
    this.gitStalenessChecker.updateCachedHead();

    try {
      const synced = this.changeIntelligence.syncFromGit(limit);
      if (synced > 0) {
        this.changeIntelligence.scanForBugFixes();
      }
      return synced;
    } catch {
      return 0;
    }
  }

  /**
   * Trigger a full refresh of the memory layer
   * Syncs git changes, updates importance scores, etc.
   */
  triggerRefresh(): {
    gitSynced: number;
    importanceUpdated: boolean;
    tasksExecuted: string[];
  } {
    this.activityGate.recordActivity();

    // Force git sync
    this.gitStalenessChecker.updateCachedHead();
    const gitSynced = this.forceSyncGitChanges();

    // Update importance scores
    this.learningEngine.updateImportanceScores();

    return {
      gitSynced,
      importanceUpdated: true,
      tasksExecuted: ['git-sync', 'importance-update']
    };
  }

  /**
   * Get refresh system status
   */
  getRefreshStatus(): {
    lastActivity: number;
    isIdle: boolean;
    idleDuration: number;
    gitHead: string | null;
    hasNewCommits: boolean;
    idleTasks: Array<{
      name: string;
      lastRun: number;
      readyToRun: boolean;
    }>;
  } {
    const status = this.activityGate.getStatus();

    return {
      lastActivity: this.activityGate.getLastActivity(),
      isIdle: status.isIdle,
      idleDuration: status.idleDuration,
      gitHead: this.gitStalenessChecker.getCachedHead(),
      hasNewCommits: this.gitStalenessChecker.hasNewCommits(),
      idleTasks: status.tasks.map(t => ({
        name: t.name,
        lastRun: t.lastRun,
        readyToRun: t.readyToRun
      }))
    };
  }

  /**
   * Record AI feedback - learn from what suggestions were actually used
   */
  recordAIFeedback(suggestion: string, wasUsed: boolean, correction?: string): void {
    this.learningEngine.trackEvent({
      eventType: wasUsed ? 'context_used' : 'context_ignored',
      query: suggestion,
    });

    // If there was a correction, record it for learning
    if (correction) {
      this.dejaVu.recordQuery(correction, [], true);
    }
  }

  async getContext(query: string, currentFile?: string, maxTokens?: number): Promise<AssembledContext> {
    // Record activity for refresh system
    this.activityGate.recordActivity();

    // Track the query
    this.learningEngine.trackEvent({ eventType: 'query', query });

    // Get expanded queries for better retrieval
    const expandedQueries = this.learningEngine.expandQuery(query);

    const result = await this.contextAssembler.assemble(query, {
      currentFile,
      maxTokens: maxTokens || this.config.maxTokens
    });

    // Track which files were included in context
    for (const source of result.sources) {
      this.learningEngine.trackEvent({ eventType: 'context_used', filePath: source, query });
    }

    // Track query pattern for future predictions
    this.learningEngine.trackQuery(query, result.sources);

    // Track in feature context
    this.featureContextManager.onQuery(query, result.sources);

    return result;
  }

  async searchCodebase(query: string, limit: number = 10): Promise<SearchResult[]> {
    this.activityGate.recordActivity();
    const embedding = await this.indexer.getEmbeddingGenerator().embed(query);
    let results = this.tier2.search(embedding, limit * 2); // Get more for re-ranking

    // Apply personalized ranking
    results = this.learningEngine.applyPersonalizedRanking(results);

    return results.slice(0, limit);
  }

  async recordDecision(
    title: string,
    description: string,
    files?: string[],
    tags?: string[]
  ): Promise<Decision> {
    this.activityGate.recordActivity();
    const decision = await this.decisionTracker.recordDecision(title, description, files || [], tags || []);

    // Log activity for decision recording
    this.livingDocs.getActivityTracker().logActivity(
      'decision_recorded',
      `Decision: ${title}`,
      undefined,
      { decisionId: decision.id }
    );

    // Auto-mark decisions as critical context
    this.contextRotPrevention.markCritical(
      `Decision: ${title}\n${description}`,
      {
        type: 'decision',
        reason: 'Architectural decision',
        source: 'auto'
      }
    );

    return decision;
  }

  getRecentDecisions(limit: number = 10): Decision[] {
    return this.decisionTracker.getRecentDecisions(limit);
  }

  /**
   * Search decisions in current project by query
   */
  async searchDecisions(query: string, limit: number = 5): Promise<Decision[]> {
    const embedding = await this.indexer.getEmbeddingGenerator().embed(query);
    return this.tier2.searchDecisions(embedding, limit);
  }

  async getFileContext(filePath: string): Promise<{ content: string; language: string; lines: number } | null> {
    this.activityGate.recordActivity();
    const absolutePath = join(this.config.projectPath, filePath);

    if (!existsSync(absolutePath)) {
      return null;
    }

    try {
      // Check hot cache first
      let content = this.learningEngine.getFromHotCache(filePath);

      if (!content) {
        content = readFileSync(absolutePath, 'utf-8');
        // Add to hot cache for faster future access
        this.learningEngine.addToHotCache(filePath, content);
      }

      const language = detectLanguage(filePath);
      const lines = countLines(content);

      // Track file view
      this.learningEngine.trackEvent({ eventType: 'file_view', filePath });

      // Track in feature context
      this.featureContextManager.onFileOpened(filePath);

      // Update Tier 1 with this as the active file
      this.tier1.setActiveFile({
        path: filePath,
        content: getPreview(content, 2000),
        language
      });

      return { content, language, lines };
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  getProjectSummary(): ProjectSummary {
    const savedSummary = this.tier2.getProjectSummary();
    const languages = this.tier2.getLanguages();
    const totalFiles = this.tier2.getFileCount();
    const totalLines = this.tier2.getTotalLines();
    const recentDecisions = this.decisionTracker.getRecentDecisions(5);

    // Try to detect dependencies from package.json or similar
    const dependencies = this.detectDependencies();

    return {
      name: savedSummary?.name || basename(this.config.projectPath),
      description: savedSummary?.description || 'No description available',
      languages,
      totalFiles,
      totalLines,
      keyDirectories: savedSummary?.keyDirectories || this.detectKeyDirectories(),
      recentDecisions,
      dependencies,
      architectureNotes: savedSummary?.architectureNotes || ''
    };
  }

  private updateProjectSummary(): void {
    const languages = this.tier2.getLanguages();
    const keyDirs = this.detectKeyDirectories();

    this.tier2.updateProjectSummary(
      basename(this.config.projectPath),
      '',
      languages,
      keyDirs,
      ''
    );
  }

  // Phase 2: Auto-extract decisions from git commits and code comments
  private async extractDecisions(): Promise<void> {
    try {
      const extractor = new DecisionExtractor(this.config.projectPath);
      const extracted = await extractor.extractAll();

      if (extracted.length === 0) {
        return;
      }

      console.error(`Found ${extracted.length} potential decisions from git/comments`);

      // Convert and store decisions (limit to avoid flooding)
      const decisions = extractor.toDecisions(extracted.slice(0, 10));

      for (const decision of decisions) {
        // Check if we already have a similar decision
        const existing = this.tier2.getRecentDecisions(50);
        const isDuplicate = existing.some(d =>
          d.title.toLowerCase() === decision.title.toLowerCase() ||
          d.description.includes(decision.description.slice(0, 50))
        );

        if (!isDuplicate) {
          // Generate embedding and store
          const textToEmbed = `${decision.title}\n${decision.description}`;
          const embedding = await this.indexer.getEmbeddingGenerator().embed(textToEmbed);
          this.tier2.upsertDecision(decision, embedding);
          this.tier1.addDecision(decision);
        }
      }

      console.error('Decision extraction complete');
    } catch (error) {
      console.error('Error extracting decisions:', error);
    }
  }

  private detectKeyDirectories(): string[] {
    const commonDirs = ['src', 'lib', 'app', 'pages', 'components', 'api', 'server', 'client', 'core'];
    const found: string[] = [];

    for (const dir of commonDirs) {
      if (existsSync(join(this.config.projectPath, dir))) {
        found.push(dir);
      }
    }

    return found;
  }

  private detectDependencies(): string[] {
    const deps: string[] = [];

    // Check package.json
    const packageJsonPath = join(this.config.projectPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies
        };
        deps.push(...Object.keys(allDeps).slice(0, 20)); // Limit to 20
      } catch {
        // Ignore parse errors
      }
    }

    // Check requirements.txt
    const requirementsPath = join(this.config.projectPath, 'requirements.txt');
    if (existsSync(requirementsPath)) {
      try {
        const content = readFileSync(requirementsPath, 'utf-8');
        const lines = content.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))
          .map(l => l.split(/[=<>]/)[0]?.trim())
          .filter((l): l is string => !!l);
        deps.push(...lines.slice(0, 20));
      } catch {
        // Ignore
      }
    }

    return deps;
  }

  setCurrentGoal(goal: string): void {
    this.tier1.setCurrentGoal(goal);
  }

  // Phase 2: Symbol search
  async searchSymbols(name: string, kind?: string, limit: number = 10): Promise<CodeSymbol[]> {
    return this.tier2.searchSymbols(name, kind as SymbolKind | undefined, limit);
  }

  // Phase 2: Get file dependencies
  getFileDependencies(filePath: string): {
    imports: Array<{ file: string; symbols: string[] }>;
    importedBy: Array<{ file: string; symbols: string[] }>;
    symbols: Array<{ name: string; kind: string; line: number; exported: boolean }>;
  } {
    const file = this.tier2.getFile(filePath);

    if (!file) {
      return { imports: [], importedBy: [], symbols: [] };
    }

    // Get what this file imports
    const fileImports = this.tier2.getImportsByFile(file.id);
    const imports = fileImports.map(i => ({
      file: i.importedFrom,
      symbols: i.importedSymbols
    }));

    // Get files that import this file
    const dependents = this.tier2.getFileDependents(filePath);
    const importedBy = dependents.map(d => ({
      file: d.file,
      symbols: d.imports
    }));

    // Get symbols defined in this file
    const fileSymbols = this.tier2.getSymbolsByFile(file.id);
    const symbols = fileSymbols.map(s => ({
      name: s.name,
      kind: s.kind,
      line: s.lineStart,
      exported: s.exported
    }));

    return { imports, importedBy, symbols };
  }

  // Find circular dependencies in the project
  findCircularDependencies(): Array<string[]> {
    return this.tier2.findCircularDependencies();
  }

  // Get transitive dependents (all files affected by changing a file)
  getTransitiveDependents(filePath: string, maxDepth: number = 3): Array<{ file: string; depth: number; imports: string[] }> {
    return this.tier2.getTransitiveDependents(filePath, maxDepth);
  }

  // Phase 2: Get symbol count
  getSymbolCount(): number {
    return this.tier2.getSymbolCount();
  }

  // Phase 3: Get predicted files for pre-fetching
  getPredictedFiles(currentFile: string, query: string): string[] {
    return this.learningEngine.predictNeededFiles(currentFile, query);
  }

  // Phase 3: Pre-fetch predicted files into hot cache
  async preFetchFiles(currentFile: string, query: string): Promise<number> {
    const predicted = this.learningEngine.predictNeededFiles(currentFile, query);
    let fetched = 0;

    for (const filePath of predicted) {
      if (!this.learningEngine.isInHotCache(filePath)) {
        const absolutePath = join(this.config.projectPath, filePath);
        if (existsSync(absolutePath)) {
          try {
            const content = readFileSync(absolutePath, 'utf-8');
            this.learningEngine.addToHotCache(filePath, content);
            fetched++;
          } catch {
            // Skip files that can't be read
          }
        }
      }
    }

    return fetched;
  }

  // Phase 3: Get file summary (compressed representation)
  getFileSummary(filePath: string): string | null {
    const file = this.tier2.getFile(filePath);
    if (!file) return null;

    // Check if we have a cached summary
    const cached = this.summarizer.getSummary(file.id);
    if (cached && !this.summarizer.needsRegeneration(file.id, file.lastModified)) {
      return cached.summary;
    }

    // Generate new summary
    const symbols = this.tier2.getSymbolsByFile(file.id);
    const imports = this.tier2.getImportsByFile(file.id);
    const exports = this.tier2.getExportsByFile(file.id);

    const summary = this.summarizer.generateSummary(
      filePath,
      file.preview,
      symbols,
      imports.map(i => ({ importedFrom: i.importedFrom, importedSymbols: i.importedSymbols })),
      exports.map(e => ({ exportedName: e.exportedName }))
    );

    // Store for future use
    this.summarizer.storeSummary(file.id, summary);

    return summary;
  }

  // Phase 3: Get summaries for multiple files (for compressed context)
  getFileSummaries(filePaths: string[]): Map<string, string> {
    const result = new Map<string, string>();

    for (const filePath of filePaths) {
      const summary = this.getFileSummary(filePath);
      if (summary) {
        result.set(filePath, summary);
      }
    }

    return result;
  }

  // Phase 3: Get learning/usage statistics
  getLearningStats(): {
    usageStats: ReturnType<LearningEngine['getUsageStats']>;
    compressionStats: ReturnType<FileSummarizer['getCompressionStats']>;
    hotCacheStats: ReturnType<LearningEngine['getHotCacheStats']>;
  } {
    return {
      usageStats: this.learningEngine.getUsageStats(),
      compressionStats: this.summarizer.getCompressionStats(),
      hotCacheStats: this.learningEngine.getHotCacheStats()
    };
  }

  // Phase 3: Mark context as useful/not useful for learning
  markContextUsefulness(query: string, wasUseful: boolean): void {
    this.learningEngine.updateQueryUsefulness(query, wasUseful);
  }

  // Phase 3: Get frequently accessed files
  getFrequentFiles(limit: number = 20): string[] {
    return this.learningEngine.getFrequentFiles(limit);
  }

  // Phase 3: Expand query for better search
  expandQuery(query: string): string[] {
    return this.learningEngine.expandQuery(query);
  }

  // ========== Phase 4: Multi-Project & Team Features ==========

  // Get all registered projects
  listProjects(): ProjectInfo[] {
    return this.projectManager.listProjects();
  }

  // Get current active project
  getActiveProject(): ProjectInfo | null {
    return this.projectManager.getActiveProject();
  }

  // Get project by ID
  getProject(projectId: string): ProjectInfo | null {
    return this.projectManager.getProject(projectId);
  }

  // Switch to a different project
  switchProject(projectId: string): boolean {
    return this.projectManager.setActiveProject(projectId);
  }

  // Discover projects in common locations
  discoverProjects(): string[] {
    return this.projectManager.discoverProjects();
  }

  // Cross-project search - search across all registered projects
  async searchAllProjects(query: string, limit: number = 10): Promise<Array<{
    project: string;
    projectId: string;
    results: SearchResult[];
  }>> {
    const allResults: Array<{
      project: string;
      projectId: string;
      results: SearchResult[];
    }> = [];

    const projectDbs = this.projectManager.getProjectDatabases();

    try {
      // Generate embedding for query
      const embedding = await this.indexer.getEmbeddingGenerator().embed(query);

      for (const { project, db } of projectDbs) {
        try {
          // Search each project's database
          const tempTier2 = new Tier2Storage(db);
          const results = tempTier2.search(embedding, limit);

          if (results.length > 0) {
            allResults.push({
              project: project.name,
              projectId: project.id,
              results
            });
          }
        } catch (err) {
          console.error(`Error searching project ${project.name}:`, err);
        }
      }
    } finally {
      // Close all database connections
      this.projectManager.closeAllDatabases(projectDbs);
    }

    // Sort by best match across projects
    allResults.sort((a, b) => {
      const maxA = Math.max(...a.results.map(r => r.similarity));
      const maxB = Math.max(...b.results.map(r => r.similarity));
      return maxB - maxA;
    });

    return allResults;
  }

  // Cross-project decision search
  async searchAllDecisions(query: string, limit: number = 10): Promise<Array<{
    project: string;
    projectId: string;
    decisions: Decision[];
  }>> {
    const allResults: Array<{
      project: string;
      projectId: string;
      decisions: Decision[];
    }> = [];

    const projectDbs = this.projectManager.getProjectDatabases();

    try {
      // Generate embedding for query
      const embedding = await this.indexer.getEmbeddingGenerator().embed(query);

      for (const { project, db } of projectDbs) {
        try {
          const tempTier2 = new Tier2Storage(db);
          const decisions = tempTier2.searchDecisions(embedding, limit);

          if (decisions.length > 0) {
            allResults.push({
              project: project.name,
              projectId: project.id,
              decisions
            });
          }
        } catch (err) {
          console.error(`Error searching decisions in ${project.name}:`, err);
        }
      }
    } finally {
      this.projectManager.closeAllDatabases(projectDbs);
    }

    return allResults;
  }

  // Record decision with author attribution
  async recordDecisionWithAuthor(
    title: string,
    description: string,
    author: string,
    files?: string[],
    tags?: string[],
    status: 'proposed' | 'accepted' | 'deprecated' | 'superseded' = 'accepted'
  ): Promise<Decision> {
    const decision: Decision = {
      id: crypto.randomUUID(),
      title,
      description,
      files: files || [],
      tags: tags || [],
      createdAt: new Date(),
      author,
      status
    };

    // Generate embedding
    const textToEmbed = `${title}\n${description}`;
    const embedding = await this.indexer.getEmbeddingGenerator().embed(textToEmbed);

    // Store in tier2
    this.tier2.upsertDecision(decision, embedding);

    // Add to tier1 for recent decisions
    this.tier1.addDecision(decision);

    return decision;
  }

  // Update decision status
  updateDecisionStatus(
    decisionId: string,
    status: 'proposed' | 'accepted' | 'deprecated' | 'superseded',
    supersededBy?: string
  ): boolean {
    return this.tier2.updateDecisionStatus(decisionId, status, supersededBy);
  }

  // Get all decisions (for export)
  getAllDecisions(): Decision[] {
    return this.tier2.getAllDecisions();
  }

  // Export single decision to ADR file
  exportDecisionToADR(decisionId: string, options?: ADRExportOptions): string | null {
    const decisions = this.getAllDecisions();
    const decision = decisions.find(d => d.id === decisionId);

    if (!decision) {
      return null;
    }

    return this.adrExporter.exportDecision(decision, options);
  }

  // Export all decisions to ADR files
  exportAllDecisionsToADR(options?: ADRExportOptions): string[] {
    const decisions = this.getAllDecisions();
    return this.adrExporter.exportAllDecisions(decisions, options);
  }

  // Update project stats (called after indexing)
  private updateProjectStats(): void {
    const project = this.projectManager.getActiveProject();
    if (project) {
      this.projectManager.updateProjectStats(project.id, {
        totalFiles: this.tier2.getFileCount(),
        totalDecisions: this.getAllDecisions().length,
        languages: this.tier2.getLanguages()
      });
    }
  }

  // ========== Phase 5: Active Feature Context ==========

  // Get the hot context for current feature
  getHotContext(): HotContext {
    return this.featureContextManager.getHotContext();
  }

  // Get current active feature context
  getActiveFeatureContext(): ActiveFeatureContext | null {
    return this.featureContextManager.getCurrentContext();
  }

  // Get summary of current feature context
  getActiveContextSummary(): { name: string; files: number; changes: number; duration: number } | null {
    return this.featureContextManager.getCurrentSummary();
  }

  // Start a new feature context
  startFeatureContext(name?: string): ActiveFeatureContext {
    return this.featureContextManager.startNewContext(name);
  }

  // Set feature context name
  setFeatureContextName(name: string): boolean {
    return this.featureContextManager.setContextName(name);
  }

  // Get recent feature contexts
  getRecentFeatureContexts(): ActiveFeatureContext[] {
    return this.featureContextManager.getRecentContexts();
  }

  // Switch to a previous feature context
  switchFeatureContext(contextId: string): boolean {
    return this.featureContextManager.switchToRecent(contextId);
  }

  // Complete current feature context
  completeFeatureContext(): boolean {
    return this.featureContextManager.completeContext();
  }

  // Track a file being opened (for external triggers)
  trackFileOpened(filePath: string): void {
    this.featureContextManager.onFileOpened(filePath);
  }

  // Track a file being edited
  trackFileEdited(filePath: string, diff: string, linesChanged?: number[]): void {
    this.featureContextManager.onFileEdited(filePath, diff, linesChanged || []);
  }

  // Track a query with files used
  trackQuery(query: string, filesUsed: string[]): void {
    this.featureContextManager.onQuery(query, filesUsed);
  }

  // Get feature context manager for direct access
  getFeatureContextManager(): FeatureContextManager {
    return this.featureContextManager;
  }

  // ========== Phase 6: Living Documentation ==========

  // Get project architecture overview
  async getArchitecture(): Promise<ArchitectureDoc> {
    return this.livingDocs.generateArchitectureDocs();
  }

  // Get detailed documentation for a component/file
  async getComponentDoc(path: string): Promise<ComponentDoc> {
    return this.livingDocs.generateComponentDoc(path);
  }

  // Get changelog of recent changes
  async getChangelog(options?: ChangelogOptions): Promise<DailyChangelog[]> {
    return this.livingDocs.generateChangelog(options || {});
  }

  // Validate documentation status
  async validateDocs(): Promise<ValidationResult> {
    return this.livingDocs.validateDocs();
  }

  // Query recent project activity
  async whatHappened(since: string, scope?: string): Promise<ActivityResult> {
    return this.livingDocs.whatHappened(since, scope);
  }

  // Find undocumented code
  async findUndocumented(options?: {
    importance?: 'low' | 'medium' | 'high' | 'all';
    type?: 'file' | 'function' | 'class' | 'interface' | 'all';
  }): Promise<UndocumentedItem[]> {
    return this.livingDocs.findUndocumented(options);
  }

  // ========== Phase 7: Context Rot Prevention ==========

  // Get context health status
  getContextHealth(): ContextHealth {
    return this.contextRotPrevention.getContextHealth();
  }

  // Set current token count (for external tracking)
  setContextTokens(tokens: number): void {
    this.contextRotPrevention.setCurrentTokens(tokens);
  }

  // Detect drift from initial requirements
  detectDrift(): DriftResult {
    return this.contextRotPrevention.detectDrift();
  }

  // Mark content as critical (never compress)
  markCritical(
    content: string,
    options?: {
      type?: CriticalContext['type'];
      reason?: string;
      source?: string;
    }
  ): CriticalContext {
    return this.contextRotPrevention.markCritical(content, options);
  }

  // Get all critical context
  getCriticalContext(type?: CriticalContext['type']): CriticalContext[] {
    return this.contextRotPrevention.getCriticalContext(type);
  }

  // Remove a critical context item
  removeCriticalContext(id: string): boolean {
    return this.contextRotPrevention.removeCritical(id);
  }

  // Trigger context compaction
  triggerCompaction(options: CompactionOptions): CompactionResult {
    return this.contextRotPrevention.triggerCompaction(options);
  }

  // Auto-compact based on current health
  autoCompact(): CompactionResult {
    return this.contextRotPrevention.autoCompact();
  }

  // Add a message to conversation tracking
  addConversationMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    this.contextRotPrevention.addMessage({ role, content });
  }

  // Clear conversation history
  clearConversation(): void {
    this.contextRotPrevention.clearConversation();
  }

  // Get context summary for AI (includes critical context and drift warnings)
  getContextSummaryForAI(): string {
    return this.contextRotPrevention.getContextSummaryForAI();
  }

  // ========== Phase 8: Confidence Scoring ==========

  // Get confidence score for code
  async getConfidence(code: string, context?: string): Promise<ConfidenceResult> {
    return this.confidenceScorer.getConfidence(code, context);
  }

  // List sources for code suggestion
  async listConfidenceSources(code: string, context?: string, includeSnippets?: boolean): Promise<ConfidenceSources> {
    return this.confidenceScorer.listSources(code, context, includeSnippets);
  }

  // Check for conflicts with past decisions
  async checkCodeConflicts(code: string): Promise<ConflictResult> {
    return this.confidenceScorer.checkConflicts(code);
  }

  // Get confidence level indicator emoji
  getConfidenceIndicator(level: ConfidenceLevel): string {
    return ConfidenceScorer.getIndicator(level);
  }

  // Format confidence result for display
  formatConfidenceResult(result: ConfidenceResult): string {
    return ConfidenceScorer.formatResult(result);
  }

  // ========== Phase 9: Change Intelligence ==========

  // Query what changed
  whatChanged(options: ChangeQueryOptions = {}): ChangeQueryResult {
    return this.changeIntelligence.whatChanged(options);
  }

  // Get changes for a specific file
  whatChangedIn(file: string, limit?: number): Change[] {
    return this.changeIntelligence.whatChangedIn(file, limit);
  }

  // Diagnose why something broke
  whyBroke(error: string, options?: { file?: string; line?: number }): Diagnosis {
    return this.changeIntelligence.whyBroke(error, options);
  }

  // Find similar bugs from history
  findSimilarBugs(error: string, limit?: number): PastBug[] {
    return this.changeIntelligence.findSimilarBugs(error, limit);
  }

  // Suggest fixes for an error
  suggestFix(error: string, context?: string): FixSuggestion[] {
    return this.changeIntelligence.suggestFix(error, context);
  }

  // Get recent changes
  getRecentChanges(hours: number = 24): Change[] {
    return this.changeIntelligence.getRecentChanges(hours);
  }

  // Format changes for display
  formatChanges(result: ChangeQueryResult): string {
    return ChangeIntelligence.formatChanges(result);
  }

  // Format diagnosis for display
  formatDiagnosis(diagnosis: Diagnosis): string {
    return ChangeIntelligence.formatDiagnosis(diagnosis);
  }

  // Format fix suggestions for display
  formatFixSuggestions(suggestions: FixSuggestion[]): string {
    return ChangeIntelligence.formatFixSuggestions(suggestions);
  }

  // ========== Phase 10: Architecture Enforcement ==========

  // Validate code against patterns
  validatePattern(code: string, type?: string): PatternValidationResult {
    const category = type === 'auto' || !type ? undefined : type as PatternCategory;
    return this.architectureEnforcement.validatePattern(code, category);
  }

  // Suggest existing functions for an intent
  suggestExisting(intent: string, limit?: number): ExistingFunction[] {
    return this.architectureEnforcement.suggestExisting(intent, limit);
  }

  // Learn a new pattern
  learnPattern(
    code: string,
    name: string,
    description?: string,
    category?: string
  ): { success: boolean; patternId?: string; message: string } {
    return this.architectureEnforcement.learnPattern(
      code,
      name,
      description,
      category as PatternCategory | undefined
    );
  }

  // List all patterns
  listPatterns(category?: string): Pattern[] {
    return this.architectureEnforcement.listPatterns(category as PatternCategory | undefined);
  }

  // Get a specific pattern
  getPattern(id: string): Pattern | null {
    return this.architectureEnforcement.getPattern(id);
  }

  // Add example to existing pattern
  addPatternExample(
    patternId: string,
    code: string,
    explanation: string,
    isAntiPattern: boolean = false
  ): boolean {
    return this.architectureEnforcement.addExample(patternId, code, explanation, isAntiPattern);
  }

  // Add rule to existing pattern
  addPatternRule(
    patternId: string,
    rule: string,
    severity: 'info' | 'warning' | 'critical'
  ): boolean {
    return this.architectureEnforcement.addRule(patternId, rule, severity);
  }

  // Search patterns
  searchPatterns(query: string): Pattern[] {
    return this.architectureEnforcement.searchPatterns(query);
  }

  // Delete a pattern
  deletePattern(id: string): boolean {
    return this.architectureEnforcement.deletePattern(id);
  }

  // Get architecture statistics
  getArchitectureStats(): {
    patterns: {
      total: number;
      byCategory: Record<string, number>;
      topPatterns: Array<{ name: string; usageCount: number }>;
    };
    functions: {
      total: number;
      exported: number;
      byPurpose: Record<string, number>;
    };
  } {
    return this.architectureEnforcement.getStats();
  }

  // Refresh the function index
  refreshArchitectureIndex(): void {
    this.architectureEnforcement.refreshIndex();
  }

  // Format validation result for display
  formatValidationResult(result: PatternValidationResult): string {
    return ArchitectureEnforcement.formatValidationResult(result);
  }

  // Format pattern list for display
  formatPatternList(patterns: Pattern[]): string {
    return ArchitectureEnforcement.formatPatternList(patterns);
  }

  // Format existing suggestions for display
  formatExistingSuggestions(suggestions: ExistingFunction[]): string {
    return ArchitectureEnforcement.formatSuggestions(suggestions);
  }

  // ========== Phase 11: Test-Aware Suggestions ==========

  // Get tests related to a file or function
  getRelatedTests(file: string, fn?: string): TestInfo[] {
    return this.testAwareness.getRelatedTests(file, fn);
  }

  // Get tests for a specific file
  getTestsForFile(file: string): TestInfo[] {
    return this.testAwareness.getTestsForFile(file);
  }

  // Get all tests in the project
  getAllTests(): TestInfo[] {
    return this.testAwareness.getAllTests();
  }

  // Check if a code change would break tests
  checkTests(code: string, file: string): TestValidationResult {
    return this.testAwareness.checkTests(code, file);
  }

  // Suggest test updates for a change
  suggestTestUpdate(change: string, failingTests?: string[]): TestUpdate[] {
    return this.testAwareness.suggestTestUpdate(change, failingTests);
  }

  // Get test coverage for a file
  getTestCoverage(file: string): TestCoverage {
    return this.testAwareness.getCoverage(file);
  }

  // Get detected test framework
  getTestFramework(): TestFramework {
    return this.testAwareness.getFramework();
  }

  // Get total test count
  getTestCount(): number {
    return this.testAwareness.getTestCount();
  }

  // Generate test template for a function
  generateTestTemplate(file: string, functionName: string): string {
    return this.testAwareness.generateTestTemplate(file, functionName);
  }

  // Suggest new tests for uncovered functions
  suggestNewTests(file: string): Array<{ function: string; template: string; priority: 'high' | 'medium' | 'low' }> {
    return this.testAwareness.suggestNewTests(file);
  }

  // Refresh test index
  refreshTestIndex(): { testsIndexed: number; framework: TestFramework } {
    return this.testAwareness.refreshIndex();
  }

  // Format test validation result for display
  formatTestValidationResult(result: TestValidationResult): string {
    return this.testAwareness.formatValidationResult(result);
  }

  // Format test coverage for display
  formatTestCoverage(coverage: TestCoverage): string {
    return this.testAwareness.formatCoverage(coverage);
  }

  // Format test list for display
  formatTestList(tests: TestInfo[]): string {
    return this.testAwareness.formatTestList(tests);
  }

  // Format test updates for display
  formatTestUpdates(updates: TestUpdate[]): string {
    return this.testAwareness['testSuggester'].formatTestUpdates(updates);
  }

  // ========== Phase 12: Ghost Mode + Déjà Vu ==========

  /**
   * Get ghost insight - what the system knows about current work
   */
  getGhostInsight(): GhostInsight {
    return this.ghostMode.getInsight();
  }

  /**
   * Get ghost insight with conflict check for specific code
   */
  getGhostInsightForCode(code: string, targetFile?: string): GhostInsight {
    return this.ghostMode.getInsightForCode(code, targetFile);
  }

  /**
   * Check for conflicts with past decisions
   */
  checkGhostConflicts(code: string, targetFile?: string): ConflictWarning[] {
    return this.ghostMode.checkConflicts(code, targetFile);
  }

  /**
   * Notify ghost mode of file access (for silent tracking)
   */
  async notifyFileAccess(filePath: string): Promise<void> {
    await this.ghostMode.onFileAccess(filePath);
  }

  /**
   * Find similar past problems (déjà vu detection)
   */
  async findDejaVu(query: string, limit?: number): Promise<DejaVuMatch[]> {
    return this.dejaVu.findSimilar(query, limit);
  }

  /**
   * Record query for future déjà vu detection
   */
  recordQueryForDejaVu(query: string, files: string[], wasUseful?: boolean): void {
    this.dejaVu.recordQuery(query, files, wasUseful);
  }

  /**
   * Resurrect context from last session
   * "Welcome back! Last time you were working on X, stuck on Y"
   */
  resurrectContext(options?: ContextResurrectionOptions): ResurrectedContext {
    return this.featureContextManager.resurrectContext(options);
  }

  /**
   * Get all contexts that can be resurrected
   */
  getResurrectableContexts(): Array<{ id: string; name: string; lastActive: Date; summary: string }> {
    return this.featureContextManager.getResurrectableContexts();
  }

  /**
   * Get comprehensive ghost mode data
   * Combines ghost insight, déjà vu matches, and resurrection data
   */
  async getFullGhostData(
    mode: 'full' | 'conflicts' | 'dejavu' | 'resurrect' = 'full',
    options?: { code?: string; file?: string; query?: string }
  ): Promise<{
    ghost?: GhostInsight;
    dejaVu?: DejaVuMatch[];
    resurrection?: ResurrectedContext;
    conflicts?: ConflictWarning[];
  }> {
    const result: {
      ghost?: GhostInsight;
      dejaVu?: DejaVuMatch[];
      resurrection?: ResurrectedContext;
      conflicts?: ConflictWarning[];
    } = {};

    if (mode === 'full' || mode === 'conflicts') {
      if (options?.code) {
        result.ghost = this.ghostMode.getInsightForCode(options.code, options.file);
        result.conflicts = result.ghost.potentialConflicts;
      } else {
        result.ghost = this.ghostMode.getInsight();
      }
    }

    if (mode === 'full' || mode === 'dejavu') {
      if (options?.query || options?.code) {
        result.dejaVu = await this.dejaVu.findSimilar(options.query || options.code || '', 5);
      }
    }

    if (mode === 'full' || mode === 'resurrect') {
      result.resurrection = this.featureContextManager.resurrectContext();
    }

    return result;
  }

  /**
   * Get déjà vu statistics
   */
  getDejaVuStats(): { totalQueries: number; usefulQueries: number; avgUsefulness: number } {
    return this.dejaVu.getStats();
  }

  // ========== Phase 13: Code Verification (Pre-Commit Quality Gate) ==========

  /**
   * Verify code for common AI-generated issues
   * Catches: hallucinated imports, security vulnerabilities, dependency issues
   */
  async verifyCode(
    code: string,
    file?: string,
    checks: VerificationCheck[] = ['all']
  ): Promise<VerificationResult> {
    return this.codeVerifier.verify(code, file, checks);
  }

  /**
   * Quick security scan without full verification
   */
  quickSecurityScan(code: string, language?: string): SecurityScanResult {
    return this.codeVerifier.scanSecurity(code, language);
  }

  /**
   * Verify imports only
   */
  verifyImports(code: string, file?: string): ImportVerification {
    return this.codeVerifier.verifyImports(code, file);
  }

  /**
   * Check dependencies only
   */
  checkCodeDependencies(code: string): DependencyCheckResult {
    return this.codeVerifier.checkDependencies(code);
  }

  // ==================== Dead Code Detection ====================

  /**
   * Find dead code in the project: unused exports and files with no dependents.
   * Returns a comprehensive report with confidence scores.
   */
  findDeadCode(): DeadCodeReport {
    const detector = new DeadCodeDetector(this.tier2);
    return detector.analyze();
  }

  /**
   * Find unused exports only.
   */
  findUnusedExports(): UnusedExport[] {
    const detector = new DeadCodeDetector(this.tier2);
    return detector.findUnusedExports();
  }

  /**
   * Find files with no dependents.
   */
  findUnusedFiles(): UnusedFile[] {
    const detector = new DeadCodeDetector(this.tier2);
    return detector.findUnusedFiles();
  }

  /**
   * Format dead code report for CLI output.
   */
  formatDeadCodeReport(report: DeadCodeReport): string {
    const detector = new DeadCodeDetector(this.tier2);
    return detector.formatReport(report);
  }

  /**
   * Format dead code report as JSON.
   */
  formatDeadCodeReportJSON(report: DeadCodeReport): string {
    const detector = new DeadCodeDetector(this.tier2);
    return detector.formatReportJSON(report);
  }

  // ==================== Test Impact Analysis ====================

  /**
   * Analyze which tests need to run based on changed files.
   * Returns affected files, tests to run, and estimated time savings.
   */
  analyzeTestImpact(changedFiles: string[]): TestImpactResult {
    const analyzer = new TestImpactAnalyzer(this.tier2, this.testAwareness, this.config.projectPath);
    return analyzer.analyzeImpact(changedFiles);
  }

  /**
   * Analyze test impact using git to detect changed files.
   * Uses staged + unstaged changes by default.
   */
  analyzeTestImpactFromGit(): TestImpactResult {
    const analyzer = new TestImpactAnalyzer(this.tier2, this.testAwareness, this.config.projectPath);
    const changedFiles = analyzer.getChangedFilesFromGit();
    return analyzer.analyzeImpact(changedFiles);
  }

  /**
   * Analyze test impact compared to a specific branch.
   */
  analyzeTestImpactFromBranch(baseBranch: string = 'main'): TestImpactResult {
    const analyzer = new TestImpactAnalyzer(this.tier2, this.testAwareness, this.config.projectPath);
    const changedFiles = analyzer.getChangedFilesFromBranch(baseBranch);
    return analyzer.analyzeImpact(changedFiles);
  }

  /**
   * Get changed files from git (staged + unstaged).
   */
  getChangedFilesFromGit(): string[] {
    const analyzer = new TestImpactAnalyzer(this.tier2, this.testAwareness, this.config.projectPath);
    return analyzer.getChangedFilesFromGit();
  }

  /**
   * Format test impact result for CLI output.
   */
  formatTestImpactReport(result: TestImpactResult): string {
    const analyzer = new TestImpactAnalyzer(this.tier2, this.testAwareness, this.config.projectPath);
    return analyzer.formatReport(result);
  }

  /**
   * Format test impact result as JSON.
   */
  formatTestImpactReportJSON(result: TestImpactResult): string {
    const analyzer = new TestImpactAnalyzer(this.tier2, this.testAwareness, this.config.projectPath);
    return analyzer.formatReportJSON(result);
  }

  // ==================== Blast Radius Analysis ====================

  /**
   * Analyze the blast radius of changing a file.
   * Returns risk score, affected files, critical paths, and recommendations.
   */
  getBlastRadius(filePath: string, maxDepth: number = 3): BlastRadiusResult {
    const analyzer = new BlastRadiusAnalyzer(this.tier2, this.testAwareness);
    return analyzer.analyze(filePath, maxDepth);
  }

  /**
   * Get blast radius for multiple files.
   */
  getBlastRadiusMultiple(filePaths: string[], maxDepth: number = 3): BlastRadiusResult[] {
    const analyzer = new BlastRadiusAnalyzer(this.tier2, this.testAwareness);
    return filePaths.map(filePath => analyzer.analyze(filePath, maxDepth));
  }

  /**
   * Format blast radius result for CLI output.
   */
  formatBlastRadiusReport(result: BlastRadiusResult): string {
    const analyzer = new BlastRadiusAnalyzer(this.tier2, this.testAwareness);
    return analyzer.formatReport(result);
  }

  /**
   * Format blast radius result as JSON.
   */
  formatBlastRadiusReportJSON(result: BlastRadiusResult): string {
    const analyzer = new BlastRadiusAnalyzer(this.tier2, this.testAwareness);
    return analyzer.formatReportJSON(result);
  }

  // ==================== Cost/Token Tracking ====================

  /**
   * Record token usage for a query.
   * Call this after each query to track usage.
   */
  recordTokenUsage(queryType: string, tokensUsed: number): void {
    const tracker = new CostTracker(this.tier2);
    tracker.recordUsage(queryType, tokensUsed);
  }

  /**
   * Get usage statistics for a time period.
   */
  getUsageStats(period: StatsPeriod = 'month'): UsageStats {
    const tracker = new CostTracker(this.tier2);
    return tracker.getStats(period);
  }

  /**
   * Format usage stats for CLI output.
   */
  formatUsageReport(stats: UsageStats): string {
    const tracker = new CostTracker(this.tier2);
    return tracker.formatReport(stats);
  }

  /**
   * Format usage stats as JSON.
   */
  formatUsageReportJSON(stats: UsageStats): string {
    const tracker = new CostTracker(this.tier2);
    return tracker.formatReportJSON(stats);
  }

  shutdown(): void {
    console.error('Shutting down CodeImpact...');
    this.indexer.stopWatching();
    this.activityGate.shutdown();
    this.tier1.save();
    this.featureContextManager.shutdown();
    closeDatabase(this.db);
  }
}
