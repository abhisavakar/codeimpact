import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getKnowledgePaths } from './workspace.js';

export interface SkillLevel0 {
  name: string;
  description: string;
  scope: string;
  version: string;
  filePath: string;
}

export interface SkillLevel1 extends SkillLevel0 {
  body: string;
  metadata: Record<string, string>;
}

export interface SkillSnippet {
  id: string;
  scope: string;
  content: string;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  if (!raw.startsWith('---')) return { frontmatter: fm, body: raw };

  const endIdx = raw.indexOf('---', 3);
  if (endIdx < 0) return { frontmatter: fm, body: raw };

  const yamlBlock = raw.slice(3, endIdx).trim();
  const body = raw.slice(endIdx + 3).trim();

  let currentKey = '';
  let inMetadata = false;

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === 'metadata:') {
      inMetadata = true;
      continue;
    }
    if (inMetadata && trimmed.startsWith('  ')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        fm[`metadata.${key}`] = val;
      }
      continue;
    }
    inMetadata = false;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      currentKey = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      fm[currentKey] = val;
    }
  }

  return { frontmatter: fm, body };
}

export class SkillReader {
  private readonly projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  readLevel0(): SkillLevel0[] {
    const paths = getKnowledgePaths(this.projectPath);
    if (!existsSync(paths.skillsRoot)) return [];
    return this.scanSkillDirs(paths.skillsRoot);
  }

  readLevel1(skillName: string): SkillLevel1 | null {
    const level0 = this.readLevel0().find(
      (s) => s.name === skillName || slugify(s.name) === slugify(skillName),
    );
    if (!level0) return null;

    try {
      const raw = readFileSync(level0.filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const metadata: Record<string, string> = {};
      for (const [key, val] of Object.entries(frontmatter)) {
        if (key.startsWith('metadata.')) {
          metadata[key.slice(9)] = val;
        }
      }
      return { ...level0, body, metadata };
    } catch {
      return null;
    }
  }

  readAllSkills(): SkillSnippet[] {
    const paths = getKnowledgePaths(this.projectPath);
    if (!existsSync(paths.skillsRoot)) return [];
    return this.readDir(paths.skillsRoot, '');
  }

  readSkillsByScope(scope: string): SkillSnippet[] {
    const paths = getKnowledgePaths(this.projectPath);
    const scopeDir = this.scopeToDir(scope);
    const dir = join(paths.skillsRoot, scopeDir);
    if (!existsSync(dir)) return [];
    return this.readDir(dir, scope);
  }

  findSkillsForFile(filePath: string): SkillSnippet[] {
    const skills = this.readAllSkills();
    const lowerPath = filePath.toLowerCase();
    return skills.filter((s) => s.content.toLowerCase().includes(lowerPath));
  }

  getSkillConstraints(): string[] {
    const skills = this.readAllSkills();
    const constraints: string[] = [];
    for (const skill of skills) {
      const rulesMatch = skill.content.match(/## Rules\n([\s\S]*?)(?:\n## |$)/);
      if (rulesMatch && rulesMatch[1]) {
        const lines = rulesMatch[1].split('\n').filter((l) => l.startsWith('- '));
        for (const line of lines) {
          constraints.push(`[${skill.id}] ${line.slice(2)}`);
        }
      }
    }
    return constraints;
  }

  getSkillVerifications(): string[] {
    const skills = this.readAllSkills();
    const checks: string[] = [];
    for (const skill of skills) {
      const verifyMatch = skill.content.match(/## Verification\n([\s\S]*?)(?:\n## |$)/);
      if (verifyMatch && verifyMatch[1]) {
        const lines = verifyMatch[1].split('\n').filter((l) => l.startsWith('- '));
        for (const line of lines) {
          checks.push(`[${skill.id}] ${line.slice(2)}`);
        }
      }
    }
    return checks;
  }

  getSkillIndex(): Array<{ id: string; scope: string; summary: string }> {
    const level0Skills = this.readLevel0();
    return level0Skills.map((s) => ({
      id: s.name,
      scope: s.scope,
      summary: s.description.slice(0, 120),
    }));
  }

  private scopeToDir(scope: string): string {
    switch (scope) {
      case 'core': return 'core';
      case 'technology': return 'technology';
      case 'risk': return 'risk';
      default: return 'features';
    }
  }

  private scanSkillDirs(rootDir: string): SkillLevel0[] {
    const results: SkillLevel0[] = [];
    if (!existsSync(rootDir)) return results;

    for (const categoryEntry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!categoryEntry.isDirectory()) continue;
      const categoryDir = join(rootDir, categoryEntry.name);
      const scope = this.dirToScope(categoryEntry.name);

      for (const skillEntry of readdirSync(categoryDir, { withFileTypes: true })) {
        if (!skillEntry.isDirectory()) {
          if (skillEntry.name === 'SKILL.md') {
            const skillPath = join(categoryDir, 'SKILL.md');
            const parsed = this.parseLevel0(skillPath, scope);
            if (parsed) results.push(parsed);
          }
          continue;
        }
        const skillPath = join(categoryDir, skillEntry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        const parsed = this.parseLevel0(skillPath, scope);
        if (parsed) results.push(parsed);
      }
    }

    return results;
  }

  private parseLevel0(filePath: string, scope: string): SkillLevel0 | null {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const { frontmatter } = parseFrontmatter(raw);
      return {
        name: frontmatter['name'] || filePath.split(/[\\/]/).slice(-2, -1)[0] || 'unknown',
        description: frontmatter['description'] || '(no description)',
        scope: frontmatter['scope'] || scope,
        version: frontmatter['version'] || '1.0',
        filePath,
      };
    } catch {
      return null;
    }
  }

  private dirToScope(dirName: string): string {
    switch (dirName) {
      case 'core': case '_core': return 'core';
      case 'technology': case '_technology': return 'technology';
      case 'risk': case '_risk': return 'risk';
      case 'features': case '_features': return 'feature';
      default: return 'feature';
    }
  }

  private readDir(dir: string, scope: string): SkillSnippet[] {
    const snippets: SkillSnippet[] = [];
    if (!existsSync(dir)) return snippets;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const skillMd = join(fullPath, 'SKILL.md');
        if (existsSync(skillMd)) {
          try {
            const content = readFileSync(skillMd, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);
            snippets.push({
              id: frontmatter['name'] || entry.name,
              scope: frontmatter['scope'] || scope || 'unknown',
              content,
            });
          } catch { /* skip */ }
        }
        snippets.push(...this.readDir(fullPath, scope || entry.name));
      } else if (entry.name === 'SKILL.md' || entry.name.endsWith('.md')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);
          const id = frontmatter['name'] || entry.name.replace('.md', '');
          snippets.push({
            id,
            scope: frontmatter['scope'] || scope || 'unknown',
            content,
          });
        } catch { /* skip */ }
      }
    }
    return snippets;
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
