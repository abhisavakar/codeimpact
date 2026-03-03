/**
 * Intelligent Refresh System for CodeImpact
 *
 * This module provides a tiered refresh architecture:
 *
 * TIER 1: REAL-TIME (via file watcher)
 * - File changes → Chokidar watcher → immediate invalidation
 * - User queries → immediate tracking
 * - File access → immediate hot cache update
 *
 * TIER 2: ON-DEMAND WITH CHEAP PRE-CHECK
 * - Git sync → check HEAD first (5ms), only sync if changed
 * - Summaries → check lastModified before regenerating
 * - Bug diagnosis → sync git first if HEAD changed
 *
 * TIER 3: IDLE-TIME MAINTENANCE
 * - When user idle > 30s AND git changed → sync git
 * - When idle > 5min since last update → update importance scores
 * - One task at a time, non-blocking
 *
 * TIER 4: SESSION-BASED
 * - Engine init → full git sync
 * - Shutdown → persist state
 */

export { GitStalenessChecker } from './git-staleness-checker.js';
export { ActivityGate, type IdleTask } from './activity-gate.js';
