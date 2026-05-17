import { ADRExporter } from '../../core/adr-exporter.js';
import { PlatformRuleSync, ensureKnowledgeWorkspace, readManifest } from '../../core/knowledge/index.js';
import { ProviderResearch } from '../../core/knowledge/provider-research.js';
import { initializeDatabase } from '../../storage/database.js';
import { Tier2Storage } from '../../storage/tier2.js';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CommandResult } from './types.js';
import { projectManager, resolveProjectPath } from './shared.js';

// Export decisions to ADR
export function exportDecisions(
  projectPath?: string,
  options: { outputDir?: string; format?: 'madr' | 'nygard' | 'simple' } = {}
): CommandResult {
  // Determine project path
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.'
      };
    }
    targetPath = activeProject.path;
  }

  // Get project info
  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`
    };
  }

  // Open database and get decisions (check both new and old names)
  let dbPath = join(projectInfo.dataDir, 'codeimpact.db');
  if (!existsSync(dbPath)) {
    // Fall back to old name for backwards compatibility
    const oldDbPath = join(projectInfo.dataDir, 'codeimpact.db');
    if (existsSync(oldDbPath)) {
      dbPath = oldDbPath;
    } else {
      return {
        success: false,
        message: `Project database not found. Has the project been indexed?`
      };
    }
  }

  const db = initializeDatabase(dbPath);
  const tier2 = new Tier2Storage(db);
  const decisions = tier2.getAllDecisions();
  db.close();

  if (decisions.length === 0) {
    return {
      success: true,
      message: 'No decisions to export.'
    };
  }

  // Export
  const exporter = new ADRExporter(targetPath);
  const exportedFiles = exporter.exportAllDecisions(decisions, {
    outputDir: options.outputDir,
    format: options.format,
    includeIndex: true
  });

  return {
    success: true,
    message: `Exported ${exportedFiles.length} ADR files to ${options.outputDir || join(targetPath, 'docs', 'decisions')}`,
    data: exportedFiles
  };
}

export function runKnowledgeStatus(projectPath?: string): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  const paths = ensureKnowledgeWorkspace(resolved.targetPath);
  const manifest = readManifest(resolved.targetPath);

  const status = {
    generatedAt: manifest.generatedAt,
    skillCount: manifest.skills.length,
    docCount: manifest.docs.length,
    providerCount: manifest.providers.length,
    workspaceRoot: paths.root,
  };

  return {
    success: true,
    message: [
      'Knowledge Workspace Status',
      `Root: ${status.workspaceRoot}`,
      `Generated: ${status.generatedAt}`,
      `Skills: ${status.skillCount}`,
      `Docs: ${status.docCount}`,
      `Providers: ${status.providerCount}`,
    ].join('\n'),
    data: status,
  };
}

export function runKnowledgeGenerate(
  projectPath?: string,
  options: { reason?: string; dryRun?: boolean } = {}
): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  return {
    success: true,
    message: [
      'Knowledge generation requires the full engine.',
      'Use the MCP tool knowledge_generate or start the server and run:',
      `  codeimpact init ${resolved.targetPath}`,
      'The engine will auto-generate knowledge on startup and file changes.',
    ].join('\n'),
  };
}

export function runKnowledgeSyncRules(projectPath?: string, dryRun = false): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  const paths = ensureKnowledgeWorkspace(resolved.targetPath);
  const manifest = readManifest(resolved.targetPath);
  const skillIndex = manifest.skills.map((s) => `${s.name}: ${(s.description || '').slice(0, 80)}`);
  const platformSync = new PlatformRuleSync(resolved.targetPath);
  const result = platformSync.syncAll(paths, skillIndex, { dryRun });

  return {
    success: true,
    message: `Rules synced (${dryRun ? 'dry-run' : 'write'}): ${result.filter((entry) => entry.updated).length}/${result.length}`,
    data: result,
  };
}

export function runKnowledgeResearch(
  projectPath?: string,
  options: { topics?: string[]; dryRun?: boolean } = {}
): CommandResult {
  const resolved = resolveProjectPath(projectPath);
  if (!resolved.success || !resolved.targetPath || !resolved.projectInfo) {
    return { success: false, message: resolved.message || 'Failed to resolve project path.' };
  }

  const providerResearch = new ProviderResearch(resolved.targetPath);
  const result = providerResearch.refresh({ topics: options.topics, dryRun: options.dryRun });

  return {
    success: true,
    message: `Provider docs refreshed (${options.dryRun ? 'dry-run' : 'write'}): ${result.length}`,
    data: result,
  };
}
