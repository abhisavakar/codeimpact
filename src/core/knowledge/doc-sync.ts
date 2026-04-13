import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import type { ArchitectureDoc, ComponentDoc, DailyChangelog } from '../../types/documentation.js';
import { ensureKnowledgeWorkspace, type KnowledgeManifest } from './workspace.js';

function writeJsonAndMarkdown(basePath: string, markdown: string, jsonValue: unknown): { mdPath: string; jsonPath: string } {
  const mdPath = `${basePath}.md`;
  const jsonPath = `${basePath}.json`;
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, markdown);
  writeFileSync(jsonPath, JSON.stringify(jsonValue, null, 2));
  return { mdPath, jsonPath };
}

function toRelativeDocPath(projectPath: string, filePath: string): string {
  let rel = relative(projectPath, filePath).replace(/\\/g, '/');
  if (rel.startsWith('src/')) rel = rel.slice(4);
  const ext = rel.match(/\.[^.]+$/)?.[0] || '';
  if (ext) rel = rel.slice(0, -ext.length);
  return rel;
}

export class KnowledgeDocSync {
  constructor(private readonly projectPath: string) {}

  syncArchitecture(doc: ArchitectureDoc): { mdPath: string; jsonPath: string } {
    const paths = ensureKnowledgeWorkspace(this.projectPath);

    const layerList = doc.layers
      .map((layer) => `### ${layer.name}\n- Directory: \`${layer.directory}\`\n- Purpose: ${layer.purpose}\n- Files: ${layer.files.length}`)
      .join('\n\n');

    const dataFlowList = doc.dataFlow
      .map((flow) => `- **${flow.from}** → **${flow.to}**: ${flow.description}`)
      .join('\n');

    const componentList = doc.keyComponents
      .map((c) => `- **${c.name}** (\`${c.file}\`): ${c.purpose}${c.exports.length > 0 ? `\n  - Exports: ${c.exports.slice(0, 8).join(', ')}${c.exports.length > 8 ? '...' : ''}` : ''}`)
      .join('\n');

    const depList = doc.dependencies
      .map((d) => `- ${d.name}${d.version ? ` (${d.version})` : ''} [${d.type}]`)
      .join('\n');

    const diagramSection = doc.diagram
      ? `## Diagram\n\n\`\`\`\n${doc.diagram}\n\`\`\`\n`
      : '';

    const markdown = `# Architecture: ${doc.name}

${doc.description}

${diagramSection}
## Layers

${layerList || '- No layers detected'}

## Data Flow

${dataFlowList || '- No data flow detected'}

## Key Components

${componentList || '- No key components detected'}

## Dependencies

${depList || '- No dependencies detected'}

Generated at: ${doc.generatedAt instanceof Date ? doc.generatedAt.toISOString() : doc.generatedAt}
`;
    return writeJsonAndMarkdown(join(paths.architectureDocsRoot, 'overview'), markdown, doc);
  }

  syncComponent(doc: ComponentDoc): { mdPath: string; jsonPath: string } {
    const paths = ensureKnowledgeWorkspace(this.projectPath);
    const relPath = toRelativeDocPath(this.projectPath, join(this.projectPath, doc.file));
    const targetBase = join(paths.featureDocsRoot, relPath);

    const interfaceList = doc.publicInterface
      .map((s) => {
        let line = `- ${s.kind} \`${s.name}\``;
        if (s.signature) line += ` ${s.signature}`;
        if (s.description) line += `\n  - ${s.description}`;
        return line;
      })
      .join('\n') || '- None';

    const depList = doc.dependencies
      .map((dep) => `- \`${dep.file}\`: ${dep.symbols.join(', ')}`)
      .join('\n') || '- None';

    const dependentList = doc.dependents
      .map((dep) => `- \`${dep.file}\`: ${dep.symbols.join(', ')}`)
      .join('\n') || '- None';

    let historySection = '';
    if (doc.changeHistory && doc.changeHistory.length > 0) {
      const entries = doc.changeHistory.slice(0, 10).map((entry) => {
        const date = entry.date instanceof Date ? entry.date.toISOString().split('T')[0] : String(entry.date).split('T')[0];
        return `- **${date}** ${entry.change} (by ${entry.author}, +${entry.linesChanged.added}/-${entry.linesChanged.removed})`;
      });
      historySection = `\n## Change History\n${entries.join('\n')}\n`;
    }

    let contributorsSection = '';
    if (doc.contributors && doc.contributors.length > 0) {
      contributorsSection = `\n## Contributors\n${doc.contributors.map((c) => `- ${c}`).join('\n')}\n`;
    }

    const markdown = `# Component: ${doc.name}

File: \`${doc.file}\`
Last Modified: ${doc.lastModified instanceof Date ? doc.lastModified.toISOString().split('T')[0] : doc.lastModified}

## Purpose

${doc.purpose}

## Public Interface

${interfaceList}

## Dependencies

${depList}

## Dependents

${dependentList}

## Complexity

- Level: ${doc.complexity}
- Documentation Score: ${doc.documentationScore}/100
${historySection}${contributorsSection}`;

    return writeJsonAndMarkdown(targetBase, markdown, doc);
  }

