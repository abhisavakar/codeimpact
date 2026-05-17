/**
 * Remote Provider — abstraction for GitHub/GitLab/Bitbucket git operations.
 * Provides injectable interface for testability and multi-provider support.
 */

import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export type ProviderName = 'github' | 'gitlab' | 'bitbucket' | 'generic';

export interface GitResult {
  success: boolean;
  message: string;
  branch?: string;
  commitHash?: string;
  prUrl?: string;
}

export interface PROptions {
  projectPath: string;
  title: string;
  body: string;
  base: string;
  head: string;
  draft?: boolean;
}

export interface PRStatus {
  url: string;
  state: 'open' | 'closed' | 'merged';
  title: string;
}

export interface RemoteProvider {
  name: ProviderName;
  detect(projectPath: string): boolean;
  push(projectPath: string, branch: string): GitResult;
  createPR(options: PROptions): GitResult;
  getPRStatus(projectPath: string, branch: string): PRStatus | null;
}

// ============================================================================
// Git Executor Interface (for testability)
// ============================================================================

export interface GitExecutor {
  exec(cwd: string, command: string): string;
}

export class RealGitExecutor implements GitExecutor {
  exec(cwd: string, command: string): string {
    return execSync(`git ${command}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

export class MockGitExecutor implements GitExecutor {
  public calls: Array<{ cwd: string; command: string }> = [];
  private responses: Map<string, string> = new Map();
  private errorPatterns: Map<string, Error> = new Map();

  setResponse(commandPattern: string, response: string): void {
    this.responses.set(commandPattern, response);
  }

  setError(commandPattern: string, error: Error): void {
    this.errorPatterns.set(commandPattern, error);
  }

  exec(cwd: string, command: string): string {
    this.calls.push({ cwd, command });

    // Check for errors first
    for (const [pattern, error] of this.errorPatterns) {
      if (command.includes(pattern)) throw error;
    }

    // Check for responses
    for (const [pattern, response] of this.responses) {
      if (command.includes(pattern)) return response;
    }

    return '';
  }

  reset(): void {
    this.calls = [];
    this.responses.clear();
    this.errorPatterns.clear();
  }
}

// ============================================================================
// Provider Implementations
// ============================================================================

function createBaseProvider(executor: GitExecutor): {
  push: (projectPath: string, branch: string) => GitResult;
} {
  return {
    push(projectPath: string, branch: string): GitResult {
      try {
        executor.exec(projectPath, `push -u origin ${branch}`);
        return { success: true, message: `Pushed to origin/${branch}`, branch };
      } catch (err) {
        return { success: false, message: `Push failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

export function createGitHubProvider(executor: GitExecutor = new RealGitExecutor()): RemoteProvider {
  const base = createBaseProvider(executor);
  return {
    name: 'github',
    detect(projectPath: string): boolean {
      try {
        const remote = executor.exec(projectPath, 'remote get-url origin');
        return remote.includes('github.com');
      } catch {
        return false;
      }
    },
    push: base.push,
    createPR(options: PROptions): GitResult {
      try {
        const draftFlag = options.draft ? '--draft' : '';
        const cmd = `gh pr create --title "${options.title}" --body "${options.body}" --base ${options.base} --head ${options.head} ${draftFlag}`.trim();
        const output = execSync(cmd, { cwd: options.projectPath, encoding: 'utf-8', timeout: 30000 });
        const prUrl = output.trim().split('\n').pop() || '';
        return { success: true, message: 'PR created', prUrl };
      } catch (err) {
        return { success: false, message: `PR creation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    getPRStatus(projectPath: string, branch: string): PRStatus | null {
      try {
        const output = execSync(`gh pr view ${branch} --json url,state,title`, {
          cwd: projectPath, encoding: 'utf-8', timeout: 15000,
        });
        const data = JSON.parse(output);
        return { url: data.url, state: data.state.toLowerCase(), title: data.title };
      } catch {
        return null;
      }
    },
  };
}

export function createGitLabProvider(executor: GitExecutor = new RealGitExecutor()): RemoteProvider {
  const base = createBaseProvider(executor);
  return {
    name: 'gitlab',
    detect(projectPath: string): boolean {
      try {
        const remote = executor.exec(projectPath, 'remote get-url origin');
        return remote.includes('gitlab.com') || remote.includes('gitlab.');
      } catch {
        return false;
      }
    },
    push: base.push,
    createPR(options: PROptions): GitResult {
      try {
        const cmd = `git push -o merge_request.create -o merge_request.target=${options.base} -o merge_request.title="${options.title}"`;
        executor.exec(options.projectPath, cmd.replace('git ', ''));
        return { success: true, message: 'MR created via push options' };
      } catch (err) {
        return { success: false, message: `MR creation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    getPRStatus(): PRStatus | null {
      return null; // Not implemented without glab CLI
    },
  };
}

export function createBitbucketProvider(executor: GitExecutor = new RealGitExecutor()): RemoteProvider {
  const base = createBaseProvider(executor);
  return {
    name: 'bitbucket',
    detect(projectPath: string): boolean {
      try {
        const remote = executor.exec(projectPath, 'remote get-url origin');
        return remote.includes('bitbucket.org');
      } catch {
        return false;
      }
    },
    push: base.push,
    createPR(): GitResult {
      return { success: false, message: 'Bitbucket PR creation requires API token — use web interface' };
    },
    getPRStatus(): PRStatus | null {
      return null;
    },
  };
}

export function createGenericProvider(executor: GitExecutor = new RealGitExecutor()): RemoteProvider {
  const base = createBaseProvider(executor);
  return {
    name: 'generic',
    detect(): boolean { return true; },
    push: base.push,
    createPR(): GitResult {
      return { success: false, message: 'PR creation not supported for generic provider' };
    },
    getPRStatus(): PRStatus | null { return null; },
  };
}

// ============================================================================
// Auto-Detection
// ============================================================================

const PROVIDER_FACTORIES = [createGitHubProvider, createGitLabProvider, createBitbucketProvider];

export function detectProvider(
  projectPath: string,
  configProvider?: ProviderName | 'auto',
  executor: GitExecutor = new RealGitExecutor(),
): RemoteProvider {
  // Explicit config override
  if (configProvider && configProvider !== 'auto') {
    switch (configProvider) {
      case 'github': return createGitHubProvider(executor);
      case 'gitlab': return createGitLabProvider(executor);
      case 'bitbucket': return createBitbucketProvider(executor);
      default: return createGenericProvider(executor);
    }
  }

  // Auto-detect from remote URL
  for (const factory of PROVIDER_FACTORIES) {
    const provider = factory(executor);
    if (provider.detect(projectPath)) {
      return provider;
    }
  }

  return createGenericProvider(executor);
}
