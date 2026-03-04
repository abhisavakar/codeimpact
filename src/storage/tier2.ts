import type Database from 'better-sqlite3';
import type { FileMetadata, Decision, SearchResult, DependencyRelation, CodeSymbol, Import, Export, SymbolKind } from '../types/index.js';

// Patterns to exclude from search results (stale data that shouldn't be indexed)
const EXCLUDED_PATH_PATTERNS = [
  'node_modules',
  '.git',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  '__pycache__',
  '.pytest_cache',
  'vendor/',
  '.venv/',
  'venv/',
];

export class Tier2Storage {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // Check if a path should be excluded from results
  private shouldExcludePath(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/');
    return EXCLUDED_PATH_PATTERNS.some(pattern => normalizedPath.includes(pattern));
  }

  // File operations
  upsertFile(
    path: string,
    contentHash: string,
    preview: string,
    language: string,
    sizeBytes: number,
    lineCount: number,
    lastModified: number
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, content_hash, preview, language, size_bytes, line_count, last_modified, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(path) DO UPDATE SET
        content_hash = excluded.content_hash,
        preview = excluded.preview,
        language = excluded.language,
        size_bytes = excluded.size_bytes,
        line_count = excluded.line_count,
        last_modified = excluded.last_modified,
        indexed_at = unixepoch()
      RETURNING id
    `);

    const result = stmt.get(path, contentHash, preview, language, sizeBytes, lineCount, lastModified) as { id: number };
    return result.id;
  }

  getFile(path: string): FileMetadata | null {
    const stmt = this.db.prepare(`
      SELECT id, path, content_hash as contentHash, preview, language,
             size_bytes as sizeBytes, line_count as lineCount,
             last_modified as lastModified, indexed_at as indexedAt
      FROM files WHERE path = ?
    `);
    return stmt.get(path) as FileMetadata | null;
  }

  getFileById(id: number): FileMetadata | null {
    const stmt = this.db.prepare(`
      SELECT id, path, content_hash as contentHash, preview, language,
             size_bytes as sizeBytes, line_count as lineCount,
             last_modified as lastModified, indexed_at as indexedAt
      FROM files WHERE id = ?
    `);
    return stmt.get(id) as FileMetadata | null;
  }

  deleteFile(path: string): void {
    const stmt = this.db.prepare('DELETE FROM files WHERE path = ?');
    stmt.run(path);
  }

  getAllFiles(): FileMetadata[] {
    const stmt = this.db.prepare(`
      SELECT id, path, content_hash as contentHash, preview, language,
             size_bytes as sizeBytes, line_count as lineCount,
             last_modified as lastModified, indexed_at as indexedAt
      FROM files
      WHERE path NOT LIKE '%node_modules%'
        AND path NOT LIKE '%.git%'
        AND path NOT LIKE '%/dist/%'
        AND path NOT LIKE '%/build/%'
      ORDER BY path
    `);
    return stmt.all() as FileMetadata[];
  }

  getFileCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM files
      WHERE path NOT LIKE '%node_modules%'
        AND path NOT LIKE '%.git%'
        AND path NOT LIKE '%/dist/%'
        AND path NOT LIKE '%/build/%'
    `);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  getTotalLines(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(line_count), 0) as total FROM files
      WHERE path NOT LIKE '%node_modules%'
        AND path NOT LIKE '%.git%'
        AND path NOT LIKE '%/dist/%'
        AND path NOT LIKE '%/build/%'
    `);
    const result = stmt.get() as { total: number };
    return result.total;
  }

  getLanguages(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT language FROM files
      WHERE language IS NOT NULL
        AND path NOT LIKE '%node_modules%'
        AND path NOT LIKE '%.git%'
        AND path NOT LIKE '%/dist/%'
        AND path NOT LIKE '%/build/%'
      ORDER BY language
    `);
    const results = stmt.all() as { language: string }[];
    return results.map(r => r.language);
  }

  // Embedding operations
  upsertEmbedding(fileId: number, embedding: Float32Array): void {
    const buffer = Buffer.from(embedding.buffer);
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (file_id, embedding, dimension)
      VALUES (?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        embedding = excluded.embedding,
        dimension = excluded.dimension
    `);
    stmt.run(fileId, buffer, embedding.length);
  }

  getEmbedding(fileId: number): Float32Array | null {
    const stmt = this.db.prepare('SELECT embedding, dimension FROM embeddings WHERE file_id = ?');
    const result = stmt.get(fileId) as { embedding: Buffer; dimension: number } | undefined;

    if (!result) return null;

    return new Float32Array(result.embedding.buffer, result.embedding.byteOffset, result.dimension);
  }

  getAllEmbeddings(): Array<{ fileId: number; embedding: Float32Array }> {
    const stmt = this.db.prepare('SELECT file_id, embedding, dimension FROM embeddings');
    const results = stmt.all() as Array<{ file_id: number; embedding: Buffer; dimension: number }>;

    return results.map(r => ({
      fileId: r.file_id,
      embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.dimension)
    }));
  }

  // Search using cosine similarity (computed in JS since sqlite-vec may not be available)
  search(queryEmbedding: Float32Array, limit: number = 10): SearchResult[] {
    const allEmbeddings = this.getAllEmbeddings();
    const results: Array<{ fileId: number; similarity: number; adjustedSimilarity: number }> = [];

    for (const { fileId, embedding } of allEmbeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);

      // Get file metadata for quality adjustment
      const file = this.getFileById(fileId);
      if (!file || this.shouldExcludePath(file.path)) continue;

      // Apply content quality multiplier to penalize empty/short files
      const qualityMultiplier = this.getContentQualityMultiplier(file);
      const adjustedSimilarity = similarity * qualityMultiplier;

      results.push({ fileId, similarity, adjustedSimilarity });
    }

    // Sort by ADJUSTED similarity descending (quality-aware ranking)
    results.sort((a, b) => b.adjustedSimilarity - a.adjustedSimilarity);

    // Get top results with file metadata
    const searchResults: SearchResult[] = [];

    for (const { fileId, adjustedSimilarity } of results) {
      if (searchResults.length >= limit) break;

      const file = this.getFileById(fileId);
      if (file) {
        searchResults.push({
          file: file.path,
          preview: file.preview,
          similarity: adjustedSimilarity, // Return adjusted similarity
          lineStart: 1,
          lineEnd: Math.min(50, file.lineCount || 50),
          lastModified: file.lastModified
        });
      }
    }

    return searchResults;
  }

  /**
   * Calculate content quality multiplier to penalize empty/short files
   * Returns a value between 0.1 and 1.0
   */
  private getContentQualityMultiplier(file: FileMetadata): number {
    const lineCount = file.lineCount || 0;
    const fileName = file.path.toLowerCase();

    // Heavily penalize __init__.py and similar marker files
    if (fileName.endsWith('__init__.py') && lineCount < 10) {
      return 0.1; // 90% penalty for near-empty __init__.py
    }

    // Penalize very short files (< 5 lines)
    if (lineCount < 5) {
      return 0.2; // 80% penalty
    }

    // Slight penalty for short files (< 20 lines)
    if (lineCount < 20) {
      return 0.5 + (lineCount / 40); // 50-100% based on line count
    }

    // Bonus for substantial files (> 50 lines) - cap at 1.0
    if (lineCount > 50) {
      return 1.0;
    }

    // Normal files (20-50 lines)
    return 0.8 + (lineCount / 250); // ~80-100%
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // Decision operations
  upsertDecision(decision: Decision, embedding?: Float32Array): void {
    const embeddingBuffer = embedding ? Buffer.from(embedding.buffer) : null;
    const stmt = this.db.prepare(`
      INSERT INTO decisions (id, title, description, files, tags, created_at, embedding, author, status, superseded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        files = excluded.files,
        tags = excluded.tags,
        embedding = excluded.embedding,
        author = excluded.author,
        status = excluded.status,
        superseded_by = excluded.superseded_by
    `);
    stmt.run(
      decision.id,
      decision.title,
      decision.description,
      JSON.stringify(decision.files),
      JSON.stringify(decision.tags),
      Math.floor(decision.createdAt.getTime() / 1000),
      embeddingBuffer,
      decision.author || null,
      decision.status || 'accepted',
      decision.supersededBy || null
    );
  }

  getDecision(id: string): Decision | null {
    const stmt = this.db.prepare('SELECT * FROM decisions WHERE id = ?');
    const row = stmt.get(id) as {
      id: string;
      title: string;
      description: string;
      files: string;
      tags: string;
      created_at: number;
      author: string | null;
      status: string | null;
      superseded_by: string | null;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      files: JSON.parse(row.files || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at * 1000),
      author: row.author || undefined,
      status: (row.status as Decision['status']) || undefined,
      supersededBy: row.superseded_by || undefined
    };
  }

  getRecentDecisions(limit: number = 10): Decision[] {
    const stmt = this.db.prepare(`
      SELECT id, title, description, files, tags, created_at, author, status, superseded_by
      FROM decisions
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: string;
      title: string;
      description: string;
      files: string;
      tags: string;
      created_at: number;
      author: string | null;
      status: string | null;
      superseded_by: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      files: JSON.parse(row.files || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at * 1000),
      author: row.author || undefined,
      status: (row.status as Decision['status']) || undefined,
      supersededBy: row.superseded_by || undefined
    }));
  }

  // Phase 4: Get all decisions (for export)
  getAllDecisions(): Decision[] {
    const stmt = this.db.prepare(`
      SELECT id, title, description, files, tags, created_at, author, status, superseded_by
      FROM decisions
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as Array<{
      id: string;
      title: string;
      description: string;
      files: string;
      tags: string;
      created_at: number;
      author: string | null;
      status: string | null;
      superseded_by: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      files: JSON.parse(row.files || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at * 1000),
      author: row.author || undefined,
      status: (row.status as Decision['status']) || undefined,
      supersededBy: row.superseded_by || undefined
    }));
  }

  // Phase 4: Update decision status
  updateDecisionStatus(
    decisionId: string,
    status: 'proposed' | 'accepted' | 'deprecated' | 'superseded',
    supersededBy?: string
  ): boolean {
    const stmt = this.db.prepare(`
      UPDATE decisions
      SET status = ?, superseded_by = ?
      WHERE id = ?
    `);
    const result = stmt.run(status, supersededBy || null, decisionId);
    return result.changes > 0;
  }

  searchDecisions(queryEmbedding: Float32Array, limit: number = 5): Decision[] {
    // Get all decisions with embeddings
    const stmt = this.db.prepare(`
      SELECT id, title, description, files, tags, created_at, embedding, author, status, superseded_by
      FROM decisions
      WHERE embedding IS NOT NULL
    `);
    const rows = stmt.all() as Array<{
      id: string;
      title: string;
      description: string;
      files: string;
      tags: string;
      created_at: number;
      embedding: Buffer;
      author: string | null;
      status: string | null;
      superseded_by: string | null;
    }>;

    if (rows.length === 0) {
      return this.getRecentDecisions(limit);
    }

    // Calculate similarity for each
    const results = rows.map(row => {
      const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, 384);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return { row, similarity };
    });

    // Sort by similarity and return top results
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit).map(({ row }) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      files: JSON.parse(row.files || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at * 1000),
      author: row.author || undefined,
      status: (row.status as Decision['status']) || undefined,
      supersededBy: row.superseded_by || undefined
    }));
  }

  // Dependency operations
  addDependency(sourceFileId: number, targetFileId: number, relationship: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO dependencies (source_file_id, target_file_id, relationship)
      VALUES (?, ?, ?)
    `);
    stmt.run(sourceFileId, targetFileId, relationship);
  }

  getDependencies(fileId: number): DependencyRelation[] {
    const stmt = this.db.prepare(`
      SELECT source_file_id as sourceFileId, target_file_id as targetFileId, relationship
      FROM dependencies
      WHERE source_file_id = ?
    `);
    return stmt.all(fileId) as DependencyRelation[];
  }

  getDependents(fileId: number): DependencyRelation[] {
    const stmt = this.db.prepare(`
      SELECT source_file_id as sourceFileId, target_file_id as targetFileId, relationship
      FROM dependencies
      WHERE target_file_id = ?
    `);
    return stmt.all(fileId) as DependencyRelation[];
  }

  clearDependencies(fileId: number): void {
    const stmt = this.db.prepare('DELETE FROM dependencies WHERE source_file_id = ?');
    stmt.run(fileId);
  }

  // Project summary
  updateProjectSummary(
    name: string,
    description: string,
    languages: string[],
    keyDirectories: string[],
    architectureNotes: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO project_summary (id, name, description, languages, key_directories, architecture_notes, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        languages = excluded.languages,
        key_directories = excluded.key_directories,
        architecture_notes = excluded.architecture_notes,
        updated_at = unixepoch()
    `);
    stmt.run(name, description, JSON.stringify(languages), JSON.stringify(keyDirectories), architectureNotes);
  }

  getProjectSummary(): { name: string; description: string; languages: string[]; keyDirectories: string[]; architectureNotes: string } | null {
    const stmt = this.db.prepare('SELECT name, description, languages, key_directories, architecture_notes FROM project_summary WHERE id = 1');
    const row = stmt.get() as {
      name: string;
      description: string;
      languages: string;
      key_directories: string;
      architecture_notes: string;
    } | undefined;

    if (!row) return null;

    return {
      name: row.name,
      description: row.description,
      languages: JSON.parse(row.languages || '[]'),
      keyDirectories: JSON.parse(row.key_directories || '[]'),
      architectureNotes: row.architecture_notes
    };
  }

  // Phase 2: Symbol operations

  clearSymbols(fileId: number): void {
    this.db.prepare('DELETE FROM symbols WHERE file_id = ?').run(fileId);
  }

  insertSymbol(symbol: CodeSymbol): number {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (file_id, kind, name, signature, docstring, line_start, line_end, exported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      symbol.fileId,
      symbol.kind,
      symbol.name,
      symbol.signature || null,
      symbol.docstring || null,
      symbol.lineStart,
      symbol.lineEnd,
      symbol.exported ? 1 : 0
    );
    return Number(result.lastInsertRowid);
  }

  insertSymbols(symbols: CodeSymbol[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (file_id, kind, name, signature, docstring, line_start, line_end, exported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((syms: CodeSymbol[]) => {
      for (const s of syms) {
        stmt.run(s.fileId, s.kind, s.name, s.signature || null, s.docstring || null, s.lineStart, s.lineEnd, s.exported ? 1 : 0);
      }
    });

    insertMany(symbols);
  }

  getSymbolsByFile(fileId: number): CodeSymbol[] {
    const stmt = this.db.prepare(`
      SELECT s.id, s.file_id as fileId, f.path as filePath, s.kind, s.name, s.signature, s.docstring,
             s.line_start as lineStart, s.line_end as lineEnd, s.exported
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.file_id = ?
      ORDER BY s.line_start
    `);
    const rows = stmt.all(fileId) as Array<{
      id: number;
      fileId: number;
      filePath: string;
      kind: string;
      name: string;
      signature: string | null;
      docstring: string | null;
      lineStart: number;
      lineEnd: number;
      exported: number;
    }>;

    return rows.map(r => ({
      id: r.id,
      fileId: r.fileId,
      filePath: r.filePath,
      kind: r.kind as SymbolKind,
      name: r.name,
      signature: r.signature || undefined,
      docstring: r.docstring || undefined,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
      exported: r.exported === 1
    }));
  }

  searchSymbols(name: string, kind?: SymbolKind, limit: number = 20): CodeSymbol[] {
    let query = `
      SELECT s.id, s.file_id as fileId, f.path as filePath, s.kind, s.name, s.signature, s.docstring,
             s.line_start as lineStart, s.line_end as lineEnd, s.exported
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name LIKE ?
        AND f.path NOT LIKE '%node_modules%'
        AND f.path NOT LIKE '%.git%'
        AND f.path NOT LIKE '%/dist/%'
        AND f.path NOT LIKE '%/build/%'
    `;

    const params: (string | number)[] = [`%${name}%`];

    if (kind) {
      query += ' AND s.kind = ?';
      params.push(kind);
    }

    query += ' ORDER BY CASE WHEN s.name = ? THEN 0 WHEN s.name LIKE ? THEN 1 ELSE 2 END, s.name LIMIT ?';
    params.push(name, `${name}%`, limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: number;
      fileId: number;
      filePath: string;
      kind: string;
      name: string;
      signature: string | null;
      docstring: string | null;
      lineStart: number;
      lineEnd: number;
      exported: number;
    }>;

    return rows.map(r => ({
      id: r.id,
      fileId: r.fileId,
      filePath: r.filePath,
      kind: r.kind as SymbolKind,
      name: r.name,
      signature: r.signature || undefined,
      docstring: r.docstring || undefined,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
      exported: r.exported === 1
    }));
  }

  getSymbolByName(name: string, kind?: SymbolKind): CodeSymbol | null {
    let query = `
      SELECT s.id, s.file_id as fileId, f.path as filePath, s.kind, s.name, s.signature, s.docstring,
             s.line_start as lineStart, s.line_end as lineEnd, s.exported
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ?
        AND f.path NOT LIKE '%node_modules%'
        AND f.path NOT LIKE '%.git%'
        AND f.path NOT LIKE '%/dist/%'
        AND f.path NOT LIKE '%/build/%'
    `;

    const params: string[] = [name];

    if (kind) {
      query += ' AND s.kind = ?';
      params.push(kind);
    }

    query += ' LIMIT 1';

    const stmt = this.db.prepare(query);
    const row = stmt.get(...params) as {
      id: number;
      fileId: number;
      filePath: string;
      kind: string;
      name: string;
      signature: string | null;
      docstring: string | null;
      lineStart: number;
      lineEnd: number;
      exported: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      fileId: row.fileId,
      filePath: row.filePath,
      kind: row.kind as SymbolKind,
      name: row.name,
      signature: row.signature || undefined,
      docstring: row.docstring || undefined,
      lineStart: row.lineStart,
      lineEnd: row.lineEnd,
      exported: row.exported === 1
    };
  }

  getSymbolCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.path NOT LIKE '%node_modules%'
        AND f.path NOT LIKE '%.git%'
        AND f.path NOT LIKE '%/dist/%'
        AND f.path NOT LIKE '%/build/%'
    `);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  // Phase 2: Import operations

  clearImports(fileId: number): void {
    this.db.prepare('DELETE FROM imports WHERE file_id = ?').run(fileId);
  }

  insertImports(imports: Import[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO imports (file_id, imported_from, imported_symbols, is_default, is_namespace, line_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((imps: Import[]) => {
      for (const i of imps) {
        stmt.run(
          i.fileId,
          i.importedFrom,
          JSON.stringify(i.importedSymbols),
          i.isDefault ? 1 : 0,
          i.isNamespace ? 1 : 0,
          i.lineNumber
        );
      }
    });

    insertMany(imports);
  }

  getImportsByFile(fileId: number): Import[] {
    const stmt = this.db.prepare(`
      SELECT i.file_id as fileId, f.path as filePath, i.imported_from as importedFrom,
             i.imported_symbols as importedSymbols, i.is_default as isDefault,
             i.is_namespace as isNamespace, i.line_number as lineNumber
      FROM imports i
      JOIN files f ON i.file_id = f.id
      WHERE i.file_id = ?
    `);
    const rows = stmt.all(fileId) as Array<{
      fileId: number;
      filePath: string;
      importedFrom: string;
      importedSymbols: string;
      isDefault: number;
      isNamespace: number;
      lineNumber: number;
    }>;

    return rows.map(r => ({
      fileId: r.fileId,
      filePath: r.filePath,
      importedFrom: r.importedFrom,
      importedSymbols: JSON.parse(r.importedSymbols),
      isDefault: r.isDefault === 1,
      isNamespace: r.isNamespace === 1,
      lineNumber: r.lineNumber
    }));
  }

  getFilesImporting(modulePath: string): Array<{ fileId: number; filePath: string }> {
    // Use exact matching with common import path patterns to avoid false positives
    // e.g., "user" should not match "super-user-service"
    const stmt = this.db.prepare(`
      SELECT DISTINCT i.file_id as fileId, f.path as filePath
      FROM imports i
      JOIN files f ON i.file_id = f.id
      WHERE i.imported_from = ?
         OR i.imported_from LIKE ?
         OR i.imported_from LIKE ?
         OR i.imported_from LIKE ?
    `);
    return stmt.all(
      modulePath,
      `%/${modulePath}`,      // ends with /modulePath
      `./${modulePath}`,      // relative ./modulePath
      `../${modulePath}`      // parent ../modulePath
    ) as Array<{ fileId: number; filePath: string }>;
  }

  // Phase 2: Export operations

  clearExports(fileId: number): void {
    this.db.prepare('DELETE FROM exports WHERE file_id = ?').run(fileId);
  }

  insertExports(exports: Export[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO exports (file_id, exported_name, local_name, is_default, line_number)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((exps: Export[]) => {
      for (const e of exps) {
        stmt.run(e.fileId, e.exportedName, e.localName || null, e.isDefault ? 1 : 0, e.lineNumber);
      }
    });

    insertMany(exports);
  }

  getExportsByFile(fileId: number): Export[] {
    const stmt = this.db.prepare(`
      SELECT e.file_id as fileId, f.path as filePath, e.exported_name as exportedName,
             e.local_name as localName, e.is_default as isDefault, e.line_number as lineNumber
      FROM exports e
      JOIN files f ON e.file_id = f.id
      WHERE e.file_id = ?
    `);
    const rows = stmt.all(fileId) as Array<{
      fileId: number;
      filePath: string;
      exportedName: string;
      localName: string | null;
      isDefault: number;
      lineNumber: number;
    }>;

    return rows.map(r => ({
      fileId: r.fileId,
      filePath: r.filePath,
      exportedName: r.exportedName,
      localName: r.localName || undefined,
      isDefault: r.isDefault === 1,
      lineNumber: r.lineNumber
    }));
  }

  // Phase 2: Dependency graph helpers

  getFileDependencies(filePath: string): Array<{ file: string; imports: string[] }> {
    const file = this.getFile(filePath);
    if (!file) return [];

    const imports = this.getImportsByFile(file.id);
    const deps: Array<{ file: string; imports: string[] }> = [];

    for (const imp of imports) {
      deps.push({
        file: imp.importedFrom,
        imports: imp.importedSymbols
      });
    }

    return deps;
  }

  getFileDependents(filePath: string): Array<{ file: string; imports: string[] }> {
    // Find files that import this file
    const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '';
    const importers = this.getFilesImporting(fileName);

    const deps: Array<{ file: string; imports: string[] }> = [];

    for (const importer of importers) {
      const imports = this.getImportsByFile(importer.fileId);
      const relevantImport = imports.find(i => {
        const importedName = i.importedFrom.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '';
        return importedName === fileName || i.importedFrom.endsWith(`/${fileName}`) || i.importedFrom.endsWith(`./${fileName}`);
      });
      if (relevantImport) {
        deps.push({
          file: importer.filePath,
          imports: relevantImport.importedSymbols
        });
      }
    }

    return deps;
  }

  /**
   * Get ALL files affected by a change, walking the dependency graph.
   * depth=1 is direct importers only. depth=3 catches ripple effects.
   */
  getTransitiveDependents(
    filePath: string,
    maxDepth: number = 3
  ): Array<{ file: string; depth: number; imports: string[] }> {
    const visited = new Map<string, { depth: number; imports: string[] }>();
    const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;
      if (visited.has(current.path) && visited.get(current.path)!.depth <= current.depth) continue;

      const dependents = this.getFileDependents(current.path);
      for (const dep of dependents) {
        const existingDepth = visited.get(dep.file)?.depth ?? Infinity;
        const newDepth = current.depth + 1;

        if (newDepth < existingDepth) {
          visited.set(dep.file, { depth: newDepth, imports: dep.imports });
          queue.push({ path: dep.file, depth: newDepth });
        }
      }
    }

    visited.delete(filePath); // don't include the original file
    return Array.from(visited.entries())
      .map(([file, info]) => ({ file, ...info }))
      .sort((a, b) => a.depth - b.depth);
  }

  /**
   * Get the full import graph as an adjacency list.
   * Returns { file → [files it imports] } for the whole project.
   */
  getFullDependencyGraph(): Map<string, string[]> {
    const stmt = this.db.prepare(`
      SELECT f.path as filePath, i.imported_from as importedFrom
      FROM imports i
      JOIN files f ON i.file_id = f.id
    `);
    const rows = stmt.all() as Array<{ filePath: string; importedFrom: string }>;

    const graph = new Map<string, string[]>();
    for (const row of rows) {
      if (!graph.has(row.filePath)) graph.set(row.filePath, []);
      graph.get(row.filePath)!.push(row.importedFrom);
    }
    return graph;
  }

  /**
   * Find circular dependencies in the project.
   * Returns arrays of file paths that form cycles.
   */
  findCircularDependencies(): Array<string[]> {
    const graph = this.getFullDependencyGraph();
    const cycles: Array<string[]> = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (node: string, path: string[]) => {
      if (stack.has(node)) {
        // Found cycle
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart).concat(node));
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);
      path.push(node);

      const deps = graph.get(node) || [];
      for (const dep of deps) {
        // Resolve relative imports to file paths
        const resolved = this.resolveImportPath(node, dep);
        if (resolved) dfs(resolved, [...path]);
      }

      stack.delete(node);
    };

    for (const file of graph.keys()) {
      dfs(file, []);
    }

    // Deduplicate cycles (same cycle can be found from different starting points)
    const uniqueCycles: Array<string[]> = [];
    const seen = new Set<string>();
    for (const cycle of cycles) {
      const normalized = [...cycle].sort().join('|');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniqueCycles.push(cycle);
      }
    }

    return uniqueCycles;
  }

  /**
   * Resolve a relative import path to an actual file path in the database.
   */
  resolveImportPath(fromFile: string, importPath: string): string | null {
    // Skip external packages (node_modules)
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null;

    const dir = fromFile.split(/[/\\]/).slice(0, -1).join('/');

    // Normalize the import path
    let resolved = importPath;
    if (importPath.startsWith('./')) {
      resolved = dir + '/' + importPath.slice(2);
    } else if (importPath.startsWith('../')) {
      const parts = dir.split('/');
      let impParts = importPath.split('/');
      while (impParts[0] === '..') {
        parts.pop();
        impParts.shift();
      }
      resolved = parts.join('/') + '/' + impParts.join('/');
    }

    // Remove extension if present
    const baseName = resolved.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // Try to find a matching file in the database
    const stmt = this.db.prepare(`
      SELECT path FROM files
      WHERE path = ? OR path = ? OR path = ? OR path = ?
         OR path = ? OR path = ?
      LIMIT 1
    `);
    const result = stmt.get(
      `${baseName}.ts`, `${baseName}.tsx`,
      `${baseName}.js`, `${baseName}.jsx`,
      `${baseName}/index.ts`, `${baseName}/index.js`
    ) as { path: string } | undefined;

    return result?.path || null;
  }

  /**
   * Resolve an import path to a file record in the database.
   * Used by indexer to build the dependencies table.
   */
  resolveImportToFile(
    sourceFilePath: string,
    importPath: string
  ): { id: number; path: string } | null {
    // Skip external packages
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null;

    const sourceDir = sourceFilePath.split(/[/\\]/).slice(0, -1).join('/');

    // Normalize the import path
    let resolved = importPath;
    if (importPath.startsWith('./')) {
      resolved = sourceDir + '/' + importPath.slice(2);
    } else if (importPath.startsWith('../')) {
      const parts = sourceDir.split('/');
      let impParts = importPath.split('/');
      while (impParts[0] === '..') {
        parts.pop();
        impParts.shift();
      }
      resolved = parts.join('/') + '/' + impParts.join('/');
    }

    // Remove extension if present
    resolved = resolved.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // Try exact matches with common extensions
    const stmt = this.db.prepare(`
      SELECT id, path FROM files
      WHERE path = ? OR path = ? OR path = ? OR path = ?
         OR path = ? OR path = ?
      LIMIT 1
    `);

    const result = stmt.get(
      `${resolved}.ts`, `${resolved}.tsx`,
      `${resolved}.js`, `${resolved}.jsx`,
      `${resolved}/index.ts`, `${resolved}/index.js`
    ) as { id: number; path: string } | undefined;

    return result || null;
  }
}
