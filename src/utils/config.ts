import { join, resolve } from 'path';
import type { CodeImpactConfig } from '../types/index.js';

export function getDefaultConfig(projectPath: string): CodeImpactConfig {
  const normalizedPath = resolve(projectPath);

  return {
    projectPath: normalizedPath,
    // Store in project directory (standard practice like .git/, .vscode/)
    dataDir: join(normalizedPath, '.codeimpact'),
    maxTokens: 6000,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2', // Fallback model, faster and smaller
    watchIgnore: [
      // ===== CodeImpact =====
      '**/.codeimpact/**',
      '**/.codeimpact/**',

      // ===== Version Control =====
      '**/.git/**',
      '**/.svn/**',
      '**/.hg/**',

      // ===== Node.js / JavaScript =====
      '**/node_modules/**',
      '**/bower_components/**',
      '**/.npm/**',
      '**/.yarn/**',
      '**/.pnp.*',

      // ===== Build Outputs =====
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/output/**',
      '**/_build/**',
      '**/public/build/**',

      // ===== Next.js =====
      '**/.next/**',
      '**/.vercel/**',

      // ===== Nuxt.js =====
      '**/.nuxt/**',
      '**/.output/**',

      // ===== Vite / Rollup / Parcel =====
      '**/.vite/**',
      '**/.cache/**',
      '**/.parcel-cache/**',
      '**/.turbo/**',
      '**/.svelte-kit/**',

      // ===== Python =====
      '**/.venv/**',
      '**/venv/**',
      '**/env/**',
      '**/.env/**',
      '**/virtualenv/**',
      '**/__pycache__/**',
      '**/*.pyc',
      '**/*.pyo',
      '**/*.pyd',
      '**/.Python',
      '**/*.egg-info/**',
      '**/*.egg/**',
      '**/eggs/**',
      '**/.eggs/**',
      '**/pip-wheel-metadata/**',
      '**/.pytest_cache/**',
      '**/.mypy_cache/**',
      '**/.ruff_cache/**',
      '**/.tox/**',
      '**/.nox/**',
      '**/htmlcov/**',
      '**/.coverage',
      '**/.hypothesis/**',

      // ===== Django =====
      '**/staticfiles/**',
      '**/static_collected/**',
      '**/media/**',
      '**/*.sqlite3',
      '**/db.sqlite3',

      // ===== FastAPI / Flask =====
      '**/instance/**',

      // ===== Ruby / Rails =====
      '**/vendor/bundle/**',
      '**/.bundle/**',
      '**/tmp/**',
      '**/log/**',

      // ===== Go =====
      '**/vendor/**',

      // ===== Rust =====
      '**/target/**',
      '**/*.rlib',

      // ===== Java / Kotlin / Gradle / Maven =====
      '**/.gradle/**',
      '**/.mvn/**',
      '**/target/**',
      '**/*.class',
      '**/*.jar',
      '**/*.war',

      // ===== .NET / C# =====
      '**/bin/**',
      '**/obj/**',
      '**/packages/**',
      '**/*.dll',
      '**/*.exe',

      // ===== iOS / macOS =====
      '**/Pods/**',
      '**/.build/**',
      '**/DerivedData/**',
      '**/*.xcworkspace/**',

      // ===== Android =====
      '**/.gradle/**',
      '**/local.properties',

      // ===== IDE / Editor =====
      '**/.idea/**',
      '**/.vscode/**',
      '**/*.swp',
      '**/*.swo',
      '**/*.sublime-*',
      '**/.project',
      '**/.classpath',
      '**/.settings/**',

      // ===== Testing / Coverage =====
      '**/coverage/**',
      '**/.nyc_output/**',
      '**/test-results/**',
      '**/jest-cache/**',

      // ===== Misc Generated / Cache =====
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.min.js',
      '**/*.min.css',
      '**/*.map',
      '**/*.chunk.js',
      '**/*.bundle.js',

      // ===== Lock Files =====
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/Pipfile.lock',
      '**/poetry.lock',
      '**/Gemfile.lock',
      '**/Cargo.lock',
      '**/composer.lock',
      '**/go.sum',

      // ===== Environment / Secrets =====
      '**/.env',
      '**/.env.*',
      '**/*.env',
      '**/.envrc',
      '**/secrets/**',
      '**/*.pem',
      '**/*.key',

      // ===== Logs / Temp =====
      '**/*.log',
      '**/logs/**',
      '**/*.tmp',
      '**/*.temp',
      '**/temp/**'
    ]
  };
}

export function parseArgs(args: string[]): { projectPath: string } {
  let projectPath = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--project' && nextArg) {
      projectPath = nextArg;
      break;
    }
  }

  return { projectPath: resolve(projectPath) };
}
