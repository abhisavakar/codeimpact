import { ProjectManager, type ProjectInfo } from '../../core/project-manager.js';
import { join } from 'path';
import { existsSync } from 'fs';

export const projectManager = new ProjectManager();

// Helper to find database path (checks both centralized and project-local locations)
export function findDatabasePath(projectInfo: ProjectInfo): string | null {
  // First try centralized location
  const centralizedPath = join(projectInfo.dataDir, 'codeimpact.db');
  if (existsSync(centralizedPath)) {
    return centralizedPath;
  }

  // Then try project-local .codeimpact directory
  const projectLocalPath = join(projectInfo.path, '.codeimpact', 'codeimpact.db');
  if (existsSync(projectLocalPath)) {
    return projectLocalPath;
  }

  return null;
}

export function resolveProjectPath(projectPath?: string): { success: boolean; message?: string; targetPath?: string; projectInfo?: ProjectInfo } {
  let targetPath = projectPath;
  if (!targetPath) {
    const activeProject = projectManager.getActiveProject();
    if (!activeProject) {
      return {
        success: false,
        message: 'No project specified and no active project. Use "codeimpact projects switch <id>" first.',
      };
    }
    targetPath = activeProject.path;
  }

  const projectInfo = projectManager.getProjectByPath(targetPath);
  if (!projectInfo) {
    return {
      success: false,
      message: `Project not registered: ${targetPath}. Use "codeimpact projects add ${targetPath}" first.`,
    };
  }

  return { success: true, targetPath, projectInfo };
}
