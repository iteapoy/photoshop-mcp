import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, jsonSchema, type ToolSet } from 'ai';
import { Ajv } from 'ajv';
import { PhotoshopMCPServer } from '../src/core/server.js';
import { toolCatalogCases } from './fixtures/tool-catalog-cases.js';

type Arm = 'legacy' | 'compact';
type EvalCase = (typeof toolCatalogCases)[number];
type Call = { toolName: string; input: unknown };
type EvaluationResult = {
  case: string;
  arm: Arm;
  firstPass: boolean;
  finalPass: boolean;
  firstInputTokens: number | undefined;
  retryInputTokens: number | undefined;
  retried: boolean;
  firstError: string | undefined;
  finalError: string | undefined;
  proposed: Call[];
};

const system = [
  'You are evaluating Photoshop MCP tool selection. State and prerequisites are already verified.',
  'Propose exactly one tool call for the requested operation, without preflight or follow-up calls.',
  'Pass only arguments specified by the task or required by the tool. Do not use a script fallback.',
].join(' ');

function loadCatalog(arm: Arm) {
  const server = new PhotoshopMCPServer({
    serverVersion: 'catalog-eval',
    advertiseLegacyTools: arm === 'legacy',
  });
  const catalog = server.listTools();
  const byName = new Map(catalog.map((tool) => [tool.name, tool]));
  const tools: ToolSet = Object.fromEntries(catalog.map((tool) => [
    tool.name,
    {
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema as Parameters<typeof jsonSchema>[0]),
    },
  ]));
  return { byName, tools, entries: catalog.length, jsonChars: JSON.stringify(catalog).length };
}

function expectedCall(testCase: EvalCase, arm: Arm): Call {
  return {
    toolName: testCase[arm],
    input: arm === 'compact' && 'action' in testCase
      ? { ...testCase.args, action: testCase.action }
      : testCase.args,
  };
}

function evaluateCall(
  calls: Call[],
  expected: Call,
  catalog: ReturnType<typeof loadCatalog>,
  ajv: Ajv,
): string | undefined {
  if (calls.length !== 1) return `Expected one tool call, received ${calls.length}.`;
  const [call] = calls;
  const definition = catalog.byName.get(call.toolName);
  if (!definition) return 'The proposed tool is absent from this catalog.';
  if (call.toolName !== expected.toolName) return 'The proposed tool does not perform the requested operation.';
  try {
    assert.deepEqual(call.input, expected.input);
  } catch {
    return 'The proposed action, target, or parameters do not match the task.';
  }
  const validate = ajv.compile(definition.inputSchema);
  if (!validate(call.input)) return ajv.errorsText(validate.errors);
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      case: { type: 'string' },
      model: { type: 'string', default: 'gpt-4.1-mini' },
    },
  });
  const cases = toolCatalogCases.filter((testCase) => !values.case || testCase.id === values.case);
  if (!cases.length) throw new Error(`Unknown case: ${values.case}`);
  const catalogs = { legacy: loadCatalog('legacy'), compact: loadCatalog('compact') };
  const arms = ['legacy', 'compact'] as const;
  const ajv = new Ajv({ strict: false });
  console.table(arms.map((arm) => ({ arm, entries: catalogs[arm].entries, jsonChars: catalogs[arm].jsonChars })));
  for (const testCase of cases) {
    for (const arm of arms) {
      const expected = expectedCall(testCase, arm);
      const error = evaluateCall([expected], expected, catalogs[arm], ajv);
      assert.equal(error, undefined, `${testCase.id} (${arm}): ${error}`);
    }
  }
  if (values['dry-run']) {
    console.log(`Validated ${cases.length} cases against both catalogs. No model calls were made.`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('Set OPENAI_API_KEY for live calls, or pass --dry-run to validate cases offline.');
  const model = createOpenAI({ apiKey }).chat(values.model);
  const results: EvaluationResult[] = [];
  for (const [index, testCase] of cases.entries()) {
    // Alternate which arm goes first to reduce run-order effects.
    const order = index % 2 === 0 ? arms : [...arms].reverse();
    for (const arm of order) {
      const expected = expectedCall(testCase, arm);
      const catalog = catalogs[arm];
      const propose = async (prompt: string) => generateText({
        model,
        system,
        prompt,
        tools: catalog.tools,
        toolChoice: 'auto',
        providerOptions: { openai: { parallelToolCalls: false } },
        maxRetries: 0,
      }).catch((error: unknown) => {
        throw new Error(`${testCase.id} (${arm}): model request failed: ${String(error)}`);
      });

      const first = await propose(testCase.prompt);
      const firstError = evaluateCall(first.toolCalls, expected, catalog, ajv);
      const retry = firstError ? await propose([
        testCase.prompt,
        `Previous proposal: ${JSON.stringify(first.toolCalls.map(({ toolName, input }) => ({ toolName, input })))}.`,
        `Validation feedback: ${firstError} Propose a corrected tool call.`,
      ].join('\n')) : undefined;
      const finalError = retry ? evaluateCall(retry.toolCalls, expected, catalog, ajv) : firstError;
      const finalCalls = retry?.toolCalls ?? first.toolCalls;
      results.push({
        case: testCase.id,
        arm,
        firstPass: !firstError,
        finalPass: !finalError,
        firstInputTokens: first.usage.inputTokens,
        retryInputTokens: retry?.usage.inputTokens,
        retried: Boolean(retry),
        firstError,
        finalError,
        proposed: finalCalls.map(({ toolName, input }) => ({ toolName, input })),
      });
    }
  }

  console.log(`Model: ${values.model}`);
  console.table(results.map(({ proposed, ...result }) => result));
  console.table(arms.map((arm) => {
    const rows = results.filter((result) => result.arm === arm);
    const inputTokens = rows.flatMap((row) => [
      row.firstInputTokens,
      ...(row.retried ? [row.retryInputTokens] : []),
    ]);
    return {
      arm,
      cases: rows.length,
      firstPass: rows.filter((row) => row.firstPass).length,
      finalPass: rows.filter((row) => row.finalPass).length,
      retries: rows.filter((row) => row.retried).length,
      inputTokens: inputTokens.every((count) => count !== undefined)
        ? inputTokens.reduce((sum, count) => sum + count, 0)
        : 'unavailable',
    };
  }));
  for (const { case: id, arm, finalError, proposed } of results) {
    if (finalError) console.log(`${id} (${arm}) final proposal: ${JSON.stringify(proposed)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
