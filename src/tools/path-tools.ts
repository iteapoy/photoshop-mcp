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

const coordinatePair = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

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
              minItems: 1,
              items: {
                type: 'array',
                minItems: 1,
                items: {
                  anyOf: [
                    coordinatePair,
                    {
                      type: 'object',
                      properties: {
                        anchor: coordinatePair,
                        leftDirection: coordinatePair,
                        rightDirection: coordinatePair,
                      },
                      required: ['anchor'],
                    },
                  ],
                },
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
          'Rasterize a native vector stroke onto the target pixel layer, preserving its ID, selection and foreground color. Width is in pixels, opacity is 0–100, and inside/outside alignment requires closed paths. For a dashed/dotted line, pass dash and gap (both in px, e.g. dash=8, gap=6); omit both for a solid stroke.\n\n' +
          'Use when: turning a path (from photoshop_create_path) into a visible line, dashed orbit, or outline.\n' +
          'Do NOT use when: you need a fill (interior) — use photoshop_fill_path.\n\n' +
          'Returns: confirmation with stroke color and whether it was dashed.\n' +
          'Preconditions: a path created via photoshop_create_path, and an active target layer.',
        inputSchema: {
          type: 'object',
          properties: {
            width: { type: 'number', minimum: 0.1, maximum: 1000, default: 1, description: 'Stroke width in pixels.' },
            opacity: { type: 'number', minimum: 0, maximum: 100, default: 100 },
            alignment: { type: 'string', enum: ['inside', 'center', 'outside'], default: 'center',
              description: 'Inside/outside require all subpaths to be closed. Open paths support center.' },
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

  const width = args.width === undefined ? 1 : args.width;
  const opacity = args.opacity === undefined ? 100 : args.opacity;
  const alignment = args.alignment ?? 'center';
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0.1 || width > 1000 ||
      typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 100 ||
      !['inside', 'center', 'outside'].includes(String(alignment)) ||
      (args.dash !== undefined && (typeof args.dash !== 'number' || !Number.isFinite(args.dash) || args.dash < 0)) ||
      (args.gap !== undefined && (typeof args.gap !== 'number' || !Number.isFinite(args.gap) || args.gap < 0)) ||
      ((dash > 0) !== (gap > 0))) {
    return atomicFailureFromError(new Error('Invalid parameter: width, opacity, alignment, or dash/gap pair'));
  }
  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.strokePath(name, color.r, color.g, color.b, dash, gap, {
        width, opacity, alignment: alignment as 'inside' | 'center' | 'outside',
      })
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
