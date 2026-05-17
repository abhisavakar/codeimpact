/**
 * Telemetry — SQLite-backed event emission and dashboard queries
 * for observability into the agent system's learning effectiveness.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ============================================================================
// Schema
// ============================================================================

export function createTelemetryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_telemetry (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      metadata TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_category ON agent_telemetry(category);
    CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON agent_telemetry(timestamp);
  `);
}

// ============================================================================
// Types
// ============================================================================

export type TelemetryCategory = 'generation' | 'learning' | 'research' | 'lifecycle' | 'error';

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  category: TelemetryCategory;
  action: string;
  metadata?: Record<string, unknown>;
  durationMs?: number;
}

export interface DashboardStats {
  totalEvents: number;
  byCategory: Record<string, number>;
  recentEvents: TelemetryEvent[];
  learningStats: {
    lessonsAdded: number;
    lessonsPromoted: number;
    skillsPatched: number;
    reResearchTriggered: number;
  };
  generationStats: {
    totalRuns: number;
    filesGenerated: number;
    avgDurationMs: number;
  };
  period: string;
}

// ============================================================================
// Event Emission
// ============================================================================

export function emitTelemetry(
  db: Database.Database,
  category: TelemetryCategory,
  action: string,
  metadata?: Record<string, unknown>,
  durationMs?: number,
): TelemetryEvent {
  const event: TelemetryEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    category,
    action,
    metadata,
    durationMs,
  };

  db.prepare(`
    INSERT INTO agent_telemetry (id, timestamp, category, action, metadata, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.timestamp,
    event.category,
    event.action,
    metadata ? JSON.stringify(metadata) : null,
    durationMs || null,
  );

  return event;
}

// ============================================================================
// Event Queries
// ============================================================================

export function queryTelemetry(
  db: Database.Database,
  filters: {
    category?: TelemetryCategory;
    since?: string;
    until?: string;
    action?: string;
    limit?: number;
  },
): TelemetryEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters.since) {
    conditions.push('timestamp >= ?');
    params.push(filters.since);
  }
  if (filters.until) {
    conditions.push('timestamp <= ?');
    params.push(filters.until);
  }
  if (filters.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 100;
  params.push(limit);

  const rows = db.prepare(`
    SELECT * FROM agent_telemetry ${where} ORDER BY timestamp DESC LIMIT ?
  `).all(...params) as TelemetryRow[];

  return rows.map(rowToEvent);
}

// ============================================================================
// Dashboard
// ============================================================================

export function getDashboard(
  db: Database.Database,
  since?: string,
): DashboardStats {
  const period = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = [period];

  // Total events
  const totalRow = db.prepare(
    'SELECT COUNT(*) as cnt FROM agent_telemetry WHERE timestamp >= ?'
  ).get(...params) as { cnt: number };

  // By category
  const catRows = db.prepare(
    'SELECT category, COUNT(*) as cnt FROM agent_telemetry WHERE timestamp >= ? GROUP BY category'
  ).all(...params) as Array<{ category: string; cnt: number }>;

  const byCategory: Record<string, number> = {};
  for (const row of catRows) {
    byCategory[row.category] = row.cnt;
  }

  // Recent events
  const recentRows = db.prepare(
    'SELECT * FROM agent_telemetry WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 10'
  ).all(...params) as TelemetryRow[];

  // Learning stats
  const learningActions = db.prepare(
    "SELECT action, COUNT(*) as cnt FROM agent_telemetry WHERE timestamp >= ? AND category = 'learning' GROUP BY action"
  ).all(...params) as Array<{ action: string; cnt: number }>;

  const learningStats = {
    lessonsAdded: 0,
    lessonsPromoted: 0,
    skillsPatched: 0,
    reResearchTriggered: 0,
  };
  for (const row of learningActions) {
    if (row.action === 'lesson-added') learningStats.lessonsAdded = row.cnt;
    if (row.action === 'lesson-promoted') learningStats.lessonsPromoted = row.cnt;
    if (row.action === 'skill-patched') learningStats.skillsPatched = row.cnt;
    if (row.action === 're-research-triggered') learningStats.reResearchTriggered = row.cnt;
  }

  // Generation stats
  const genRows = db.prepare(
    "SELECT COUNT(*) as cnt, SUM(duration_ms) as total_ms FROM agent_telemetry WHERE timestamp >= ? AND category = 'generation'"
  ).get(...params) as { cnt: number; total_ms: number | null };

  const filesGenRow = db.prepare(
    "SELECT SUM(json_extract(metadata, '$.filesWritten')) as total FROM agent_telemetry WHERE timestamp >= ? AND category = 'generation' AND action = 'generate-complete'"
  ).get(...params) as { total: number | null };

  const generationStats = {
    totalRuns: genRows.cnt,
    filesGenerated: filesGenRow.total || 0,
    avgDurationMs: genRows.cnt > 0 ? Math.round((genRows.total_ms || 0) / genRows.cnt) : 0,
  };

  return {
    totalEvents: totalRow.cnt,
    byCategory,
    recentEvents: recentRows.map(rowToEvent),
    learningStats,
    generationStats,
    period,
  };
}

// ============================================================================
// Internal Types
// ============================================================================

interface TelemetryRow {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  metadata: string | null;
  duration_ms: number | null;
}

function rowToEvent(row: TelemetryRow): TelemetryEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    category: row.category as TelemetryCategory,
    action: row.action,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    durationMs: row.duration_ms || undefined,
  };
}
