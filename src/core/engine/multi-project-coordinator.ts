/**
 * MultiProjectCoordinator — extracted from CodeImpactEngine.
 * Manages cross-project search and project switching.
 */

import type { Indexer } from '../../indexing/indexer.js';
import type { ProjectManager, ProjectInfo } from '../project-manager.js';
import { Tier2Storage } from '../../storage/tier2.js';
import type { SearchResult, Decision } from '../../types/index.js';

export class MultiProjectCoordinator {
  private projectManager: ProjectManager;
  private indexer: Indexer;

  constructor(deps: {
    projectManager: ProjectManager;
    indexer: Indexer;
  }) {
    this.projectManager = deps.projectManager;
    this.indexer = deps.indexer;
  }

  listProjects(): ProjectInfo[] {
    return this.projectManager.listProjects();
  }

  getActiveProject(): ProjectInfo | null {
    return this.projectManager.getActiveProject();
  }

  getProject(projectId: string): ProjectInfo | null {
    return this.projectManager.getProject(projectId);
  }

  switchProject(projectId: string): boolean {
    return this.projectManager.setActiveProject(projectId);
  }

  discoverProjects(): string[] {
    return this.projectManager.discoverProjects();
  }

  async searchAllProjects(query: string, limit: number = 10): Promise<Array<{
    project: string;
    projectId: string;
    results: SearchResult[];
  }>> {
    const allResults: Array<{
      project: string;
      projectId: string;
      results: SearchResult[];
    }> = [];

    const projectDbs = this.projectManager.getProjectDatabases();

    try {
      const embedding = await this.indexer.getEmbeddingGenerator().embed(query);

      for (const { project, db } of projectDbs) {
        try {
          const tempTier2 = new Tier2Storage(db);
          const results = tempTier2.search(embedding, limit);

          if (results.length > 0) {
            allResults.push({
              project: project.name,
              projectId: project.id,
              results
            });
          }
        } catch (err) {
          console.error(`Error searching project ${project.name}:`, err);
        }
      }
    } finally {
      this.projectManager.closeAllDatabases(projectDbs);
    }

    allResults.sort((a, b) => {
      const maxA = Math.max(...a.results.map(r => r.similarity));
      const maxB = Math.max(...b.results.map(r => r.similarity));
      return maxB - maxA;
    });

    return allResults;
  }

  async searchAllDecisions(query: string, limit: number = 10): Promise<Array<{
    project: string;
    projectId: string;
    decisions: Decision[];
  }>> {
    const allResults: Array<{
      project: string;
      projectId: string;
      decisions: Decision[];
    }> = [];

    const projectDbs = this.projectManager.getProjectDatabases();

    try {
      const embedding = await this.indexer.getEmbeddingGenerator().embed(query);

      for (const { project, db } of projectDbs) {
        try {
          const tempTier2 = new Tier2Storage(db);
          const decisions = tempTier2.searchDecisions(embedding, limit);

          if (decisions.length > 0) {
            allResults.push({
              project: project.name,
              projectId: project.id,
              decisions
            });
          }
        } catch (err) {
          console.error(`Error searching decisions in ${project.name}:`, err);
        }
      }
    } finally {
      this.projectManager.closeAllDatabases(projectDbs);
    }

    return allResults;
  }
}
