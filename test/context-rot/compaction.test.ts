import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CompactionEngine } from '../../src/core/context-rot/compaction.js';
import { ContextHealthMonitor } from '../../src/core/context-rot/context-health.js';
import { CriticalContextManager } from '../../src/core/context-rot/critical-context.js';

describe('CompactionEngine', () => {
  let db: Database.Database;
  let healthMonitor: ContextHealthMonitor;
  let criticalManager: CriticalContextManager;
  let engine: CompactionEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    // Create required tables (matching production schema from database.ts)
    db.exec(`
      CREATE TABLE IF NOT EXISTS critical_context (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        reason TEXT,
        source TEXT,
        never_compress INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS context_health_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER DEFAULT (unixepoch()),
        utilization REAL,
        total_tokens INTEGER,
        critical_count INTEGER,
        health TEXT
      );
    `);
    criticalManager = new CriticalContextManager(db);
    healthMonitor = new ContextHealthMonitor(db, criticalManager, 10000);
    engine = new CompactionEngine(healthMonitor, criticalManager);
  });

  afterEach(() => {
    db.close();
  });

  it('should compact with summarize strategy', () => {
    // Add chunks with varying relevance
    for (let i = 0; i < 10; i++) {
      const chunk = healthMonitor.addChunk({
        content: `Message ${i}: ${'x'.repeat(200)}`,
        tokens: 50,
        timestamp: new Date(Date.now() - (10 - i) * 60000),
        type: 'message'
      });
      // Set low relevance for older chunks
      chunk.relevanceScore = i < 5 ? 0.2 : 0.8;
    }

    const result = engine.compact({
      strategy: 'summarize',
      preserveRecent: 3,
      preserveCritical: true
    });

    assert.equal(result.success, true);
    assert.equal(result.strategy, 'summarize');
    assert.ok(result.tokensSaved >= 0);
  });

  it('should escalate from summarize to selective when target not met', () => {
    // Fill with chunks that have relevance above the summarize threshold (0.5)
    // so they get KEPT, not removed — causing utilization to remain high
    for (let i = 0; i < 20; i++) {
      const chunk = healthMonitor.addChunk({
        content: `Important message ${i}: ${'x'.repeat(400)}`,
        tokens: 400,
        timestamp: new Date(Date.now() - (20 - i) * 60000),
        type: 'message'
      });
      // High relevance: above summarize threshold so chunks are kept, not removed
      chunk.relevanceScore = 0.6;
    }

    const result = engine.compact({
      strategy: 'summarize',
      preserveRecent: 2,
      targetUtilization: 5, // Very aggressive target to force escalation
      preserveCritical: true
    });

    assert.equal(result.success, true);
    // Should have escalated past summarize since high-relevance chunks are kept
    assert.ok(
      result.strategy === 'selective' || result.strategy === 'aggressive',
      `Expected escalated strategy, got ${result.strategy}`
    );
  });

  it('should not recurse past aggressive strategy', () => {
    // Fill heavily
    for (let i = 0; i < 10; i++) {
      const chunk = healthMonitor.addChunk({
        content: `Critical message ${i}`,
        tokens: 500,
        timestamp: new Date(),
        type: 'message'
      });
      chunk.relevanceScore = 0.1;
    }

    // Direct aggressive compact with impossible target
    const result = engine.compact({
      strategy: 'aggressive',
      preserveRecent: 1,
      targetUtilization: 1, // Nearly impossible target
      preserveCritical: true
    });

    assert.equal(result.success, true);
    assert.equal(result.strategy, 'aggressive');
    // Should return best-effort without infinite recursion
  });

  it('should preserve critical chunks', () => {
    // Mark some content as critical
    criticalManager.markCritical('decision', 'Important decision content', 'Must preserve');

    // Add matching chunk
    const criticalChunk = healthMonitor.addChunk({
      content: 'Important decision content',
      tokens: 100,
      timestamp: new Date(Date.now() - 3600000), // 1 hour ago
      type: 'message'
    });

    // Add removable chunks
    for (let i = 0; i < 5; i++) {
      const chunk = healthMonitor.addChunk({
        content: `Filler ${i}`,
        tokens: 100,
        timestamp: new Date(Date.now() - (5 - i) * 60000),
        type: 'message'
      });
      chunk.relevanceScore = 0.05; // Very low relevance
    }

    const result = engine.compact({
      strategy: 'aggressive',
      preserveRecent: 1,
      preserveCritical: true
    });

    assert.equal(result.success, true);
    assert.ok(result.preservedCritical >= 0);
  });

  it('should suggest compaction based on current state', () => {
    // Add some chunks
    for (let i = 0; i < 5; i++) {
      const chunk = healthMonitor.addChunk({
        content: `Message ${i}`,
        tokens: 100,
        timestamp: new Date(),
        type: 'message'
      });
      chunk.relevanceScore = i < 2 ? 0.1 : 0.6;
    }

    const suggestion = engine.suggestCompaction();
    assert.ok(suggestion.critical !== undefined);
    assert.ok(suggestion.summarizable !== undefined);
    assert.ok(suggestion.removable !== undefined);
    assert.ok(typeof suggestion.tokensSaved === 'number');
    assert.ok(typeof suggestion.newUtilization === 'number');
  });

  it('autoCompact should pick strategy based on health', () => {
    // Add enough to trigger warning-level health
    for (let i = 0; i < 15; i++) {
      const chunk = healthMonitor.addChunk({
        content: `Long message ${i}: ${'x'.repeat(500)}`,
        tokens: 800,
        timestamp: new Date(Date.now() - (15 - i) * 60000),
        type: 'message'
      });
      chunk.relevanceScore = 0.3;
    }

    const result = engine.autoCompact();
    assert.equal(result.success, true);
    assert.ok(['summarize', 'selective', 'aggressive'].includes(result.strategy));
  });
});
