import type Database from 'better-sqlite3';
import type { Tier2Storage } from '../../storage/tier2.js';
import { KnowledgeDocSync } from '../knowledge/doc-sync.js';
import { ArchitectureGenerator } from './architecture-generator.js';
import { ComponentGenerator } from './component-generator.js';
import { ChangelogGenerator } from './changelog-generator.js';
import { DocValidator } from './doc-validator.js';
import { ActivityTracker } from './activity-tracker.js';
import type {
  ArchitectureDoc,
  ComponentDoc,
  DailyChangelog,
  ChangelogOptions,
  ValidationResult,
  ActivityResult,
  UndocumentedItem
} from '../../types/documentation.js';

export class LivingDocumentationEngine {
  private archGen: ArchitectureGenerator;
  private compGen: ComponentGenerator;
  private changeGen: ChangelogGenerator;
  private validator: DocValidator;
  private activityTracker: ActivityTracker;
  private db: Database.Database;
  private docSync: KnowledgeDocSync;

  constructor(
    projectPath: string,
    dataDir: string,
    db: Database.Database,
    tier2: Tier2Storage
  ) {
    this.db = db;
    this.docSync = new KnowledgeDocSync(projectPath);
    this.archGen = new ArchitectureGenerator(projectPath, tier2);
    this.compGen = new ComponentGenerator(projectPath, tier2);
    this.changeGen = new ChangelogGenerator(projectPath, db);
    this.validator = new DocValidator(projectPath, tier2, db);
    this.activityTracker = new ActivityTracker(projectPath, db, tier2);
  }

  async generateArchitectureDocs(): Promise<ArchitectureDoc> {
    const doc = await this.archGen.generate();

    this.storeDocumentation('_architecture', 'architecture', JSON.stringify(doc));

    this.activityTracker.logActivity(
      'doc_generation',
      'Generated architecture documentation',
      undefined,
      { type: 'architecture' }
    );

    this.docSync.syncArchitecture(doc);

    try {
      const validation = await this.validator.validate();
      this.storeDocumentation('_validation', 'validation', JSON.stringify({
        score: validation.score,
        outdatedDocs: validation.outdatedDocs,
        undocumentedCode: validation.undocumentedCode,
        suggestions: validation.suggestions,
      }));
    } catch {
      // validation is non-critical
    }

    return doc;
  }

  /**
   * Get the activity tracker for external use
   */
  getActivityTracker(): ActivityTracker {
    return this.activityTracker;
  }

  async generateComponentDoc(filePath: string): Promise<ComponentDoc> {
    const doc = await this.compGen.generate(filePath);

    // Store in documentation table for tracking
    this.storeDocumentation(filePath, 'component', JSON.stringify(doc));

    // Log activity
    this.activityTracker.logActivity(
      'doc_generation',
      `Generated component documentation for ${filePath}`,
      filePath,
      { type: 'component' }
    );

    this.docSync.syncComponent(doc);

    return doc;
  }

  async generateChangelog(options: ChangelogOptions = {}): Promise<DailyChangelog[]> {
    const changelog = await this.changeGen.generate(options);
    this.docSync.syncChangelog(changelog);
    return changelog;
  }

  async validateDocs(): Promise<ValidationResult> {
    return this.validator.validate();
  }

  async whatHappened(since: string, scope?: string): Promise<ActivityResult> {
    return this.activityTracker.whatHappened(since, scope);
  }

  async findUndocumented(options?: {
    importance?: 'low' | 'medium' | 'high' | 'all';
    type?: 'file' | 'function' | 'class' | 'interface' | 'all';
  }): Promise<UndocumentedItem[]> {
    return this.validator.findUndocumented(options);
  }

  private storeDocumentation(filePath: string, docType: string, content: string): void {
    try {
      // Special handling for architecture docs (no file ID)
      if (filePath === '_architecture') {
        // Use file_id = 0 for special docs like architecture
        const stmt = this.db.prepare(`
          INSERT INTO documentation (file_id, doc_type, content, generated_at)
          VALUES (0, ?, ?, unixepoch())
          ON CONFLICT(file_id, doc_type) DO UPDATE SET
            content = excluded.content,
            generated_at = unixepoch()
        `);
        stmt.run(docType, content);
        return;
      }

      // Get file ID
      const fileStmt = this.db.prepare('SELECT id FROM files WHERE path = ?');
      const fileRow = fileStmt.get(filePath) as { id: number } | undefined;

      if (fileRow) {
        const stmt = this.db.prepare(`
          INSERT INTO documentation (file_id, doc_type, content, generated_at)
          VALUES (?, ?, ?, unixepoch())
          ON CONFLICT(file_id, doc_type) DO UPDATE SET
            content = excluded.content,
            generated_at = unixepoch()
        `);
        stmt.run(fileRow.id, docType, content);
      }
    } catch {
      // Ignore storage errors
    }
  }
}
