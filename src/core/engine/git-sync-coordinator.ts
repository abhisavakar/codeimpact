/**
 * GitSyncCoordinator — extracted from CodeImpactEngine.
 * Manages git change detection, syncing, and refresh orchestration.
 */

import type { Indexer } from '../../indexing/indexer.js';
import type { LearningEngine } from '../learning.js';
import type { ChangeIntelligence } from '../change-intelligence/index.js';
import type { LivingDocumentationEngine } from '../living-docs/index.js';
import type { KnowledgeOrchestrator } from '../knowledge/index.js';
import { GitStalenessChecker, ActivityGate, GitSyncManager, formatGitChangeInfo, type GitChangeInfo } from '../refresh/index.js';

export class GitSyncCoordinator {
  private gitStalenessChecker: GitStalenessChecker;
  private gitSyncManager: GitSyncManager;
  private activityGate: ActivityGate;
  private indexer: Indexer;
  private learningEngine: LearningEngine;
  private changeIntelligence: ChangeIntelligence;
  private livingDocs: LivingDocumentationEngine;
  private knowledgeOrchestrator: KnowledgeOrchestrator;

  constructor(deps: {
    projectPath: string;
    indexer: Indexer;
    learningEngine: LearningEngine;
    changeIntelligence: ChangeIntelligence;
    livingDocs: LivingDocumentationEngine;
    gitStalenessChecker: GitStalenessChecker;
    gitSyncManager: GitSyncManager;
    activityGate: ActivityGate;
    knowledgeOrchestrator: KnowledgeOrchestrator;
  }) {
    this.indexer = deps.indexer;
    this.learningEngine = deps.learningEngine;
    this.changeIntelligence = deps.changeIntelligence;
    this.livingDocs = deps.livingDocs;
    this.gitStalenessChecker = deps.gitStalenessChecker;
    this.gitSyncManager = deps.gitSyncManager;
    this.activityGate = deps.activityGate;
    this.knowledgeOrchestrator = deps.knowledgeOrchestrator;
  }

  setupGitSyncManager(): void {
    this.gitSyncManager.initialize();

    this.gitSyncManager.onGitChange(async (change: GitChangeInfo) => {
      console.error(formatGitChangeInfo(change));
      this.knowledgeOrchestrator.schedule(`git_${change.type}`, change.changedFiles);

      switch (change.type) {
        case 'history_rewrite':
          console.error('[GitSync] History rewrite detected - triggering reindex of affected files');
          await this.handleHistoryRewrite(change);
          break;

        case 'branch_switch':
          console.error('[GitSync] Branch switch detected - triggering full reindex');
          await this.handleBranchSwitch(change);
          break;

        case 'new_commits':
          if (change.changedFiles.length > 0) {
            console.error(`[GitSync] New commits with ${change.changedFiles.length} changed files`);
            this.gitStalenessChecker.updateCachedHead();
          }
          break;

        case 'merge':
          if (change.changedFiles.length > 0) {
            console.error(`[GitSync] Merge detected with ${change.changedFiles.length} changed files`);
            this.gitStalenessChecker.updateCachedHead();
          }
          break;
      }
    });

    this.gitSyncManager.startWatching(5000);
  }

  syncGitChanges(limit: number = 20): number {
    this.activityGate.recordActivity();

    try {
      if (!this.gitStalenessChecker.hasNewCommits()) {
        return 0;
      }

      const synced = this.changeIntelligence.syncFromGit(limit);
      if (synced > 0) {
        this.changeIntelligence.scanForBugFixes();
      }
      return synced;
    } catch {
      return 0;
    }
  }

  forceSyncGitChanges(limit: number = 20): number {
    this.activityGate.recordActivity();
    this.gitStalenessChecker.updateCachedHead();

    try {
      const synced = this.changeIntelligence.syncFromGit(limit);
      if (synced > 0) {
        this.changeIntelligence.scanForBugFixes();
      }
      return synced;
    } catch {
      return 0;
    }
  }

  triggerRefresh(): {
    gitSynced: number;
    importanceUpdated: boolean;
    tasksExecuted: string[];
  } {
    this.activityGate.recordActivity();

    this.gitStalenessChecker.updateCachedHead();
    const gitSynced = this.forceSyncGitChanges();

    this.learningEngine.updateImportanceScores();

    return {
      gitSynced,
      importanceUpdated: true,
      tasksExecuted: ['git-sync', 'importance-update']
    };
  }

  getRefreshStatus(): {
    lastActivity: number;
    isIdle: boolean;
    idleDuration: number;
    gitHead: string | null;
    hasNewCommits: boolean;
    idleTasks: Array<{
      name: string;
      lastRun: number;
      readyToRun: boolean;
    }>;
  } {
    const status = this.activityGate.getStatus();
    return {
      lastActivity: this.activityGate.getLastActivity(),
      isIdle: status.isIdle,
      idleDuration: status.idleDuration,
      gitHead: this.gitStalenessChecker.getCachedHead(),
      hasNewCommits: this.gitStalenessChecker.hasNewCommits(),
      idleTasks: status.tasks.map(t => ({
        name: t.name,
        lastRun: t.lastRun,
        readyToRun: t.readyToRun
      }))
    };
  }

  private async handleHistoryRewrite(change: GitChangeInfo): Promise<void> {
    if (change.changedFiles.length > 0) {
      console.error(`[GitSync] Reindexing ${change.changedFiles.length} files after history rewrite`);
      for (const file of change.changedFiles) {
        try {
          await this.indexer.indexFile(file);
        } catch (err) {
          console.error(`[GitSync] Could not reindex ${file}: ${err}`);
        }
      }
    } else {
      console.error('[GitSync] No specific files detected, triggering full reindex');
      await this.forceFullReindex();
    }

    this.gitStalenessChecker.updateCachedHead();

    this.livingDocs.getActivityTracker().logActivity(
      'git_history_rewrite',
      `Git history rewritten: ${change.commitsRemoved} commits removed, ${change.changedFiles.length} files affected`,
      undefined,
      { type: change.type, commitsRemoved: change.commitsRemoved, filesAffected: change.changedFiles.length }
    );
  }

  private async handleBranchSwitch(change: GitChangeInfo): Promise<void> {
    console.error(`[GitSync] Switched from ${change.previousBranch || 'detached'} to ${change.currentBranch || 'detached'}`);

    if (change.changedFiles.length > 0 && change.changedFiles.length < 100) {
      console.error(`[GitSync] Reindexing ${change.changedFiles.length} files after branch switch`);
      for (const file of change.changedFiles) {
        try {
          await this.indexer.indexFile(file);
        } catch (err) {
          // File may not exist on this branch
        }
      }
    } else {
      console.error('[GitSync] Full reindex after branch switch');
      await this.forceFullReindex();
    }

    this.gitStalenessChecker.updateCachedHead();

    this.livingDocs.getActivityTracker().logActivity(
      'git_branch_switch',
      `Switched branch: ${change.previousBranch || 'detached'} → ${change.currentBranch || 'detached'}`,
      undefined,
      { from: change.previousBranch, to: change.currentBranch, filesAffected: change.changedFiles.length }
    );
  }

  async forceFullReindex(): Promise<void> {
    console.error('[GitSync] Performing full reindex...');
    await this.indexer.performInitialIndex();
    console.error('[GitSync] Full reindex complete');
  }

  shutdown(): void {
    this.gitSyncManager.stopWatching();
  }
}
