import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import type { CodeImpactEngine } from '../../core/engine.js';
import { SkillEvolutionEngine } from '../../core/knowledge/skill-evolution.js';
import { SkillReader } from '../../core/knowledge/skill-reader.js';
import { IntelligenceCollector } from '../../core/knowledge/intelligence-collector.js';
import {
  ensureKnowledgeWorkspace,
  readManifest,
  writeManifest,
  toProjectRelative,
} from '../../core/knowledge/workspace.js';
import { renderSkillMd, getSkillPath, type SkillMdInput } from '../../core/knowledge/skill-generator.js';

export interface MemoryEvolveInput {
  action:
    | 'create_skill'
    | 'improve_skill'
    | 'create_doc'
    | 'report_outcome'
    | 'list_signals'
    | 'get_evolution_status';
  name?: string;
  description?: string;
  scope?: 'core' | 'technology' | 'feature' | 'risk';
  content?: string;
  skill_id?: string;
  section?: string;
  old_text?: string;
  new_text?: string;
  reason?: string;
  outcome?: 'success' | 'failure' | 'partial';
  skills_used?: string[];
  file?: string;
  task_description?: string;
  feature_name?: string;
  doc_type?: 'component' | 'feature' | 'architecture';
  metadata?: Record<string, string>;
}

export interface MemoryEvolveResponse {
  success: boolean;
  action: string;
  message: string;
  data?: Record<string, unknown>;
}

export async function handleMemoryEvolve(
  engine: CodeImpactEngine,
  input: MemoryEvolveInput,
): Promise<MemoryEvolveResponse> {
  const action = input.action || 'get_evolution_status';

  switch (action) {
    case 'create_skill':
      return handleCreateSkill(engine, input);
    case 'improve_skill':
      return handleImproveSkill(engine, input);
    case 'create_doc':
      return handleCreateDoc(engine, input);
    case 'report_outcome':
      return handleReportOutcome(engine, input);
    case 'list_signals':
      return handleListSignals(engine);
    case 'get_evolution_status':
      return handleGetStatus(engine, input);
    default:
      return {
        success: false,
        action,
        message: `Unknown action: ${action}. Use create_skill, improve_skill, create_doc, report_outcome, list_signals, or get_evolution_status.`,
      };
  }
}

async function handleCreateSkill(
  engine: CodeImpactEngine,
  input: MemoryEvolveInput,
): Promise<MemoryEvolveResponse> {
  if (!input.name) {
    return { success: false, action: 'create_skill', message: 'name is required (slug-friendly skill name, e.g. "better-sqlite3-patterns").' };
  }
  if (!input.description) {
    return { success: false, action: 'create_skill', message: 'description is required — one-line summary of when to use this skill.' };
  }
  if (!input.content) {
    return { success: false, action: 'create_skill', message: 'content is required — the full SKILL.md markdown body (everything below the frontmatter).' };
  }

  const scope = input.scope || 'feature';
  const skillPath = getSkillPath(engine.getProjectPath(), input.name, scope);

  if (existsSync(skillPath)) {
    return {
      success: false,
      action: 'create_skill',
      message: `Skill "${input.name}" already exists at ${toProjectRelative(engine.getProjectPath(), skillPath)}. Use improve_skill to update it.`,
    };
  }

  const skillInput: SkillMdInput = {
    name: input.name,
    description: input.description,
    scope,
    metadata: {
      project: 'codeimpact',
      scope,
      created_by: 'ai',
      ...(input.metadata || {}),
    },
    body: input.content,
  };

  const content = renderSkillMd(skillInput);
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, content);

  const manifest = readManifest(engine.getProjectPath());
  const relPath = toProjectRelative(engine.getProjectPath(), skillPath);
  const entry = {
    name: input.name,
    description: input.description,
    scope,
    file: relPath,
    updatedAt: new Date().toISOString(),
  };
  const existingIdx = manifest.skills.findIndex((s) => s.name === input.name);
  if (existingIdx >= 0) {
    manifest.skills[existingIdx] = entry;
  } else {
    manifest.skills.push(entry);
  }
  writeManifest(engine.getProjectPath(), manifest);

  engine.logSkillEvolution({
    skillId: input.name,
    action: 'create',
    section: 'all',
    content: `AI-created skill: ${input.description.slice(0, 100)}`,
    reason: input.reason || 'Created by AI assistant via memory_evolve',
  });

  return {
    success: true,
    action: 'create_skill',
    message: `Skill "${input.name}" created at ${relPath}.`,
    data: { name: input.name, scope, path: relPath },
  };
}

