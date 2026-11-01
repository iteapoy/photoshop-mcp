import { streamText } from 'ai';
import { z } from 'zod';
import type { ProviderAdapter } from '../providers/registry.js';
import { MAX_PLAN_STEPS, planSchema, type Plan } from './plan-schema.js';
import { buildPlannerPrompt, buildRepairPrompt } from './plan-schema.js';
import type {
  PlanInput,
  PlanResult,
  Planner,
  PlannerEvent,
  PlannerKind,
  RepairInput,
} from './planner.js';

export interface SdkStructuredPlannerOptions {
  provider: ProviderAdapter;
  apiKey: string;
  modelId: string;
}

/**
 * Local patch (2026-11-01). Upstream used AI SDK `Output.object`, i.e.
 * `response_format: json_schema`. Several OpenAI-compatible endpoints (Zhipu
 * GLM, Qwen, DeepSeek, local servers) accept that field but ignore it and
 * answer with markdown-fenced JSON, which surfaces as
 *   "No object generated: could not parse the response."
 * Here the schema is injected into the prompt and the answer is parsed
 * defensively (fence stripping, bare arrays, argsJson passed as an object).
 */
const SCHEMA_JSON = (() => {
  try {
    return JSON.stringify(z.toJSONSchema(planSchema));
  } catch {
    return '';
  }
})();

const OUTPUT_RULES = [
  '',
  '## Response format (strict)',
  'Reply with exactly ONE JSON object and nothing else.',
  '- No markdown code fences, no prose, no comments before or after the JSON.',
  '- The object must validate against this JSON Schema:',
  SCHEMA_JSON,
  '- "argsJson" MUST be a JSON-encoded STRING, e.g. "{\\"width\\":1080,\\"height\\":1920}". Never a nested object.',
  '- "rationale" is a plain string ("" when unsure). "dependsOn" is an array of step ids ([] when unsure).',
  '- Do not invent extra top-level keys.',
].join('\n');

function extractJsonObject(text: string): string {
  let t = String(text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object in model output');
  }
  return t.slice(start, end + 1);
}

function toArgString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

/** Coerce whatever the model produced into the shape planSchema expects. */
function normalizePlan(raw: unknown): Plan {
  let source = raw;
  if (Array.isArray(source)) source = { steps: source } as unknown as Plan;
  if (!source || typeof source !== 'object') return { summary: '', steps: [] };
  const obj = source as Record<string, unknown>;
  const rawSteps = Array.isArray(obj.steps)
    ? obj.steps
    : Array.isArray(obj.plan)
      ? obj.plan
      : [];
  const steps = rawSteps.slice(0, MAX_PLAN_STEPS).map((entry, index) => {
    const step = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const args = step.argsJson ?? step.args ?? step.arguments ?? {};
    const deps = step.dependsOn ?? step.depends_on ?? [];
    const id = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : `s${index + 1}`;
    const tool = typeof step.tool === 'string' ? step.tool.trim() : String(step.tool ?? '').trim();
    return {
      id,
      tool,
      argsJson: toArgString(args),
      rationale: typeof step.rationale === 'string' ? step.rationale : String(step.rationale ?? ''),
      dependsOn: (Array.isArray(deps) ? deps : typeof deps === 'string' && deps ? [deps] : [])
        .filter((d) => typeof d === 'string' || typeof d === 'number')
        .map(String),
    };
  });
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : String(obj.summary ?? ''),
    steps: steps.filter((s) => s.tool),
  };
}

export class SdkStructuredPlanner implements Planner {
  readonly kind: PlannerKind = 'sdk';

  constructor(private readonly opts: SdkStructuredPlannerOptions) {}

  async *plan(input: PlanInput): AsyncGenerator<PlannerEvent, PlanResult> {
    return yield* this.streamPlan(
      input.systemPrompt,
      buildPlannerPrompt(input.catalog, input.history, input.prompt),
      input.abortSignal
    );
  }

  async *repair(input: RepairInput): AsyncGenerator<PlannerEvent, PlanResult> {
    return yield* this.streamPlan(
      input.systemPrompt,
      buildRepairPrompt(
        input.catalog,
        input.originalPrompt,
        input.remaining,
        input.results,
        input.errorMessage
      ),
      input.abortSignal
    );
  }

  private async *streamPlan(
    system: string,
    prompt: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<PlannerEvent, PlanResult> {
    const model = this.opts.provider.getLanguageModel({
      apiKey: this.opts.apiKey,
      modelId: this.opts.modelId,
    });

    let lastError: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (abortSignal?.aborted) throw new Error('Planning aborted');
      const attemptPrompt =
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous answer was rejected (${lastError}). Answer with a single valid JSON object that matches the schema. No markdown fences.`;

      const streamed = streamText({
        model,
        system: `${system}\n${OUTPUT_RULES}`,
        prompt: attemptPrompt,
        abortSignal,
        maxOutputTokens: 4096,
        temperature: 0.2,
      });

      let text = '';
      try {
        for await (const delta of streamed.textStream) {
          text += delta;
          if (delta.includes('}')) {
            const partial = tryPartialPlan(text);
            if (partial) yield { type: 'partial', plan: partial };
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }

      try {
        const parsed = normalizePlan(JSON.parse(extractJsonObject(text)));
        const plan = planSchema.parse(parsed);
        return { plan, usage: await streamed.usage };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (abortSignal?.aborted) throw new Error('Planning aborted');
      }
    }
    throw new Error(lastError || 'could not parse the response');
  }
}

/** Best-effort streaming preview: only advertise a plan once the JSON closes. */
function tryPartialPlan(text: string): Partial<Plan> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) return null;
  try {
    const json = extractJsonObject(trimmed);
    if (!json.endsWith('}')) return null;
    const plan = normalizePlan(JSON.parse(json));
    return plan.steps.length ? plan : null;
  } catch {
    return null;
  }
}
