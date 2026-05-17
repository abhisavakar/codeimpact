/**
 * Outcome storage — SQLite table for agent execution results.
 * Provides CRUD operations for the agent_outcomes table.
 */

import type Database from 'better-sqlite3';
import type { OutcomeRecord, DiagnosisResult } from './types.js';
import { randomUUID } from 'crypto';

// ============================================================================
// Schema
// ============================================================================

export function createOutcomeTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_outcomes (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agent TEXT NOT NULL,
      task TEXT NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('success', 'failure', 'partial')),
      error_message TEXT,
      error_file TEXT,
      diff TEXT,
      fix_applied TEXT,
      related_skills TEXT,
      related_research TEXT,
      diagnosed INTEGER DEFAULT 0,
      diagnosis TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_outcomes_agent ON agent_outcomes(agent);
    CREATE INDEX IF NOT EXISTS idx_outcomes_timestamp ON agent_outcomes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_outcomes_result ON agent_outcomes(result);
    CREATE INDEX IF NOT EXISTS idx_outcomes_diagnosed ON agent_outcomes(diagnosed);
  `);
}

// ============================================================================
// CRUD Operations
// ============================================================================

export function recordOutcome(
  db: Database.Database,
  input: {
    agent: string;
    task: string;
    result: 'success' | 'failure' | 'partial';
    errorMessage?: string;
    errorFile?: string;
    diff?: string;
    fixApplied?: string;
    relatedSkills?: string[];
    relatedResearch?: string[];
  },
): OutcomeRecord {
  const record: OutcomeRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent: input.agent,
    task: input.task,
    result: input.result,
    errorMessage: input.errorMessage,
    errorFile: input.errorFile,
    diff: input.diff,
    fixApplied: input.fixApplied,
    relatedSkills: input.relatedSkills || [],
    relatedResearch: input.relatedResearch || [],
    diagnosed: false,
  };

  const stmt = db.prepare(`
    INSERT INTO agent_outcomes (id, timestamp, agent, task, result, error_message, error_file, diff, fix_applied, related_skills, related_research, diagnosed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.id,
    record.timestamp,
    record.agent,
    record.task,
    record.result,
    record.errorMessage || null,
    record.errorFile || null,
    record.diff || null,
    record.fixApplied || null,
    JSON.stringify(record.relatedSkills),
    JSON.stringify(record.relatedResearch),
    0,
  );

  return record;
}

export function getOutcome(db: Database.Database, id: string): OutcomeRecord | null {
  const row = db.prepare('SELECT * FROM agent_outcomes WHERE id = ?').get(id) as OutcomeRow | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

export function queryOutcomes(
  db: Database.Database,
  filters: {
    agent?: string;
    result?: string;
    diagnosed?: boolean;
    limit?: number;
    since?: string;
  },
): OutcomeRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.agent) {
    conditions.push('agent = ?');
    params.push(filters.agent);
  }
  if (filters.result) {
    conditions.push('result = ?');
    params.push(filters.result);
  }
  if (filters.diagnosed !== undefined) {
    conditions.push('diagnosed = ?');
    params.push(filters.diagnosed ? 1 : 0);
  }
  if (filters.since) {
    conditions.push('timestamp >= ?');
    params.push(filters.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const sql = `SELECT * FROM agent_outcomes ${where} ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as OutcomeRow[];
  return rows.map(rowToRecord);
}

export function markDiagnosed(
  db: Database.Database,
  id: string,
  diagnosis: DiagnosisResult,
): void {
  db.prepare(`
    UPDATE agent_outcomes SET diagnosed = 1, diagnosis = ? WHERE id = ?
  `).run(JSON.stringify(diagnosis), id);
}

export function getOutcomeStats(
  db: Database.Database,
  agent?: string,
): { total: number; successes: number; failures: number; partials: number } {
  const where = agent ? 'WHERE agent = ?' : '';
  const params = agent ? [agent] : [];

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM agent_outcomes ${where}`).get(...params) as { cnt: number }).cnt;
  const successes = (db.prepare(`SELECT COUNT(*) as cnt FROM agent_outcomes ${where} ${where ? 'AND' : 'WHERE'} result = 'success'`).get(...params) as { cnt: number }).cnt;
  const failures = (db.prepare(`SELECT COUNT(*) as cnt FROM agent_outcomes ${where} ${where ? 'AND' : 'WHERE'} result = 'failure'`).get(...params) as { cnt: number }).cnt;
  const partials = total - successes - failures;

  return { total, successes, failures, partials };
}

// ============================================================================
// Internal Types
// ============================================================================

interface OutcomeRow {
  id: string;
  timestamp: string;
  agent: string;
  task: string;
  result: string;
  error_message: string | null;
  error_file: string | null;
  diff: string | null;
  fix_applied: string | null;
  related_skills: string | null;
  related_research: string | null;
  diagnosed: number;
  diagnosis: string | null;
}

function rowToRecord(row: OutcomeRow): OutcomeRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    agent: row.agent,
    task: row.task,
    result: row.result as OutcomeRecord['result'],
    errorMessage: row.error_message || undefined,
    errorFile: row.error_file || undefined,
    diff: row.diff || undefined,
    fixApplied: row.fix_applied || undefined,
    relatedSkills: row.related_skills ? JSON.parse(row.related_skills) : [],
    relatedResearch: row.related_research ? JSON.parse(row.related_research) : [],
    diagnosed: row.diagnosed === 1,
    diagnosis: row.diagnosis ? JSON.parse(row.diagnosis) : undefined,
  };
}