async function handleImproveSkill(
  engine: CodeImpactEngine,
  input: MemoryEvolveInput,
): Promise<MemoryEvolveResponse> {
  const skillName = input.skill_id || input.name;
  if (!skillName) {
    return { success: false, action: 'improve_skill', message: 'skill_id (or name) is required.' };
  }

  if (input.old_text && input.new_text) {
    return patchSkillFile(engine, skillName, input.old_text, input.new_text, input.reason);
  }

  if (input.section && input.content) {
    return appendToSkillSection(engine, skillName, input.section, input.content, input.reason);
  }

  if (input.content && !input.section) {
    return appendToSkillSection(engine, skillName, 'pitfalls', input.content, input.reason);
  }

  return {
    success: false,
    action: 'improve_skill',
    message: 'Provide either: (1) old_text + new_text for a patch, or (2) section + content to append.',
  };
}

function patchSkillFile(
  engine: CodeImpactEngine,
  skillName: string,
  oldText: string,
  newText: string,
  reason?: string,
): MemoryEvolveResponse {
  const filePath = findSkillByName(engine.getProjectPath(), skillName);
  if (!filePath) {
    return { success: false, action: 'improve_skill', message: `Skill "${skillName}" not found.` };
  }

  const content = readFileSync(filePath, 'utf-8');
  if (!content.includes(oldText)) {
    return {
      success: false,
      action: 'improve_skill',
      message: `old_text not found in skill "${skillName}". Read the skill first to get the exact text.`,
    };
  }

  const updated = content.replace(oldText, newText);
  writeFileSync(filePath, updated);

  engine.logSkillEvolution({
    skillId: skillName,
    action: 'patch',
    section: 'body',
    content: `Replaced: "${oldText.slice(0, 60)}..." → "${newText.slice(0, 60)}..."`,
    reason: reason || 'Patched by AI via memory_evolve',
  });

  return {
    success: true,
    action: 'improve_skill',
    message: `Skill "${skillName}" patched successfully.`,
    data: { skill_name: skillName, method: 'patch' },
  };
}

function appendToSkillSection(
  engine: CodeImpactEngine,
  skillName: string,
  section: string,
  content: string,
  reason?: string,
): MemoryEvolveResponse {
  const filePath = findSkillByName(engine.getProjectPath(), skillName);
  if (!filePath) {
    return { success: false, action: 'improve_skill', message: `Skill "${skillName}" not found.` };
  }

  let md = readFileSync(filePath, 'utf-8');
  const sectionHeaders = ['## When to Use', '## Key Facts', '## Rules', '## Pitfalls', '## Verification', '## Steps', '## Watch Out', '## Verify', '## What'];
  const headerMap: Record<string, string> = {
    rules: '## Rules',
    pitfalls: '## Pitfalls',
    verification: '## Verification',
    steps: '## Steps',
    when_to_use: '## When to Use',
    key_facts: '## Key Facts',
    constraints: '## Rules',
  };

  const header = headerMap[section] || `## ${section.charAt(0).toUpperCase() + section.slice(1)}`;
  const idx = md.indexOf(header);

  if (idx < 0) {
    md = md.trimEnd() + `\n\n${header}\n\n- ${content}\n`;
  } else {
    const afterHeader = idx + header.length;
    let nextSection = -1;
    for (const h of sectionHeaders) {
      if (h === header) continue;
      const pos = md.indexOf(h, afterHeader);
      if (pos > 0 && (nextSection < 0 || pos < nextSection)) {
        nextSection = pos;
      }
    }
    const insertAt = nextSection >= 0 ? nextSection : md.length;
    const sectionBody = md.slice(afterHeader, insertAt);
    if (sectionBody.includes(content)) {
      return {
        success: true,
        action: 'improve_skill',
        message: `Content already exists in ${section} of "${skillName}".`,
        data: { skill_name: skillName, already_present: true },
      };
    }
    md = md.slice(0, insertAt) + `- ${content}\n` + md.slice(insertAt);
  }

  writeFileSync(filePath, md);

  engine.logSkillEvolution({
    skillId: skillName,
    action: 'append',
    section,
    content: content.slice(0, 120),
    reason: reason || 'Appended by AI via memory_evolve',
  });

  return {
    success: true,
    action: 'improve_skill',
    message: `Added to ${section} in skill "${skillName}".`,
    data: { skill_name: skillName, section, method: 'append' },
  };
}

