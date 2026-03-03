import type { CodeImpactEngine } from '../core/engine.js';

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const resourceDefinitions: ResourceDefinition[] = [
  {
    uri: 'codeimpact://decisions/recent',
    name: 'Recent Decisions',
    description: 'Last 10 architectural decisions made in this project',
    mimeType: 'application/json'
  },
  {
    uri: 'codeimpact://project/overview',
    name: 'Project Overview',
    description: 'High-level project summary including languages, files, and structure',
    mimeType: 'text/markdown'
  }
];

export async function handleResourceRead(
  engine: CodeImpactEngine,
  uri: string
): Promise<{ contents: string; mimeType: string }> {
  switch (uri) {
    case 'codeimpact://decisions/recent': {
      const decisions = engine.getRecentDecisions(10);

      const contents = JSON.stringify(
        decisions.map(d => ({
          id: d.id,
          title: d.title,
          description: d.description,
          files: d.files,
          tags: d.tags,
          created_at: d.createdAt.toISOString()
        })),
        null,
        2
      );

      return { contents, mimeType: 'application/json' };
    }

    case 'codeimpact://project/overview': {
      const summary = engine.getProjectSummary();

      const markdown = `# ${summary.name}

${summary.description || 'No description available.'}

## Statistics
- **Total Files**: ${summary.totalFiles}
- **Total Lines**: ${summary.totalLines.toLocaleString()}
- **Languages**: ${summary.languages.join(', ') || 'Unknown'}

## Key Directories
${summary.keyDirectories.map(d => `- \`${d}/\``).join('\n') || 'None detected'}

## Dependencies
${summary.dependencies.slice(0, 10).map(d => `- ${d}`).join('\n') || 'None detected'}
${summary.dependencies.length > 10 ? `\n... and ${summary.dependencies.length - 10} more` : ''}

## Recent Decisions
${summary.recentDecisions.length > 0
  ? summary.recentDecisions.map(d => `### ${d.title}
${d.description}
_${d.createdAt.toLocaleDateString()}_
`).join('\n')
  : 'No decisions recorded yet.'}

${summary.architectureNotes ? `## Architecture Notes\n${summary.architectureNotes}` : ''}
`;

      return { contents: markdown, mimeType: 'text/markdown' };
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}
