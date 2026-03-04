// Core types for CodeImpact

export interface Position {
  line: number;
  column: number;
}

export interface ActiveFile {
  path: string;
  content: string;
  cursorPosition?: Position;
  language: string;
}

export interface Session {
  startTime: Date;
  filesViewed: string[];
  currentGoal?: string;
}

export interface ContextSnippet {
  file: string;
  content: string;
  timestamp: Date;
}

export interface Tier1Context {
  activeFile: ActiveFile | null;
  recentDecisions: Decision[];
  session: Session;
  immediateContext: ContextSnippet[];
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  files: string[];
  tags: string[];
  createdAt: Date;
  // Phase 4: Team features
  author?: string;
  status?: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  supersededBy?: string;
}

export interface SearchResult {
  file: string;
  preview: string;
  similarity: number;
  lineStart: number;
  lineEnd: number;
  lastModified: number;
  score?: number;
}

export interface FileMetadata {
  id: number;
  path: string;
  contentHash: string;
  preview: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  lastModified: number;
  indexedAt: number;
}

export interface AssemblyOptions {
  maxTokens?: number;
  currentFile?: string;
}

export interface AssembledContext {
  context: string;
  sources: string[];
  tokenCount: number;
  decisions: Decision[];
}

export interface ProjectSummary {
  name: string;
  description: string;
  languages: string[];
  totalFiles: number;
  totalLines: number;
  keyDirectories: string[];
  recentDecisions: Decision[];
  dependencies: string[];
  architectureNotes: string;
}

export interface ContextParts {
  working: {
    activeFile: ActiveFile | null;
  };
  relevant: SearchResult[];
  archive: string[];
  decisions: Decision[];
}

export interface TokenBudgetAllocation {
  tier1: number;
  tier2: number;
  tier3: number;
  decisions: number;
}

export interface DependencyRelation {
  sourceFileId: number;
  targetFileId: number;
  relationship: 'imports' | 'exports' | 'calls' | 'type_reference';
}

export interface IndexingProgress {
  total: number;
  indexed: number;
  current?: string;
}

export interface CodeImpactConfig {
  projectPath: string;
  dataDir: string;
  maxTokens: number;
  embeddingModel: string;
  watchIgnore: string[];
}

// Phase 2: AST & Symbol types

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property' | 'enum' | 'constant';

export interface CodeSymbol {
  id?: number;
  fileId: number;
  filePath: string;
  kind: SymbolKind;
  name: string;
  signature?: string;
  docstring?: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
}

export interface Import {
  fileId: number;
  filePath: string;
  importedFrom: string;       // The module/file being imported
  importedSymbols: string[];  // What's being imported (* for all)
  isDefault: boolean;
  isNamespace: boolean;
  lineNumber: number;
}

export interface Export {
  fileId: number;
  filePath: string;
  exportedName: string;
  localName?: string;         // If renamed: export { foo as bar }
  isDefault: boolean;
  lineNumber: number;
}

export interface FileDependency {
  sourceFile: string;
  targetFile: string;
  imports: string[];          // What symbols are imported
}

export interface SymbolSearchResult {
  symbol: CodeSymbol;
  file: string;
  preview: string;
  relevance: number;
}

// Phase 5: Active Feature Context types

export interface FeatureFile {
  path: string;
  lastTouched: Date;
  touchCount: number;
  recentLines: number[];
}

export interface FeatureChange {
  file: string;
  timestamp: Date;
  diff: string;
  linesChanged: number[];
}

export interface FeatureQuery {
  query: string;
  timestamp: Date;
  filesUsed: string[];
}

export interface ActiveFeatureContext {
  id: string;
  name: string;
  files: FeatureFile[];
  changes: FeatureChange[];
  queries: FeatureQuery[];
  startedAt: Date;
  lastActiveAt: Date;
  status: 'active' | 'paused' | 'completed';
}

export interface HotContext {
  files: Array<{
    path: string;
    content: string | null;
    touchCount: number;
  }>;
  changes: FeatureChange[];
  queries: FeatureQuery[];
  summary: string;
}

// Re-export documentation types
export * from './documentation.js';
