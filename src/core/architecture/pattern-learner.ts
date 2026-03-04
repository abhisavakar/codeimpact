import { readFileSync, existsSync } from 'node:fs';
import type { Tier2Storage } from '../../storage/tier2.js';
import type { PatternCategory, CodeExample, PatternRule } from '../../types/documentation.js';
import type { PatternLibrary } from './pattern-library.js';

// File extensions to analyze for patterns
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
// Max file size to read (100KB)
const MAX_FILE_SIZE = 100 * 1024;

// Pattern detection rules
const PATTERN_DETECTORS: Array<{
  category: PatternCategory;
  name: string;
  detect: RegExp;
  extractExample: (code: string) => string | null;
  rules: PatternRule[];
}> = [
  {
    category: 'error_handling',
    name: 'Try-Catch Pattern',
    detect: /try\s*\{[\s\S]*?\}\s*catch\s*\(/,
    extractExample: (code: string) => {
      const match = code.match(/try\s*\{[\s\S]{10,200}?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{5,150}?\}/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Use try-catch for error-prone operations', severity: 'warning' },
      { rule: 'Log errors with context', severity: 'warning' }
    ]
  },
  {
    category: 'api_call',
    name: 'Fetch API Pattern',
    detect: /fetch\s*\(|axios\.|api\.(?:get|post|put|delete|patch)/i,
    extractExample: (code: string) => {
      const match = code.match(/(?:const|let)\s+\w+\s*=\s*(?:await\s+)?(?:fetch|axios\.\w+|api\.\w+)\s*\([^)]+\)[\s\S]{0,100}?(?:\.json\(\)|;)/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Check response status', severity: 'critical' },
      { rule: 'Handle network errors', severity: 'critical' }
    ]
  },
  {
    category: 'component',
    name: 'React Component Pattern',
    detect: /(?:export\s+(?:default\s+)?)?(?:function|const)\s+[A-Z]\w+\s*(?::\s*React\.FC|\([^)]*\))\s*(?:=>|{)/,
    extractExample: (code: string) => {
      const match = code.match(/(?:export\s+(?:default\s+)?)?(?:function|const)\s+[A-Z]\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*(?:=>|{)[\s\S]{20,300}?return\s*\([\s\S]{10,200}?\)/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Define Props interface', severity: 'warning' },
      { rule: 'Use functional components', severity: 'info' }
    ]
  },
  {
    category: 'validation',
    name: 'Schema Validation (Zod/Pydantic)',
    detect: /z\.(?:object|string|number)|class\s+\w+\(BaseModel\)|@validator|@field_validator/,
    extractExample: (code: string) => {
      const zodMatch = code.match(/(?:const|export const)\s+\w+Schema\s*=\s*z\.object\(\s*\{[\s\S]{20,400}?\}\s*\)/);
      if (zodMatch) return zodMatch[0];
      const pydanticMatch = code.match(/class\s+\w+\(BaseModel\):\s*[\s\S]{20,300}?(?=\n\n|\nclass|\n[a-z])/);
      return pydanticMatch ? pydanticMatch[0] : null;
    },
    rules: [
      { rule: 'Define schemas for API inputs', severity: 'critical' },
      { rule: 'Use strict validation', severity: 'warning' }
    ]
  },
  {
    category: 'data_fetching',
    name: 'Async/Await Pattern',
    detect: /async\s+(?:function\s+\w+|\w+\s*=\s*async|\([^)]*\)\s*=>)/,
    extractExample: (code: string) => {
      const match = code.match(/async\s+(?:function\s+\w+)?\s*\([^)]*\)\s*(?::\s*Promise<[^>]+>)?\s*\{[\s\S]{20,250}?await[\s\S]{10,100}?\}/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Use async/await for asynchronous code', severity: 'info' },
      { rule: 'Always await promises', severity: 'warning' }
    ]
  },
  {
    category: 'api_call',
    name: 'FastAPI Endpoint Pattern',
    detect: /@(?:app|router)\.(?:get|post|put|delete|patch)\s*\(/,
    extractExample: (code: string) => {
      const match = code.match(/@(?:app|router)\.(?:get|post|put|delete|patch)\s*\([^)]+\)\s*\n(?:async\s+)?def\s+\w+\s*\([^)]*\)[\s\S]{10,250}?(?=\n@|\n\ndef|\nclass|$)/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Use response_model for type safety', severity: 'warning' },
      { rule: 'Add proper status codes', severity: 'info' }
    ]
  },
  {
    category: 'state_management',
    name: 'React Hook Pattern',
    detect: /use(?:State|Effect|Memo|Callback|Ref|Context)\s*\(/,
    extractExample: (code: string) => {
      const match = code.match(/const\s+\[\s*\w+,\s*set\w+\s*\]\s*=\s*useState[\s\S]{0,80}?(?:;|\))/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Follow hooks rules', severity: 'critical' },
      { rule: 'Use useMemo for expensive computations', severity: 'info' }
    ]
  },
  {
    category: 'testing',
    name: 'Test Pattern',
    detect: /(?:describe|it|test)\s*\(\s*['"`]/,
    extractExample: (code: string) => {
      const match = code.match(/(?:it|test)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{20,200}?\}\s*\)/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Test one thing per test', severity: 'warning' },
      { rule: 'Use descriptive test names', severity: 'info' }
    ]
  },
  {
    category: 'database',
    name: 'SQL/ORM Query Pattern',
    detect: /\.execute\(|\.query\(|select\(|\.filter\(|\.where\(/,
    extractExample: (code: string) => {
      const match = code.match(/(?:await\s+)?(?:db|session|connection)\.(?:execute|query)\s*\([\s\S]{10,200}?\)/);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Use parameterized queries', severity: 'critical' },
      { rule: 'Handle query errors', severity: 'warning' }
    ]
  },
  {
    category: 'authentication',
    name: 'Auth Check Pattern',
    detect: /(?:is_?authenticated|current_?user|get_?current_?user|useAuth|authRequired|@requires_auth)/i,
    extractExample: (code: string) => {
      const match = code.match(/(?:if\s*\(\s*!?\s*(?:is_?authenticated|current_?user)|Depends\s*\(\s*get_?current_?user)[\s\S]{10,150}?(?:\{|\))/i);
      return match ? match[0] : null;
    },
    rules: [
      { rule: 'Always verify authentication', severity: 'critical' },
      { rule: 'Check authorization after authentication', severity: 'critical' }
    ]
  }
];

export class PatternLearner {
  private tier2: Tier2Storage;
  private patternLibrary: PatternLibrary;

  constructor(tier2: Tier2Storage, patternLibrary: PatternLibrary) {
    this.tier2 = tier2;
    this.patternLibrary = patternLibrary;
  }

  // Learn patterns from the entire codebase
  learnFromCodebase(): {
    patternsLearned: number;
    examplesAdded: number;
    categories: Record<string, number>;
  } {
    const files = this.tier2.getAllFiles();
    const categories: Record<string, number> = {};
    let patternsLearned = 0;
    let examplesAdded = 0;

    for (const file of files) {
      // Skip non-code files
      const ext = this.getExtension(file.path);
      if (!CODE_EXTENSIONS.includes(ext)) continue;

      // Skip large files
      if (file.sizeBytes > MAX_FILE_SIZE) continue;

      // Read actual file content (not just preview)
      const content = this.readFileContent(file.path);
      if (!content) continue;

      const filePatterns = this.detectPatterns(content);

      for (const detected of filePatterns) {
        categories[detected.category] = (categories[detected.category] || 0) + 1;

        // Check if we already have this pattern
        const existingPatterns = this.patternLibrary.getPatternsByCategory(detected.category);
        const existing = existingPatterns.find(p => p.name === detected.name);

        if (existing) {
          // Add as example if different enough (limit examples per pattern)
          if (detected.example &&
              existing.examples.length < 5 &&
              !this.isDuplicate(existing.examples, detected.example)) {
            this.patternLibrary.addExample(existing.id, {
              code: detected.example,
              explanation: `Extracted from ${file.path}`,
              file: file.path
            });
            examplesAdded++;
          }
        } else {
          // Create new pattern
          this.patternLibrary.addPattern(
            detected.name,
            detected.category,
            `${detected.name} detected in codebase`,
            detected.example ? [{
              code: detected.example,
              explanation: `Extracted from ${file.path}`,
              file: file.path
            }] : [],
            [],
            detected.rules
          );
          patternsLearned++;
        }
      }
    }

    return { patternsLearned, examplesAdded, categories };
  }

  // Read file content safely
  private readFileContent(filePath: string): string | null {
    try {
      if (!existsSync(filePath)) return null;
      return readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  // Get file extension
  private getExtension(filePath: string): string {
    const match = filePath.match(/\.[^.]+$/);
    return match ? match[0].toLowerCase() : '';
  }

  // Detect patterns in a code snippet
  detectPatterns(code: string): Array<{
    category: PatternCategory;
    name: string;
    example: string | null;
    rules: PatternRule[];
  }> {
    const detected: Array<{
      category: PatternCategory;
      name: string;
      example: string | null;
      rules: PatternRule[];
    }> = [];

    for (const detector of PATTERN_DETECTORS) {
      if (detector.detect.test(code)) {
        detected.push({
          category: detector.category,
          name: detector.name,
          example: detector.extractExample(code),
          rules: detector.rules
        });
      }
    }

    return detected;
  }

  // Learn a specific pattern from user input
  learnPattern(
    code: string,
    name: string,
    description?: string,
    category?: PatternCategory
  ): { success: boolean; patternId?: string; message: string } {
    // Auto-detect category if not provided
    const detectedCategory = category || this.inferCategory(code);

    // Check for existing similar pattern
    const existingPatterns = this.patternLibrary.searchPatterns(name);
    if (existingPatterns.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return {
        success: false,
        message: `Pattern "${name}" already exists. Use add_example to add to existing pattern.`
      };
    }

    // Extract rules from code
    const rules = this.extractRules(code);

    // Create the pattern
    const pattern = this.patternLibrary.addPattern(
      name,
      detectedCategory,
      description || `User-defined pattern: ${name}`,
      [{
        code,
        explanation: 'User-provided example'
      }],
      [],
      rules
    );

    return {
      success: true,
      patternId: pattern.id,
      message: `Pattern "${name}" created successfully`
    };
  }

  // Infer category from code
  private inferCategory(code: string): PatternCategory {
    for (const detector of PATTERN_DETECTORS) {
      if (detector.detect.test(code)) {
        return detector.category;
      }
    }
    return 'custom';
  }

  // Extract rules from code patterns
  private extractRules(code: string): PatternRule[] {
    const rules: PatternRule[] = [];

    // Detect common patterns and generate rules
    if (/try\s*\{/.test(code)) {
      rules.push({ rule: 'Use try-catch for error handling', severity: 'warning' });
    }
    if (/catch\s*\([^)]*\)\s*\{[\s\S]*console\.error/.test(code)) {
      rules.push({ rule: 'Log errors in catch blocks', severity: 'info' });
    }
    if (/async\s+/.test(code)) {
      rules.push({ rule: 'Use async functions for asynchronous operations', severity: 'info' });
    }
    if (/await\s+/.test(code)) {
      rules.push({ rule: 'Await all promises', severity: 'warning' });
    }
    if (/interface\s+\w+Props/.test(code)) {
      rules.push({ rule: 'Define Props interfaces for components', severity: 'warning' });
    }
    if (/\?\.\w+/.test(code)) {
      rules.push({ rule: 'Use optional chaining for safe property access', severity: 'info' });
    }
    if (/\?\?/.test(code)) {
      rules.push({ rule: 'Use nullish coalescing for default values', severity: 'info' });
    }

    return rules;
  }

  // Check if example is duplicate
  private isDuplicate(examples: CodeExample[], newExample: string): boolean {
    const normalized = this.normalizeCode(newExample);
    return examples.some(e => this.normalizeCode(e.code) === normalized);
  }

  // Normalize code for comparison
  private normalizeCode(code: string): string {
    return code
      .replace(/\s+/g, ' ')
      .replace(/['"`]/g, '"')
      .trim()
      .toLowerCase();
  }

  // Get learning statistics
  getStats(): {
    totalPatterns: number;
    byCategory: Record<string, number>;
    topPatterns: Array<{ name: string; usageCount: number }>;
  } {
    const patterns = this.patternLibrary.getAllPatterns();
    const byCategory: Record<string, number> = {};

    for (const pattern of patterns) {
      byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
    }

    const topPatterns = patterns
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5)
      .map(p => ({ name: p.name, usageCount: p.usageCount }));

    return {
      totalPatterns: patterns.length,
      byCategory,
      topPatterns
    };
  }
}
