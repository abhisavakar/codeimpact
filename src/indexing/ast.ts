import Parser from 'web-tree-sitter';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CodeSymbol, Import, Export, SymbolKind } from '../types/index.js';

// Language configurations for parsing
interface LanguageConfig {
  wasmFile: string;
  extensions: string[];
  queries: {
    functions?: string;
    classes?: string;
    interfaces?: string;
    types?: string;
    imports?: string;
    exports?: string;
  };
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    wasmFile: 'tree-sitter-typescript.wasm',
    extensions: ['.ts', '.tsx'],
    queries: {
      functions: `
        (function_declaration name: (identifier) @name) @func
        (arrow_function) @func
        (method_definition name: (property_identifier) @name) @func
      `,
      classes: `
        (class_declaration name: (type_identifier) @name) @class
      `,
      interfaces: `
        (interface_declaration name: (type_identifier) @name) @interface
      `,
      types: `
        (type_alias_declaration name: (type_identifier) @name) @type
      `,
      imports: `
        (import_statement) @import
      `,
      exports: `
        (export_statement) @export
      `
    }
  },
  javascript: {
    wasmFile: 'tree-sitter-javascript.wasm',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    queries: {
      functions: `
        (function_declaration name: (identifier) @name) @func
        (arrow_function) @func
        (method_definition name: (property_identifier) @name) @func
      `,
      classes: `
        (class_declaration name: (identifier) @name) @class
      `,
      imports: `
        (import_statement) @import
      `,
      exports: `
        (export_statement) @export
      `
    }
  },
  python: {
    wasmFile: 'tree-sitter-python.wasm',
    extensions: ['.py'],
    queries: {
      functions: `
        (function_definition name: (identifier) @name) @func
      `,
      classes: `
        (class_definition name: (identifier) @name) @class
      `,
      imports: `
        (import_statement) @import
        (import_from_statement) @import
      `
    }
  },
  go: {
    wasmFile: 'tree-sitter-go.wasm',
    extensions: ['.go'],
    queries: {
      functions: `(function_declaration name: (identifier) @name) @func`,
      classes: `(type_declaration (type_spec name: (type_identifier) @name type: (struct_type))) @class`
    }
  },
  rust: {
    wasmFile: 'tree-sitter-rust.wasm',
    extensions: ['.rs'],
    queries: {
      functions: `(function_item name: (identifier) @name) @func`,
      classes: `(struct_item name: (type_identifier) @name) @class`
    }
  },
  java: {
    wasmFile: 'tree-sitter-java.wasm',
    extensions: ['.java'],
    queries: {
      functions: `(method_declaration name: (identifier) @name) @func`,
      classes: `(class_declaration name: (identifier) @name) @class`
    }
  }
};

