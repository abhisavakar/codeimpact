import type { CommandResult } from './types.js';
import { projectManager } from './shared.js';

// List all projects
export function listProjects(): CommandResult {
  const projects = projectManager.listProjects();
  const activeProject = projectManager.getActiveProject();

  if (projects.length === 0) {
    return {
      success: true,
      message: 'No projects registered. Use "codeimpact projects add <path>" to add one.'
    };
  }

  const lines = ['Registered Projects:', ''];
  for (const project of projects) {
    const isActive = activeProject?.id === project.id ? ' (active)' : '';
    lines.push(`  ${project.name}${isActive}`);
    lines.push(`    ID: ${project.id}`);
    lines.push(`    Path: ${project.path}`);
    lines.push(`    Files: ${project.totalFiles}, Decisions: ${project.totalDecisions}`);
    lines.push(`    Languages: ${project.languages.join(', ') || 'N/A'}`);
    lines.push('');
  }

  return {
    success: true,
    message: lines.join('\n'),
    data: projects
  };
}

// Add a project
export function addProject(projectPath: string): CommandResult {
  try {
    const projectInfo = projectManager.registerProject(projectPath);
    projectManager.setActiveProject(projectInfo.id);

    return {
      success: true,
      message: `Project "${projectInfo.name}" registered and set as active.\nID: ${projectInfo.id}\nData directory: ${projectInfo.dataDir}`,
      data: projectInfo
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to add project: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Remove a project
export function removeProject(projectId: string): CommandResult {
  const project = projectManager.getProject(projectId);

  if (!project) {
    return {
      success: false,
      message: `Project not found: ${projectId}`
    };
  }

  const removed = projectManager.removeProject(projectId);

  return {
    success: removed,
    message: removed
      ? `Project "${project.name}" removed from registry.`
      : `Failed to remove project.`
  };
}

// Switch to a project
export function switchProject(projectId: string): CommandResult {
  const project = projectManager.getProject(projectId);

  if (!project) {
    return {
      success: false,
      message: `Project not found: ${projectId}`
    };
  }

  const switched = projectManager.setActiveProject(projectId);

  return {
    success: switched,
    message: switched
      ? `Switched to project: ${project.name}`
      : `Failed to switch project.`
  };
}

// Discover projects
export function discoverProjects(): CommandResult {
  const discovered = projectManager.discoverProjects();

  if (discovered.length === 0) {
    return {
      success: true,
      message: 'No projects discovered in common locations.'
    };
  }

  const lines = [`Discovered ${discovered.length} potential projects:`, ''];
  for (const path of discovered) {
    const name = path.split(/[/\\]/).pop();
    lines.push(`  ${name}`);
    lines.push(`    ${path}`);
    lines.push('');
  }
  lines.push('Use "codeimpact projects add <path>" to register a project.');

  return {
    success: true,
    message: lines.join('\n'),
    data: discovered
  };
}
