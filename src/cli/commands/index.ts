// Barrel re-exports for all CLI commands
export type { CommandResult } from './types.js';
export { projectManager, findDatabasePath, resolveProjectPath } from './shared.js';
export { listProjects, addProject, removeProject, switchProject, discoverProjects } from './projects.js';
export { exportDecisions, runKnowledgeStatus, runKnowledgeGenerate, runKnowledgeSyncRules, runKnowledgeResearch } from './knowledge.js';
export { runDeadCodeAnalysis, runTestImpactAnalysis, runBlastRadiusAnalysis, runUsageStats, runAnalytics, runTail, forceReindex, showProject } from './analysis.js';
export { initProject } from './init.js';
export { printHelp, executeCLI } from './cli.js';