export class ASTParser {
  private parser: Parser | null = null;
  private languages: Map<string, Parser.Language> = new Map();
  private initialized = false;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Parser.init();
      this.initialized = true;
    } catch (error) {
      console.warn('Failed to initialize tree-sitter, will fall back to regex:', error);
    }
  }

  private async loadLanguage(langName: string): Promise<Parser.Language | null> {
    if (this.languages.has(langName)) {
      return this.languages.get(langName)!;
    }

    const config = LANGUAGE_CONFIGS[langName];
    if (!config || !this.initialized) return null;

    try {
      // Load WASM from the tree-sitter-wasms package
      const wasmPath = fileURLToPath(import.meta.resolve(`tree-sitter-wasms/out/${config.wasmFile}`));
      
      if (!existsSync(wasmPath)) {
        console.warn(`WASM file not found for ${langName}: ${wasmPath}`);
        return null;
      }

      const wasmData = readFileSync(wasmPath);
      const language = await Parser.Language.load(wasmData);
      this.languages.set(langName, language);
      return language;
    } catch (error) {
      console.warn(`Failed to load tree-sitter language ${langName}:`, error);
      return null;
    }
  }

  getLanguageForFile(filePath: string): string | null {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

    for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
      if (config.extensions.includes(ext)) {
        return lang;
      }
    }
    return null;
  }

  async parseFile(filePath: string, content: string): Promise<{
    symbols: CodeSymbol[];
    imports: Import[];
    exports: Export[];
  } | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Always run the regex parser to get imports and exports
    // (since our tree-sitter queries don't extract them fully yet)
    let { symbols, imports, exports } = this.parseWithRegex(filePath, content);

    const lang = this.getLanguageForFile(filePath);
    if (lang && this.initialized) {
      const language = await this.loadLanguage(lang);
      if (language) {
        try {
          const tsResult = this.parseWithTreeSitter(filePath, content, language, lang);
          // If tree-sitter succeeded, use its superior symbols instead of regex symbols
          if (tsResult.symbols.length > 0) {
            symbols = tsResult.symbols;
          }
        } catch (error) {
          console.warn(`Tree-sitter parsing failed for ${filePath}, falling back to regex:`, error);
        }
      }
    }

    return { symbols, imports, exports };
  }

  private parseWithTreeSitter(
    filePath: string,
    content: string,
    language: Parser.Language,
    langName: string
  ): {
    symbols: CodeSymbol[];
    imports: Import[];
    exports: Export[];
  } {
    const parser = new Parser();
    parser.setLanguage(language);
    
    // We can't guarantee tree-sitter parser is completely thread-safe in this environment, 
    // so we instantiate a new one per file. It's lightweight enough.
    const tree = parser.parse(content);
    const config = LANGUAGE_CONFIGS[langName];
    
    const symbols: CodeSymbol[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];

    if (!config) return { symbols, imports, exports };

    // Helper to run query and map results
    const runQuery = (queryString: string, kind: SymbolKind) => {
      try {
        const query = language.query(queryString);
        const matches = query.matches(tree.rootNode);
        
        for (const match of matches) {
          const nameCapture = match.captures.find(c => c.name === 'name');
          // For things like function arrow assignments or anonymous exports, the structure might vary
          // But our basic @name capture logic handles most cases.
          if (nameCapture) {
            const node = nameCapture.node;
            // Get the parent node (the actual function/class declaration) to get the full line range
            const defNode = match.captures[0]?.node || node.parent || node;
            
            symbols.push({
              fileId: 0,
              filePath,
              kind,
              name: node.text,
              lineStart: defNode.startPosition.row + 1,
              lineEnd: defNode.endPosition.row + 1,
              // Check if parent or grandparent is an export statement, typical in TS/JS
              exported: defNode.parent?.type === 'export_statement' || defNode.parent?.parent?.type === 'export_statement',
              signature: content.slice(defNode.startIndex, defNode.endIndex).split('\\n')[0]
            });
          }
        }
      } catch (err) {
        console.warn(`Query error for ${kind} in ${langName}:`, err);
      }
    };

    if (config.queries.functions) runQuery(config.queries.functions, 'function');
    if (config.queries.classes) runQuery(config.queries.classes, 'class');
    if (config.queries.interfaces) runQuery(config.queries.interfaces, 'interface');
    if (config.queries.types) runQuery(config.queries.types, 'type');
    
    // Not implementing exact imports/exports extraction via Tree-sitter yet,
    // as it requires more complex language-specific handling (e.g., getting string values).
    // Will rely on regex parser for the imports/exports portion as a fallback below
    // unless the tree-sitter symbols array is deemed sufficient.
    
    return { symbols, imports, exports };
  }

  // Regex-based parsing for symbol extraction
  // Handles: functions, classes, interfaces, types, imports, exports
  // Supports: TypeScript, JavaScript, Python, Go, Rust, Java
  private parseWithRegex(filePath: string, content: string): {
    symbols: CodeSymbol[];
    imports: Import[];
    exports: Export[];
  } {
    const symbols: CodeSymbol[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const lines = content.split('\n');
    const lang = this.getLanguageForFile(filePath);

    if (lang === 'typescript' || lang === 'javascript') {
      this.parseTypeScriptJS(filePath, content, lines, symbols, imports, exports);
    } else if (lang === 'python') {
      this.parsePython(filePath, content, lines, symbols, imports, exports);
    } else if (lang === 'go') {
      this.parseGo(filePath, content, lines, symbols, imports, exports);
    } else if (lang === 'rust') {
      this.parseRust(filePath, content, lines, symbols, imports, exports);
    } else if (lang === 'java') {
      this.parseJava(filePath, content, lines, symbols, imports, exports);
    }

    return { symbols, imports, exports };
  }

  private parseTypeScriptJS(
    filePath: string,
    content: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: Import[],
    exports: Export[]
  ): void {
    // Patterns for TypeScript/JavaScript
    const patterns = {
      // Functions: function name(), export default function name(), const name = () =>
      function: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
      // Arrow functions: handles type annotations and destructured params
      arrowFunc: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*[^=]+)?\s*=>/,
      // Classes
      class: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/,
      // Interfaces (TS only)
      interface: /^(?:export\s+)?interface\s+(\w+)/,
      // Types (TS only)
      type: /^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/,
      // Imports - supports 'import type'
      import: /^import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?\s*from\s*['"]([^'"]+)['"]/,
      importAll: /^import\s+(?:type\s+)?\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/,
      importSideEffect: /^import\s*['"]([^'"]+)['"]/,
      // Exports
      exportNamed: /^export\s+(?:type\s+)?\{([^}]+)\}/,
      exportDefault: /^export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/,
      exportDirect: /^export\s+(?:const|let|var|function|class|interface|type|enum|async\s+function)\s+(\w+)/,
      // Enums (TS)
      enum: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/,
      // Methods inside classes - handles generics, readonly, and all modifiers
      method: /^\s+(?:async\s+)?(?:static\s+)?(?:readonly\s+)?(?:private\s+|public\s+|protected\s+)?(?:get\s+|set\s+)?(\w+)\s*(?:<[^>]+>)?\s*\(/,
    };

    let currentClass: { name: string; startLine: number } | null = null;
    let braceDepth = 0;
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Track block comments properly
      if (inBlockComment) {
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }

      // Skip single-line comments
      if (trimmed.startsWith('//')) {
        continue;
      }

      // Handle block comment start
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) {
          inBlockComment = true;
        }
        continue;
      }

      // Track brace depth for class scope
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      if (currentClass && braceDepth === 0) {
        // Class ended
        const existingSymbol = symbols.find(s => s.name === currentClass!.name && s.kind === 'class');
        if (existingSymbol) {
          existingSymbol.lineEnd = lineNum;
        }
        currentClass = null;
      }

      // Functions
      let match = trimmed.match(patterns.function);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'function',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('export'),
          signature: this.extractSignature(trimmed)
        });
        continue;
      }

      // Arrow functions
      match = trimmed.match(patterns.arrowFunc);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'function',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('export'),
          signature: this.extractSignature(trimmed)
        });
        continue;
      }

      // Classes
      match = trimmed.match(patterns.class);
      if (match && match[1]) {
        currentClass = { name: match[1], startLine: lineNum };
        braceDepth = 1; // Reset for class tracking
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'class',
          name: match[1],
          lineStart: lineNum,
          lineEnd: lineNum, // Will be updated when class ends
          exported: trimmed.startsWith('export')
        });
        continue;
      }

      // Interfaces
      match = trimmed.match(patterns.interface);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'interface',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('export')
        });
        continue;
      }

      // Types
      match = trimmed.match(patterns.type);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'type',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findStatementEnd(lines, i),
          exported: trimmed.startsWith('export')
        });
        continue;
      }

      // Enums
      match = trimmed.match(patterns.enum);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'enum',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('export')
        });
        continue;
      }

      // Methods (when inside a class)
      if (currentClass) {
        match = trimmed.match(patterns.method);
        if (match && match[1] && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(match[1])) {
          symbols.push({
            fileId: 0,
            filePath,
            kind: 'method',
            name: `${currentClass.name}.${match[1]}`,
            lineStart: lineNum,
            lineEnd: this.findBlockEnd(lines, i),
            exported: false // Methods inherit class export status
          });
        }
      }

      // Imports
      match = trimmed.match(patterns.import);
      if (match) {
        const defaultImport = match[1];
        const namedImports = match[2]?.split(',').map(s => s.trim().split(/\s+as\s+/)[0]?.trim()).filter((s): s is string => !!s) || [];
        const from = match[3] || '';

        imports.push({
          fileId: 0,
          filePath,
          importedFrom: from,
          importedSymbols: defaultImport ? [defaultImport, ...namedImports] : namedImports,
          isDefault: !!defaultImport,
          isNamespace: false,
          lineNumber: lineNum
        });
        continue;
      }

      match = trimmed.match(patterns.importAll);
      if (match) {
        imports.push({
          fileId: 0,
          filePath,
          importedFrom: match[2] || '',
          importedSymbols: ['*'],
          isDefault: false,
          isNamespace: true,
          lineNumber: lineNum
        });
        continue;
      }

      // Exports
      match = trimmed.match(patterns.exportDirect);
      if (match && match[1]) {
        exports.push({
          fileId: 0,
          filePath,
          exportedName: match[1],
          isDefault: false,
          lineNumber: lineNum
        });
        continue;
      }

      match = trimmed.match(patterns.exportDefault);
      if (match) {
        exports.push({
          fileId: 0,
          filePath,
          exportedName: match[1] || 'default',
          isDefault: true,
          lineNumber: lineNum
        });
        continue;
      }

      match = trimmed.match(patterns.exportNamed);
      if (match && match[1]) {
        const names = match[1].split(',').map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return parts[parts.length - 1]?.trim();
        }).filter((n): n is string => !!n);

        for (const name of names) {
          exports.push({
            fileId: 0,
            filePath,
            exportedName: name,
            isDefault: false,
            lineNumber: lineNum
          });
        }
      }
    }
  }

  private parsePython(
    filePath: string,
    content: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: Import[],
    exports: Export[]
  ): void {
    const patterns = {
      function: /^(?:async\s+)?def\s+(\w+)\s*\(/,
      class: /^class\s+(\w+)/,
      import: /^import\s+(\w+(?:\.\w+)*)(?:\s+as\s+\w+)?/,
      fromImport: /^from\s+(\.{0,3}\w*(?:\.\w+)*)\s+import\s+(.+)/,
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();
      const lineNum = i + 1;
      const indent = line.length - line.trimStart().length;

      // Skip comments
      if (trimmed.startsWith('#')) continue;

      // Functions
      let match = trimmed.match(patterns.function);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'function',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findPythonBlockEnd(lines, i, indent),
          exported: !match[1].startsWith('_'),
          signature: trimmed.split(':')[0]
        });
        continue;
      }

      // Classes
      match = trimmed.match(patterns.class);
      if (match && match[1]) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'class',
          name: match[1],
          lineStart: lineNum,
          lineEnd: this.findPythonBlockEnd(lines, i, indent),
          exported: !match[1].startsWith('_')
        });
        continue;
      }

      // Imports
      match = trimmed.match(patterns.import);
      if (match && match[1]) {
        imports.push({
          fileId: 0,
          filePath,
          importedFrom: match[1],
          importedSymbols: [match[1].split('.').pop() || match[1]],
          isDefault: false,
          isNamespace: true,
          lineNumber: lineNum
        });
        continue;
      }

      match = trimmed.match(patterns.fromImport);
      if (match) {
        const from = match[1] || '';
        const imported = match[2]?.split(',').map(s => s.trim().split(/\s+as\s+/)[0]?.trim()).filter((s): s is string => !!s) || [];
        imports.push({
          fileId: 0,
          filePath,
          importedFrom: from,
          importedSymbols: imported,
          isDefault: false,
          isNamespace: imported.includes('*'),
          lineNumber: lineNum
        });
      }
    }
  }

  private parseGo(
    filePath: string,
    content: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: Import[],
    exports: Export[]
  ): void {
    let inImportBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Skip comments
      if (trimmed.startsWith('//')) continue;

      // Handle import blocks
      if (trimmed === 'import (') {
        inImportBlock = true;
        continue;
      }
      if (inImportBlock && trimmed === ')') {
        inImportBlock = false;
        continue;
      }

      // Single import or import block item
      const importMatch = inImportBlock
        ? trimmed.match(/^(?:(\w+)\s+)?"([^"]+)"/)
        : trimmed.match(/^import\s+(?:(\w+)\s+)?"([^"]+)"/);
      if (importMatch) {
        const alias = importMatch[1];
        const path = importMatch[2] || '';
        const pkg = alias || path.split('/').pop() || '';
        imports.push({
          fileId: 0,
          filePath,
          importedFrom: path,
          importedSymbols: [pkg],
          isDefault: false,
          isNamespace: false,
          lineNumber: lineNum
        });
        continue;
      }

      // Functions and methods
      const funcMatch = trimmed.match(/^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(/);
      if (funcMatch) {
        const receiver = funcMatch[2];
        const name = receiver ? `${receiver}.${funcMatch[3]}` : (funcMatch[3] || '');
        symbols.push({
          fileId: 0,
          filePath,
          kind: receiver ? 'method' : 'function',
          name,
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: /^[A-Z]/.test(funcMatch[3] || ''),
          signature: trimmed.split('{')[0]?.trim()
        });
        continue;
      }

      // Structs
      const structMatch = trimmed.match(/^type\s+(\w+)\s+struct\s*\{?/);
      if (structMatch) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'class',
          name: structMatch[1] || '',
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: /^[A-Z]/.test(structMatch[1] || '')
        });
        continue;
      }

      // Interfaces
      const ifaceMatch = trimmed.match(/^type\s+(\w+)\s+interface\s*\{?/);
      if (ifaceMatch) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'interface',
          name: ifaceMatch[1] || '',
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: /^[A-Z]/.test(ifaceMatch[1] || '')
        });
      }
    }
  }

  private parseRust(
    filePath: string,
    content: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: Import[],
    exports: Export[]
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Skip comments
      if (trimmed.startsWith('//')) continue;

      // Functions
      const fnMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
      if (fnMatch) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'function',
          name: fnMatch[1] || '',
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('pub'),
          signature: trimmed.split('{')[0]?.trim()
        });
        continue;
      }

      // Structs
      const structMatch = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/);
      if (structMatch) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'class',
          name: structMatch[1] || '',
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('pub')
        });
        continue;
      }

      // Enums
      const enumMatch = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/);
      if (enumMatch) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'enum',
          name: enumMatch[1] || '',
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('pub')
        });
        continue;
      }

      // Traits (similar to interfaces)
      const traitMatch = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/);
      if (traitMatch) {
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'interface',
          name: traitMatch[1] || '',
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.startsWith('pub')
        });
        continue;
      }

      // Impl blocks
      const implMatch = trimmed.match(/^impl\s+(?:<[^>]+>\s+)?(?:(\w+)\s+for\s+)?(\w+)/);
      if (implMatch) {
        const traitName = implMatch[1];
        const typeName = implMatch[2] || '';
        const name = traitName ? `${traitName} for ${typeName}` : typeName;
        symbols.push({
          fileId: 0,
          filePath,
          kind: 'class',
          name: `impl ${name}`,
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: false
        });
        continue;
      }

      // use statements
      const useMatch = trimmed.match(/^(?:pub\s+)?use\s+(.+);/);
      if (useMatch) {
        const path = (useMatch[1] || '').replace(/::/g, '/');
        imports.push({
          fileId: 0,
          filePath,
          importedFrom: path,
          importedSymbols: [path.split('/').pop()?.replace(/[{}]/g, '') || ''],
          isDefault: false,
          isNamespace: path.includes('*'),
          lineNumber: lineNum
        });
      }
    }
  }

  private parseJava(
    filePath: string,
    content: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: Import[],
    exports: Export[]
  ): void {
    let currentClass: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

      // Imports
      const importMatch = trimmed.match(/^import\s+(?:static\s+)?([^;]+);/);
      if (importMatch) {
        const path = importMatch[1] || '';
        imports.push({
          fileId: 0,
          filePath,
          importedFrom: path,
          importedSymbols: [path.split('.').pop() || ''],
          isDefault: false,
          isNamespace: path.endsWith('*'),
          lineNumber: lineNum
        });
        continue;
      }

      // Classes and interfaces
      const classMatch = trimmed.match(/^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?(?:final\s+)?(class|interface|enum)\s+(\w+)/);
      if (classMatch) {
        currentClass = classMatch[2] || '';
        symbols.push({
          fileId: 0,
          filePath,
          kind: classMatch[1] === 'interface' ? 'interface' : classMatch[1] === 'enum' ? 'enum' : 'class',
          name: currentClass,
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          exported: trimmed.includes('public')
        });
        continue;
      }

      // Methods
      const methodMatch = trimmed.match(/^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/);
      if (methodMatch && currentClass && !['if', 'for', 'while', 'switch', 'catch', 'class', 'interface', 'enum'].includes(methodMatch[2] || '')) {
        const returnType = methodMatch[1];
        const methodName = methodMatch[2] || '';
        // Skip constructors (name matches class name)
        if (methodName !== currentClass) {
          symbols.push({
            fileId: 0,
            filePath,
            kind: 'method',
            name: `${currentClass}.${methodName}`,
            lineStart: lineNum,
            lineEnd: this.findBlockEnd(lines, i),
            exported: trimmed.includes('public'),
            signature: `${returnType} ${methodName}(...)`
          });
        }
      }
    }
  }

  private findBlockEnd(lines: string[], startIndex: number): number {
    let braceCount = 0;
    let started = false;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i] || '';
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }
    return startIndex + 1;
  }

  private findStatementEnd(lines: string[], startIndex: number): number {
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i] || '';
      if (line.includes(';') || (i > startIndex && !line.trim().startsWith('|') && !line.trim().startsWith('&'))) {
        return i + 1;
      }
    }
    return startIndex + 1;
  }

  private findPythonBlockEnd(lines: string[], startIndex: number, baseIndent: number): number {
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i] || '';
      if (line.trim() === '') continue;

      const indent = line.length - line.trimStart().length;
      if (indent <= baseIndent) {
        return i;
      }
    }
    return lines.length;
  }

  private extractSignature(line: string): string {
    // Extract function signature from line
    const match = line.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?)\s*(\([^)]*\))/);
    return match?.[1] || '';
  }
}