function findSkillByName(projectPath: string, skillName: string): string | null {
  const paths = ensureKnowledgeWorkspace(projectPath);
  const slug = slugify(skillName);

  const categories = ['core', 'technology', 'features', 'risk'];
  for (const cat of categories) {
    const catDir = join(paths.skillsRoot, cat);
    if (!existsSync(catDir)) continue;

    const directPath = join(catDir, slug, 'SKILL.md');
    if (existsSync(directPath)) return directPath;

    try {
      for (const entry of readdirSync(catDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = join(catDir, entry.name, 'SKILL.md');
        if (existsSync(nested)) {
          const content = readFileSync(nested, 'utf-8').slice(0, 512);
          const nameMatch = content.match(/name:\s*(.+)/);
          if (nameMatch?.[1] && slugify(nameMatch[1].trim()) === slug) return nested;
        }
        const deepNested = join(catDir, entry.name, slug, 'SKILL.md');
        if (existsSync(deepNested)) return deepNested;
      }
    } catch { /* ignore */ }
  }

  return null;
}

async function handleCreateDoc(
  engine: CodeImpactEngine,
  input: MemoryEvolveInput,
): Promise<MemoryEvolveResponse> {
  if (!input.content) {
    return { success: false, action: 'create_doc', message: 'content is required — provide the full markdown body.' };
  }

  const docType = input.doc_type || 'feature';
  const paths = ensureKnowledgeWorkspace(engine.getProjectPath());
  let outputPath: string;
  let docName: string;

  if (input.feature_name) {
    docName = slugify(input.feature_name);
    outputPath = join(paths.featureDocsRoot, `${docName}.md`);
  } else if (input.file) {
    docName = input.file.replace(/\\/g, '/').replace(/\.[^.]+$/, '').replace(/[^a-z0-9/]/gi, '-');
    const docRoot = docType === 'architecture' ? paths.architectureDocsRoot : join(paths.docsRoot, 'components');
    outputPath = join(docRoot, `${docName}.md`);
  } else {
    return { success: false, action: 'create_doc', message: 'Either feature_name or file is required.' };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, input.content);

  const manifest = readManifest(engine.getProjectPath());
  const relPath = toProjectRelative(engine.getProjectPath(), outputPath);
  const existingIdx = manifest.docs.findIndex((d) => d.file === relPath);
  const manifestType = docType === 'component' ? 'feature' : docType as 'architecture' | 'feature';
  const entry = { type: manifestType, file: relPath, updatedAt: new Date().toISOString() };
  if (existingIdx >= 0) {
    manifest.docs[existingIdx] = entry;
  } else {
    manifest.docs.push(entry);
  }
  writeManifest(engine.getProjectPath(), manifest);

  return {
    success: true,
    action: 'create_doc',
    message: `Documentation written to ${relPath} (type: ${docType}).`,
    data: { path: relPath, doc_type: docType, name: input.feature_name || input.file },
  };
}

async function handleListSignals(
  engine: CodeImpactEngine,
): Promise<MemoryEvolveResponse> {
  const reader = new SkillReader(engine.getProjectPath());
  const existingSkills = reader.readLevel0();
  const existingNames = new Set(existingSkills.map((s) => slugify(s.name)));

  let intel;
  try {
    const collector = new IntelligenceCollector(engine);
    intel = collector.collect();
  } catch {
    return {
      success: true,
      action: 'list_signals',
      message: 'Could not collect project intelligence. Existing skills listed.',
      data: {
        existing_skills: existingSkills.map((s) => ({ name: s.name, description: s.description, scope: s.scope })),
        uncovered_technologies: [],
        uncovered_risk_files: [],
        low_usage_skills: [],
      },
    };
  }

  const uncoveredTechs = intel.detectedTechnologies
    .filter((t) => !existingNames.has(slugify(t.name)) && !existingNames.has(slugify(t.name + '-patterns')) && !existingNames.has(slugify(t.name + '-integration')))
    .map((t) => ({
      name: t.name,
      source: t.source,
      import_paths: t.importPaths.slice(0, 3),
      suggestion: `Create a skill for ${t.name} patterns: memory_evolve(action="create_skill", name="${slugify(t.name)}-patterns", scope="technology", description="...", content="...")`,
    }));

  const uncoveredRiskFiles = intel.riskFiles
    .filter((f) => f.riskScore >= 60)
    .slice(0, 5)
    .map((f) => ({
      file: f.file,
      risk_score: f.riskScore,
      risk_level: f.riskLevel,
      dependents: f.directDependents,
      suggestion: `High-risk file without dedicated skill coverage.`,
    }));

  const usageStats = engine.getSkillUsageStats(undefined, 30);
  const lowUsage = usageStats
    .filter((s) => s.avg_score_delta < -3)
    .map((s) => ({
      skill_name: s.skill_id,
      reason: `Negative impact (avg delta: ${s.avg_score_delta})`,
    }));

  const recentlyChangedDirs = new Set<string>();
  try {
    for (const hotspot of intel.changeHotspots.slice(0, 10)) {
      const parts = hotspot.file.split('/');
      if (parts.length >= 2) recentlyChangedDirs.add(parts.slice(0, 2).join('/'));
    }
  } catch { /* ignore */ }

  return {
    success: true,
    action: 'list_signals',
    message: `${existingSkills.length} existing skills. ${uncoveredTechs.length} uncovered technologies. ${uncoveredRiskFiles.length} high-risk files. ${lowUsage.length} underperforming skills.`,
    data: {
      existing_skills: existingSkills.map((s) => ({ name: s.name, description: s.description, scope: s.scope })),
      uncovered_technologies: uncoveredTechs,
      uncovered_risk_files: uncoveredRiskFiles,
      low_usage_skills: lowUsage,
      active_areas_without_skills: Array.from(recentlyChangedDirs).slice(0, 5),
    },
  };
}

async function handleReportOutcome(
  engine: CodeImpactEngine,
  input: MemoryEvolveInput,
): Promise<MemoryEvolveResponse> {
  const outcome = input.outcome || 'success';
  const skillsUsed = input.skills_used || [];

  for (const skillId of skillsUsed) {
    engine.logSkillUsage({
      skillId,
      toolName: 'memory_evolve',
      filePath: input.file,
      outcome,
      verdict: outcome,
      scoreDelta: outcome === 'success' ? 1 : outcome === 'failure' ? -5 : 0,
    });
  }

  if (outcome === 'failure' && input.task_description) {
    for (const skillId of skillsUsed) {
      engine.logSkillEvolution({
        skillId,
        action: 'note',
        section: 'pitfalls',
        content: `Task failed: ${input.task_description.slice(0, 120)}`,
        reason: 'Outcome reported as failure',
      });
    }
  }

  return {
    success: true,
    action: 'report_outcome',
    message: `Outcome "${outcome}" recorded for ${skillsUsed.length} skill(s).`,
    data: { outcome, skills_reported: skillsUsed, file: input.file },
  };
}

async function handleGetStatus(
  engine: CodeImpactEngine,
  input: MemoryEvolveInput,
): Promise<MemoryEvolveResponse> {
  const usageStats = engine.getSkillUsageStats(input.skill_id || input.name, 30);
  const evolutionHistory = engine.getSkillEvolutionHistory(input.skill_id || input.name, 10);

  const reader = new SkillReader(engine.getProjectPath());
  const skills = reader.readLevel0();

  const mostUsed = usageStats
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, 5);

  const recentEvolutions = evolutionHistory.slice(0, 5);

  const needsAttention = usageStats
    .filter((s) => s.avg_score_delta < -5 || s.pitfall_hits > 3)
    .map((s) => ({
      skill_id: s.skill_id,
      reason: s.avg_score_delta < -5
        ? `Negative score impact (avg: ${s.avg_score_delta})`
        : `Frequent pitfall triggers (${s.pitfall_hits})`,
    }));

  return {
    success: true,
    action: 'get_evolution_status',
    message: `${skills.length} skills. ${usageStats.length} with usage data. ${needsAttention.length} need attention.`,
    data: {
      total_skills: skills.length,
      skills: skills.map((s) => ({ name: s.name, description: s.description, scope: s.scope })),
      skills_with_usage: usageStats.length,
      most_used: mostUsed.map((s) => ({
        skill_id: s.skill_id,
        usage_count: s.usage_count,
        last_used: s.last_used,
        avg_score_delta: s.avg_score_delta,
      })),
      recent_evolutions: recentEvolutions.map((e) => ({
        skill_id: e.skill_id,
        action: e.action,
        section: e.section,
        reason: e.reason,
        timestamp: e.timestamp,
      })),
      needs_attention: needsAttention,
    },
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
