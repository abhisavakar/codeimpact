import type { CodeImpactEngine } from '../../core/engine.js';

const NUDGE_INTERVAL = 5;

const GENERIC_NUDGES = [
  'Run memory_evolve(action="list_signals") to discover uncovered technologies and knowledge gaps.',
  'After completing a task, report the outcome with memory_evolve(action="report_outcome") so skills learn from experience.',
  'If you discovered a new pattern or convention, use memory_record(type="pattern") to teach it to future sessions.',
  'Create skills for areas you work in frequently: memory_evolve(action="create_skill", name="...", description="...", content="...").',
  'Complex multi-step workflows can be captured as SKILL.md files via memory_evolve(action="create_skill") for future reuse.',
];

export interface NudgeContext {
  toolName: string;
  verdict?: string;
  riskScore?: number;
  filePath?: string;
  uncoveredTechnologies?: string[];
  activeDirectory?: string;
}

export function generateNudge(engine: CodeImpactEngine, context: NudgeContext): string | null {
  try {
    const totalCalls = engine.getToolCallCount();
    if (totalCalls <= 0 || totalCalls % NUDGE_INTERVAL !== 0) return null;

    const contextual = getContextualNudge(context);
    if (contextual) return `[Knowledge nudge] ${contextual}`;

    const index = Math.floor(totalCalls / NUDGE_INTERVAL) % GENERIC_NUDGES.length;
    const nudge = GENERIC_NUDGES[index];
    if (!nudge) return null;

    return `[Knowledge nudge] ${nudge}`;
  } catch {
    return null;
  }
}

function getContextualNudge(context: NudgeContext): string | null {
  if (context.toolName === 'memory_review' && context.verdict === 'reject') {
    return 'Review rejected changes. If you found new pitfalls, add them: memory_evolve(action="improve_skill", skill_id="...", section="pitfalls", content="...")';
  }

  if (context.toolName === 'memory_review' && context.riskScore != null && context.riskScore >= 70) {
    return `High risk score (${context.riskScore}). If you learned something about this risky area, create a skill: memory_evolve(action="create_skill", name="...", description="...", content="...")`;
  }

  if (context.toolName === 'memory_verify' && context.verdict === 'fail') {
    return 'Verification failed. If you discovered a new pattern violation, record it: memory_record(type="pattern", ...) and create a skill with the pitfall.';
  }

  if (context.uncoveredTechnologies && context.uncoveredTechnologies.length > 0) {
    const tech = context.uncoveredTechnologies[0] ?? 'unknown';
    return `No skill exists for "${tech}". Create one after working with it: memory_evolve(action="create_skill", name="${slugify(tech)}-patterns", scope="technology", ...)`;
  }

  if (context.activeDirectory) {
    return `You're working in ${context.activeDirectory}. If you've learned patterns specific to this area, create a skill to capture them.`;
  }

  return null;
}

export function appendNudgeToResponse(
  response: Record<string, any>,
  engine: CodeImpactEngine,
  toolName: string,
  extraContext?: Partial<NudgeContext>,
): void {
  const context: NudgeContext = { toolName, ...extraContext };
  const nudge = generateNudge(engine, context);
  if (nudge) {
    if (!response._nudges) {
      response._nudges = [];
    }
    response._nudges.push(nudge);
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
