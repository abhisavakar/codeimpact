import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ensureKnowledgeWorkspace } from './workspace.js';

export interface SkillMdInput {
  name: string;
  description: string;
  version?: string;
  scope: 'core' | 'technology' | 'feature' | 'risk';
  metadata?: Record<string, string>;
  body: string;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function renderSkillMd(input: SkillMdInput): string {
  const metaLines: string[] = [];
  if (input.metadata) {
    for (const [key, val] of Object.entries(input.metadata)) {
      metaLines.push(`  ${key}: ${val}`);
    }
  }

  const metaBlock = metaLines.length > 0
    ? `metadata:\n${metaLines.join('\n')}\n`
    : '';

  return `---
name: ${input.name}
description: ${input.description}
version: ${input.version || '1.0'}
${metaBlock}---

${input.body}
`;
}

export function getSkillPath(projectPath: string, name: string, scope: string): string {
  const paths = ensureKnowledgeWorkspace(projectPath);
  const category = scope === 'core' ? 'core'
    : scope === 'technology' ? 'technology'
    : scope === 'risk' ? 'risk'
    : 'features';
  return join(paths.skillsRoot, category, slugify(name), 'SKILL.md');
}

export function writeSkillMd(projectPath: string, input: SkillMdInput): string {
  const skillPath = getSkillPath(projectPath, input.name, input.scope);
  const content = renderSkillMd(input);
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, content);
  return skillPath;
}