  syncChangelog(days: DailyChangelog[]): { mdPath: string; jsonPath: string } {
    const paths = ensureKnowledgeWorkspace(this.projectPath);

    for (const day of days) {
      const dateStr = day.date instanceof Date ? day.date.toISOString().split('T')[0] : String(day.date).split('T')[0];
      if (!dateStr) continue;

      const entries = [...day.features, ...day.fixes, ...day.refactors]
        .map((entry) => `- **[${entry.type}]** ${entry.description} (${entry.files.join(', ')})`)
        .join('\n');

      const metricsSection = day.metrics
        ? `\n### Metrics\n- Commits: ${day.metrics.commits}\n- Files changed: ${day.metrics.filesChanged}\n- Lines: +${day.metrics.linesAdded} / -${day.metrics.linesRemoved}\n`
        : '';

      const decisionsSection = day.decisions && day.decisions.length > 0
        ? `\n### Decisions\n${day.decisions.map((d) => `- ${d}`).join('\n')}\n`
        : '';

      const dayMarkdown = `# Changelog: ${dateStr}

${day.summary}

## Changes

${entries || '- No notable entries'}
${metricsSection}${decisionsSection}`;

      const dayBase = join(paths.changelogDocsRoot, dateStr);
      mkdirSync(dirname(dayBase), { recursive: true });
      writeFileSync(`${dayBase}.md`, dayMarkdown);
    }

    this.pruneOldChangelogs(paths.changelogDocsRoot, 30);

    const latestMarkdown = `# Changelog Snapshot

${days
  .map((day) => {
    const dateStr = day.date instanceof Date ? day.date.toISOString().split('T')[0] : String(day.date).split('T')[0];
    const entries = [...day.features, ...day.fixes, ...day.refactors]
      .map((entry) => `- **[${entry.type}]** ${entry.description} (${entry.files.join(', ')})`)
      .join('\n');
    return `## ${dateStr}\n${day.summary}\n\n${entries || '- No notable entries'}`;
  })
  .join('\n\n')}
`;
    return writeJsonAndMarkdown(join(paths.changelogDocsRoot, 'latest'), latestMarkdown, days);
  }

  syncIndex(manifest: KnowledgeManifest, validationScore?: number): { mdPath: string } {
    const paths = ensureKnowledgeWorkspace(this.projectPath);

    const archDocs = manifest.docs.filter((d) => d.type === 'architecture');
    const featureDocs = manifest.docs.filter((d) => d.type === 'feature');
    const changelogDocs = manifest.docs.filter((d) => d.type === 'changelog');
    const integrationDocs = manifest.docs.filter((d) => d.type === 'integration');

    const freshness = validationScore != null
      ? `Documentation Score: **${validationScore}/100**`
      : 'Documentation Score: *not yet validated*';

    const fileLink = (f: string) => f.replace(/\\/g, '/');

    const archList = archDocs.length > 0
      ? archDocs.map((d) => `- [${basename(d.file)}](${fileLink(d.file)}) (updated: ${d.updatedAt.split('T')[0]})`).join('\n')
      : '- Not yet generated';

    const featureList = featureDocs.length > 0
      ? featureDocs.map((d) => `- [${basename(d.file, '.md')}](${fileLink(d.file)}) (updated: ${d.updatedAt.split('T')[0]})`).join('\n')
      : '- Not yet generated';

    const changelogList = changelogDocs.length > 0
      ? changelogDocs.map((d) => `- [${basename(d.file)}](${fileLink(d.file)}) (updated: ${d.updatedAt.split('T')[0]})`).join('\n')
      : '- Not yet generated';

    const integrationList = integrationDocs.length > 0
      ? integrationDocs.map((d) => `- [${basename(d.file, '.md')}](${fileLink(d.file)}) (updated: ${d.updatedAt.split('T')[0]})`).join('\n')
      : '- Not yet generated';

    const markdown = `# Documentation Index

Generated: ${manifest.generatedAt.split('T')[0]}
${freshness}

## Summary

| Section | Count |
|---------|-------|
| Architecture | ${archDocs.length} |
| Components | ${featureDocs.length} |
| Changelog | ${changelogDocs.length} |
| Integrations | ${integrationDocs.length} |
| **Total** | **${manifest.docs.length}** |

## Architecture

${archList}

## Components

${featureList}

## Changelog

${changelogList}

## Integrations

${integrationList}
`;

    const mdPath = join(paths.docsRoot, 'README.md');
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, markdown);
    return { mdPath };
  }

  private pruneOldChangelogs(changelogDir: string, maxDays: number): void {
    try {
      if (!existsSync(changelogDir)) return;
      const files = readdirSync(changelogDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
      if (files.length <= maxDays) return;

      const sorted = files.sort();
      const toDelete = sorted.slice(0, sorted.length - maxDays);
      for (const f of toDelete) {
        try {
          unlinkSync(join(changelogDir, f));
        } catch {
          // skip
        }
      }
    } catch {
      // non-critical
    }
  }
}
