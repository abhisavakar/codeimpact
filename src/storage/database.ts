import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export function initializeDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Files table: stores file metadata
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      content_hash TEXT NOT NULL,
      preview TEXT,
      language TEXT,
      size_bytes INTEGER,
      line_count INTEGER,
      last_modified INTEGER,
      indexed_at INTEGER DEFAULT (unixepoch())
    );

    -- Embeddings table: stores file embeddings as binary blobs
    CREATE TABLE IF NOT EXISTS embeddings (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      dimension INTEGER NOT NULL
    );

    -- Dependencies table: tracks file relationships
    CREATE TABLE IF NOT EXISTS dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      target_file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL,
      UNIQUE(source_file_id, target_file_id, relationship)
    );

    -- Decisions table: stores architectural decisions
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      files TEXT,
      tags TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      embedding BLOB,
      -- Phase 4: Team features
      author TEXT,
      status TEXT DEFAULT 'accepted',
      superseded_by TEXT
    );

    -- Sessions table: tracks session history
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      files_viewed TEXT,
      summary TEXT
    );

    -- Project summary table
    CREATE TABLE IF NOT EXISTS project_summary (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      description TEXT,
      languages TEXT,
      key_directories TEXT,
      architecture_notes TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Phase 2: Symbols table - stores code symbols (functions, classes, etc.)
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      docstring TEXT,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      exported INTEGER NOT NULL DEFAULT 0
    );

    -- Phase 2: Imports table - tracks what each file imports
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      imported_from TEXT NOT NULL,
      imported_symbols TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_namespace INTEGER NOT NULL DEFAULT 0,
      line_number INTEGER NOT NULL
    );

    -- Phase 2: Exports table - tracks what each file exports
    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      exported_name TEXT NOT NULL,
      local_name TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      line_number INTEGER NOT NULL
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
    CREATE INDEX IF NOT EXISTS idx_files_last_modified ON files(last_modified);
    CREATE INDEX IF NOT EXISTS idx_dependencies_source ON dependencies(source_file_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_target ON dependencies(target_file_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);

    -- Phase 2: Symbol indexes
    CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
    CREATE INDEX IF NOT EXISTS idx_imports_file_id ON imports(file_id);
    CREATE INDEX IF NOT EXISTS idx_imports_from ON imports(imported_from);
    CREATE INDEX IF NOT EXISTS idx_exports_file_id ON exports(file_id);
    CREATE INDEX IF NOT EXISTS idx_exports_name ON exports(exported_name);

    -- Phase 3: Usage tracking for learning
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      file_path TEXT,
      query TEXT,
      context_used INTEGER DEFAULT 0,
      timestamp INTEGER DEFAULT (unixepoch())
    );

    -- Phase 3: File access frequency for personalized ranking
    CREATE TABLE IF NOT EXISTS file_access (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      access_count INTEGER DEFAULT 0,
      last_accessed INTEGER DEFAULT (unixepoch()),
      relevance_score REAL DEFAULT 0.5
    );

    -- Phase 3: Query patterns for prediction
    CREATE TABLE IF NOT EXISTS query_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_hash TEXT UNIQUE NOT NULL,
      query_text TEXT NOT NULL,
      result_files TEXT,
      hit_count INTEGER DEFAULT 1,
      avg_usefulness REAL DEFAULT 0.5,
      last_used INTEGER DEFAULT (unixepoch())
    );

    -- Phase 3: File summaries for compression
    CREATE TABLE IF NOT EXISTS file_summaries (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      summary_tokens INTEGER,
      generated_at INTEGER DEFAULT (unixepoch())
    );

    -- Phase 3: Indexes for usage tracking
    CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_events_file ON usage_events(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_access_count ON file_access(access_count DESC);
    CREATE INDEX IF NOT EXISTS idx_query_patterns_hash ON query_patterns(query_hash);

    -- Phase 6: Living Documentation tables
    CREATE TABLE IF NOT EXISTS documentation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      content TEXT NOT NULL,
      generated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(file_id, doc_type)
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      activity_type TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      metadata TEXT,
      commit_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(activity_type);
    CREATE INDEX IF NOT EXISTS idx_documentation_file ON documentation(file_id);

    -- Phase 7: Context Rot Prevention tables
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
      tokens_used INTEGER,
      tokens_limit INTEGER,
      utilization_percent REAL,
      drift_score REAL,
      relevance_score REAL,
      health TEXT,
      compaction_triggered INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_critical_context_type ON critical_context(type);
    CREATE INDEX IF NOT EXISTS idx_critical_context_created ON critical_context(created_at);
    CREATE INDEX IF NOT EXISTS idx_context_health_timestamp ON context_health_history(timestamp);

    -- Phase 11: Test-Aware Suggestions tables
    CREATE TABLE IF NOT EXISTS test_index (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      test_name TEXT NOT NULL,
      describes TEXT,
      covers_files TEXT,           -- JSON array
      covers_functions TEXT,       -- JSON array
      assertions TEXT,             -- JSON array
      line_start INTEGER,
      line_end INTEGER,
      last_status TEXT,
      last_run INTEGER,
      indexed_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(file_path, test_name)
    );

    CREATE TABLE IF NOT EXISTS test_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      framework TEXT NOT NULL,
      test_patterns TEXT,          -- JSON array of glob patterns
      last_indexed INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_test_index_file ON test_index(file_path);
    CREATE INDEX IF NOT EXISTS idx_test_index_name ON test_index(test_name);
    CREATE INDEX IF NOT EXISTS idx_test_covers_files ON test_index(covers_files);

    -- Intelligent Refresh System: State persistence
    CREATE TABLE IF NOT EXISTS refresh_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_state_key ON refresh_state(key);

    -- Token Usage Tracking for Cost Dashboard
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      query_type TEXT NOT NULL,
      tokens_used INTEGER NOT NULL,
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      cost_dollars REAL NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
    CREATE INDEX IF NOT EXISTS idx_token_usage_query_type ON token_usage(query_type);

    -- Migration: Add input/output columns if they don't exist (for existing databases)
    -- SQLite doesn't support IF NOT EXISTS for columns, so we handle this in code
  `);

  // Migration: Add input_tokens and output_tokens columns if they don't exist
  try {
    const columns = db.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>;
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('input_tokens')) {
      db.exec('ALTER TABLE token_usage ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0');
    }
    if (!columnNames.includes('output_tokens')) {
      db.exec('ALTER TABLE token_usage ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0');
    }
  } catch {
    // Ignore migration errors (columns may already exist)
  }

  return db;
}

export function closeDatabase(db: Database.Database): void {
  db.close();
}
