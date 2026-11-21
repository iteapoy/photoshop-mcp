import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicSuccess,
  atomicFailure,
  atomicFailureFromError,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

function parseNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseColor(args: Record<string, unknown>): { r: number; g: number; b: number } {
  return {
    r: Math.max(0, Math.min(255, Math.round(parseNumber(args.red, 255)))),
    g: Math.max(0, Math.min(255, Math.round(parseNumber(args.green, 255)))),
    b: Math.max(0, Math.min(255, Math.round(parseNumber(args.blue, 255)))),
  };
}

function normalizeSubpaths(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  for (const sub of raw) {
    if (!Array.isArray(sub) || sub.length === 0) return null;
  }
  return raw as unknown[];
}

export function createPathTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_create_path',
        description:
          'Create (or replace) a named vector path from one or more subpaths of anchor points. Each point is [x, y] for a straight corner, or { anchor:[x,y], leftDirection:[x,y], rightDirection:[x,y] } for a smooth bezier point. This is the "pen tool" equivalent exposed over the MCP: it draws an editable path object in the Paths panel (not rasterized).\n\n' +
          'Use when: drawing a precise curve/outline, preparing a stroke or fill, or building vector shapes.\n' +
          'Do NOT use when: a simple rectangle/ellipse pixel selection is enough — use photoshop_select_rectangle / photoshop_select_ellipse.\n\n' +
          'Returns: the path name and subpath count. The path is NOT visible until stroked or filled.\n' +
          'Preconditions: active document. Side effects: replaces any existing path with the same name.',
        inputSchema: {
          type: 'object',
          properties: {
            subpaths: {
              type: 'array',
              description:
                'Array of subpaths. Each subpath is an array of points: [x,y] or {anchor,leftDirection,rightDirection}.',
              items: {
                type: 'array',
                items: { type: 'array' },
              },
            },
            closed: {
              type: 'boolean',
              description: 'Whether each subpath is closed (default false)',
              default: false,
            },
            name: {
              type: 'string',
              description: 'Path name in the Paths panel (default "Work Path")',
            },
          },
          required: ['subpaths'],
        },
      },
      handler: async (args) => createPath(connection, args),
    },
    {
      tool: {
        name: 'photoshop_stroke_path',
        description:
          'Stroke a named vector path onto the active layer with an RGB color. For a dashed/dotted line, pass dash and gap (both in px, e.g. dash=8, gap=6); omit both for a solid stroke.\n\n' +
          'Use when: turning a path (from photoshop_create_path) into a visible line, dashed orbit, or outline.\n' +
          'Do NOT use when: you need a fill (interior) — use photoshop_fill_path.\n\n' +
          'Returns: confirmation with stroke color and whether it was dashed.\n' +
          'Preconditions: a path created via photoshop_create_path, and an active target layer.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the path to stroke',
            },
            red: { type: 'number', description: 'Red 0-255 (default 255)' },
            green: { type: 'number', description: 'Green 0-255 (default 255)' },
            blue: { type: 'number', description: 'Blue 0-255 (default 255)' },
            dash: {
              type: 'number',
              description: 'Dash (on) length in px for a dashed line. Omit (with gap) for solid.',
              minimum: 0,
            },
            gap: {
              type: 'number',
              description: 'Gap (off) length in px for a dashed line. Omit (with dash) for solid.',
              minimum: 0,
            },
          },
          required: ['name'],
        },
      },
      handler: async (args) => strokePath(connection, args),
    },
    {
      tool: {
        name: 'photoshop_fill_path',
        description:
          'Fill the interior of a named closed vector path with an RGB color, optionally feathered.\n\n' +
          'Use when: coloring the inside of a closed path shape.\n' +
          'Do NOT use when: you only need the outline — use photoshop_stroke_path.\n\n' +
          'Returns: confirmation with fill color and feather.\n' +
          'Preconditions: a closed path created via photoshop_create_path.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the path to fill' },
            red: { type: 'number', description: 'Red 0-255 (default 255)' },
            green: { type: 'number', description: 'Green 0-255 (default 255)' },
            blue: { type: 'number', description: 'Blue 0-255 (default 255)' },
            feather: { type: 'number', description: 'Feather radius in px (default 0)', minimum: 0 },
          },
          required: ['name'],
        },
      },
      handler: async (args) => fillPath(connection, args),
    },
    {
      tool: {
        name: 'photoshop_delete_path',
        description:
          'Delete a named vector path from the active document.\n\n' +
          'Returns: whether a path was removed.\n' +
          'Preconditions: active document.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the path to delete' },
          },
          required: ['name'],
        },
      },
      handler: async (args) => deletePath(connection, args),
    },
  ];
}

async function createPath(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const subpaths = normalizeSubpaths(args.subpaths);
  if (!subpaths) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'subpaths must be a non-empty array of point arrays',
      suggested_next_tool: 'photoshop_get_state',
    });
  }
  const closed = args.closed === true;
  const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : 'Work Path';

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.createPath(JSON.stringify(subpaths), closed, name)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error('Snippet returned unparseable payload'));
    }
    if (parsed.ok === false) {
      return atomicFailure({
        ok: false,
        code: typeof parsed.code === 'string' ? (parsed.code as never) : 'extendscript_runtime_error',
        message: String(parsed.message || 'Failed to create path'),
        suggested_next_tool: 'photoshop_get_state',
      });
    }
    return atomicSuccess(
      `Path "${parsed.name}" created (${parsed.subpaths} subpath(s))`,
      parsed as Record<string, unknown>,
      'photoshop_stroke_path'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function strokePath(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : 'Work Path';
  const color = parseColor(args);
  const dash = parseNumber(args.dash, 0);
  const gap = parseNumber(args.gap, 0);

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.strokePath(name, color.r, color.g, color.b, dash, gap)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error('Snippet returned unparseable payload'));
    }
    if (parsed.ok === false) {
      return atomicFailure({
        ok: false,
        code: typeof parsed.code === 'string' ? (parsed.code as never) : 'extendscript_runtime_error',
        message: String(parsed.message || 'Failed to stroke path'),
        suggested_next_tool: 'photoshop_get_state',
      });
    }
    const summary = parsed.dashed
      ? `Path "${name}" stroked (dashed ${dash}px/${gap}px)`
      : `Path "${name}" stroked`;
    return atomicSuccess(summary, parsed as Record<string, unknown>, 'photoshop_get_preview');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function fillPath(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : 'Work Path';
  const color = parseColor(args);
  const feather = parseNumber(args.feather, 0);

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.fillPath(name, color.r, color.g, color.b, feather)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error('Snippet returned unparseable payload'));
    }
    if (parsed.ok === false) {
      return atomicFailure({
        ok: false,
        code: typeof parsed.code === 'string' ? (parsed.code as never) : 'extendscript_runtime_error',
        message: String(parsed.message || 'Failed to fill path'),
        suggested_next_tool: 'photoshop_get_state',
      });
    }
    return atomicSuccess(
      `Path "${name}" filled`,
      parsed as Record<string, unknown>,
      'photoshop_get_preview'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function deletePath(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : 'Work Path';

  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.deletePath(name));
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error('Snippet returned unparseable payload'));
    }
    if (parsed.ok === false) {
      return atomicFailure({
        ok: false,
        code: typeof parsed.code === 'string' ? (parsed.code as never) : 'extendscript_runtime_error',
        message: String(parsed.message || 'Failed to delete path'),
        suggested_next_tool: 'photoshop_get_state',
      });
    }
    return atomicSuccess(
      parsed.removed ? `Path "${name}" deleted` : `No path named "${name}" found`,
      parsed as Record<string, unknown>
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
