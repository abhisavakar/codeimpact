import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { ensureKnowledgeWorkspace } from '../knowledge/workspace.js';

export interface FeatureCluster {
  name: string;
  directory: string;
  files: string[];
  purpose: string;
  sharedDependencies: string[];
  decisionTags: string[];
}

export interface FeatureAggregateResult {
  clusters: FeatureCluster[];
  files: string[];
}

export class FeatureAggregator {
  constructor(
    private readonly projectPath: string,
    private readonly db: Database.Database,
  ) {}

  aggregate(): FeatureAggregateResult {
    const clusters = this.detectClusters();
    const outputFiles: string[] = [];

    if (clusters.length === 0) return { clusters, files: outputFiles };

    const paths = ensureKnowledgeWorkspace(this.projectPath);
    const aggregatedRoot = join(paths.featureDocsRoot, '_aggregated');
    mkdirSync(aggregatedRoot, { recursive: true });

    for (const cluster of clusters) {
      const slug = cluster.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const mdPath = join(aggregatedRoot, `${slug}.md`);

      const fileList = cluster.files
        .map((f) => `- \`${f}\``)
        .join('\n');

      const depList = cluster.sharedDependencies.length > 0
        ? cluster.sharedDependencies.map((d) => `- \`${d}\``).join('\n')
        : '- None detected';

      const decisionList = cluster.decisionTags.length > 0
        ? cluster.decisionTags.map((t) => `- ${t}`).join('\n')
        : '- None recorded';

      const markdown = `# Feature: ${cluster.name}

Directory: \`${cluster.directory}\`

## Purpose

${cluster.purpose}

## Components (${cluster.files.length} files)

${fileList}

## Shared Dependencies

${depList}

## Related Decisions

${decisionList}
`;

      mkdirSync(dirname(mdPath), { recursive: true });
      writeFileSync(mdPath, markdown);
      outputFiles.push(mdPath);
    }

    console.error(`[FeatureAggregator] generated ${clusters.length} feature doc(s)`);
    return { clusters, files: outputFiles };
  }

  private detectClusters(): FeatureCluster[] {
    const clusters: FeatureCluster[] = [];

    try {
      const dirGroups = this.groupByDirectory();
      const importGraph = this.buildImportGraph();
      const decisionFiles = this.getDecisionFileMap();

      for (const [dir, files] of dirGroups.entries()) {
        if (files.length < 2) continue;

        const internalEdges = this.countInternalEdges(files, importGraph);
        if (files.length >= 3 || internalEdges >= 2) {
          const sharedDeps = this.findSharedDependencies(files, importGraph);
          const tags = this.findRelatedDecisions(files, decisionFiles);
          const purpose = this.derivePurpose(dir, files, tags);

          clusters.push({
            name: this.dirToFeatureName(dir),
            directory: dir,
            files,
            purpose,
            sharedDependencies: sharedDeps,
            decisionTags: tags,
          });
        }
      }
    } catch (err) {
      console.error('[FeatureAggregator] cluster detection error:', err);
    }

    return clusters.sort((a, b) => b.files.length - a.files.length).slice(0, 20);
  }

  private groupByDirectory(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    try {
      const rows = this.db.prepare(
        `SELECT path FROM files WHERE language IS NOT NULL`,
      ).all() as Array<{ path: string }>;

      for (const row of rows) {
        const parts = row.path.replace(/\\/g, '/').split('/');
        if (parts.length < 2) continue;
        const dir = parts.slice(0, -1).join('/');
        const existing = groups.get(dir) || [];
        existing.push(row.path);
        groups.set(dir, existing);
      }
    } catch {
      // ignore
    }
    return groups;
  }

  private buildImportGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    try {
      const rows = this.db.prepare(`
        SELECT f.path as source, i.imported_from as target
        FROM imports i
        JOIN files f ON f.id = i.file_id
      `).all() as Array<{ source: string; target: string }>;

      for (const row of rows) {
        const existing = graph.get(row.source) || new Set<string>();
        existing.add(row.target);
        graph.set(row.source, existing);
      }
    } catch {
      // ignore
    }
    return graph;
  }

  private countInternalEdges(files: string[], graph: Map<string, Set<string>>): number {
    const fileSet = new Set(files.map((f) => f.replace(/\\/g, '/')));
    let count = 0;
    for (const file of files) {
      const imports = graph.get(file.replace(/\\/g, '/'));
      if (!imports) continue;
      for (const imp of imports) {
        const normalized = imp.replace(/\\/g, '/');
        if (fileSet.has(normalized) || files.some((f) => normalized.includes(basename(f, '.ts')) || normalized.includes(basename(f, '.js')))) {
          count++;
        }
      }
    }
    return count;
  }

  private findSharedDependencies(files: string[], graph: Map<string, Set<string>>): string[] {
    const depCounts = new Map<string, number>();
    for (const file of files) {
      const imports = graph.get(file.replace(/\\/g, '/'));
      if (!imports) continue;
      for (const imp of imports) {
        if (!files.some((f) => imp.includes(basename(f)))) {
          depCounts.set(imp, (depCounts.get(imp) || 0) + 1);
        }
      }
    }
    return Array.from(depCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([dep]) => dep);
  }

  private getDecisionFileMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    try {
      const rows = this.db.prepare(
        `SELECT title, files, tags FROM decisions WHERE status = 'accepted'`,
      ).all() as Array<{ title: string; files: string | null; tags: string | null }>;

      for (const row of rows) {
        const files = row.files ? JSON.parse(row.files) as string[] : [];
        const tags = row.tags ? JSON.parse(row.tags) as string[] : [];
        for (const file of files) {
          const existing = map.get(file) || [];
          existing.push(`${row.title}${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}`);
          map.set(file, existing);
        }
      }
    } catch {
      // ignore
    }
    return map;
  }

  private findRelatedDecisions(files: string[], decisionMap: Map<string, string[]>): string[] {
    const decisions = new Set<string>();
    for (const file of files) {
      const fileDecisions = decisionMap.get(file);
      if (fileDecisions) {
        for (const d of fileDecisions) decisions.add(d);
      }
    }
    return Array.from(decisions).slice(0, 10);
  }

  private derivePurpose(dir: string, files: string[], decisions: string[]): string {
    if (decisions.length > 0) {
      return `${this.dirToFeatureName(dir)} — related to: ${decisions[0]}`;
    }
    const fileNames = files.map((f) => basename(f, '.ts').replace(/-/g, ' ')).join(', ');
    return `Module containing: ${fileNames.slice(0, 120)}${fileNames.length > 120 ? '...' : ''}`;
  }

  private dirToFeatureName(dir: string): string {
    const parts = dir.replace(/\\/g, '/').split('/');
    const last = parts[parts.length - 1] || 'unknown';
    return last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]/g, ' ');
  }
}
