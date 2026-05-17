/**
 * LivingDocsCoordinator — extracted from CodeImpactEngine.
 * Manages living documentation generation and caching.
 */

import type Database from 'better-sqlite3';
import type { LivingDocumentationEngine } from '../living-docs/index.js';
import type { ChangeIntelligence } from '../change-intelligence/index.js';
import type { ArchitectureDoc, ComponentDoc, DailyChangelog, ChangelogOptions, ValidationResult, ActivityResult, UndocumentedItem } from '../../types/documentation.js';

export class LivingDocsCoordinator {
  private db: Database.Database;
  private livingDocs: LivingDocumentationEngine;
  private changeIntelligence: ChangeIntelligence;

  constructor(deps: {
    db: Database.Database;
    livingDocs: LivingDocumentationEngine;
    changeIntelligence: ChangeIntelligence;
  }) {
    this.db = deps.db;
    this.livingDocs = deps.livingDocs;
    this.changeIntelligence = deps.changeIntelligence;
  }

  async getArchitecture(): Promise<ArchitectureDoc> {
    return this.livingDocs.generateArchitectureDocs();
  }

  async getComponentDoc(path: string): Promise<ComponentDoc> {
    return this.livingDocs.generateComponentDoc(path);
  }

  async getChangelog(options?: ChangelogOptions): Promise<DailyChangelog[]> {
    return this.livingDocs.generateChangelog(options || {});
  }

  async validateDocs(): Promise<ValidationResult> {
    return this.livingDocs.validateDocs();
  }

  async whatHappened(since: string, scope?: string): Promise<ActivityResult> {
    return this.livingDocs.whatHappened(since, scope);
  }

  async findUndocumented(options?: {
    importance?: 'low' | 'medium' | 'high' | 'all';
    type?: 'file' | 'function' | 'class' | 'interface' | 'all';
  }): Promise<UndocumentedItem[]> {
    return this.livingDocs.findUndocumented(options);
  }

  getCachedArchitectureDoc(): any | null {
    try {
      const row = this.db.prepare(
        `SELECT content FROM documentation WHERE file_id = 0 AND doc_type = 'architecture' ORDER BY generated_at DESC LIMIT 1`,
      ).get() as { content: string } | undefined;
      if (!row) return null;
      return JSON.parse(row.content);
    } catch {
      return null;
    }
  }

  getCachedDocValidation(): { score: number; outdatedDocs: any[]; undocumentedCode: any[] } | null {
    try {
      const row = this.db.prepare(
        `SELECT content FROM documentation WHERE file_id = 0 AND doc_type = 'validation' ORDER BY generated_at DESC LIMIT 1`,
      ).get() as { content: string } | undefined;
      if (row) return JSON.parse(row.content);

      const allDocs = this.db.prepare(
        `SELECT COUNT(*) as total FROM documentation WHERE doc_type != 'validation'`,
      ).get() as { total: number };
      const totalDocs = allDocs?.total ?? 0;
      if (totalDocs === 0) return null;

      return { score: 50, outdatedDocs: [], undocumentedCode: [] };
    } catch {
      return null;
    }
  }

  getCachedChangelog(): any[] | null {
    try {
      const row = this.db.prepare(
        `SELECT content FROM documentation WHERE file_id = 0 AND doc_type = 'changelog' ORDER BY generated_at DESC LIMIT 1`,
      ).get() as { content: string } | undefined;
      if (row) return JSON.parse(row.content);

      const recentChanges = this.changeIntelligence.getRecentChanges(168);
      if (recentChanges.length === 0) return null;

      const byDate = new Map<string, any[]>();
      for (const c of recentChanges) {
        const dateStr = c.timestamp instanceof Date
          ? c.timestamp.toISOString().split('T')[0]!
          : String(c.timestamp).split('T')[0]!;
        const existing = byDate.get(dateStr);
        if (existing) {
          existing.push(c);
        } else {
          byDate.set(dateStr, [c]);
        }
      }

      return Array.from(byDate.entries()).slice(0, 7).map(([date, changes]) => ({
        date: new Date(date),
        summary: `${changes.length} changes`,
        features: [],
        fixes: [],
        refactors: changes.map((c: any) => ({
          description: c.type || 'change',
          files: [c.file],
        })),
      }));
    } catch {
      return null;
    }
  }
}
