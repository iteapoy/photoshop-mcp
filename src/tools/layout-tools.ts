import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { atomicFailure, atomicFailureFromError, atomicSuccess, parseSnippetResult, runSnippet } from './atomic-shared.js';
import { LAYER_NAME_PROPERTY, layerName } from './layer-target.js';

const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const;
type AlignMode = (typeof ALIGN_MODES)[number];

const ALIGN_TARGETS = ['canvas', 'layer'] as const;
type AlignTarget = (typeof ALIGN_TARGETS)[number];

const AXES = ['horizontal', 'vertical'] as const;
type Axis = (typeof AXES)[number];

const DISTRIBUTE_MODES = ['gaps', 'centers'] as const;
type DistributeMode = (typeof DISTRIBUTE_MODES)[number];

const ARRAY_MODES = ['rotate', 'linear'] as const;
type ArrayMode = (typeof ARRAY_MODES)[number];

export function createLayoutTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_align_layers',
        description:
          "Align layers to canvas bounds or a reference layer. Omit layer_names for the active layer.\n" +
          "Use photoshop_set_text_style for text justification; photoshop_distribute_layers for spacing.\n" +
          "Returns: moved[] and skipped[] (background, empty, already aligned).\n" +
          "Preconditions: active document and unlocked targets. Side effects: moves layers; idempotent. Execution failures roll back the call and report rollback failures. Reversible with photoshop_undo.",
        inputSchema: {
          type: 'object',
          properties: {
            align: {
              type: 'string',
              enum: ALIGN_MODES,
              description:
                'Edge or center to align on: left/hcenter/right for the X axis, top/vcenter/bottom for the Y axis',
            },
            target: {
              type: 'string',
              enum: ALIGN_TARGETS,
              description: 'canvas aligns to the document bounds; layer aligns to target_layer_name',
              default: 'canvas',
            },
            target_layer_name: {
              type: 'string',
              description: 'Reference layer for target=layer (exact name, searched recursively)',
            },
            layer_names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Layers to move. Omit to move the active layer.',
            },
          },
          required: ['align'],
        },
      },
      handler: async (args) => alignLayers(connection, args),
    },
    {
      tool: {
        name: 'photoshop_distribute_layers',
        description:
          "Distribute at least three layers evenly along an axis. gaps sorts by leading edge and equalizes gaps; centers sorts by center and equalizes center spacing. Outer layers stay fixed.\n" +
          "Use photoshop_align_layers for edge/center alignment; photoshop_move_layer for offsets.\n" +
          "Returns: axis, mode, gap, order[], moved[].\n" +
          "Preconditions: active document, unique layer names, nonempty unlocked layers. Side effects: moves layers; idempotent. Execution failures roll back the call and report rollback failures. Reversible with photoshop_undo.",
        inputSchema: {
          type: 'object',
          properties: {
            axis: {
              type: 'string',
              enum: AXES,
              description: 'Axis to distribute along',
              default: 'horizontal',
            },
            mode: {
              type: 'string',
              enum: DISTRIBUTE_MODES,
              description: 'gaps equalizes inter-layer spacing; centers equalizes center-to-center distance',
              default: 'gaps',
            },
            layer_names: {
              type: 'array',
              items: { type: 'string' },
              description: 'At least three layer names; they are sorted along the axis before spacing',
              minItems: 3,
            },
          },
          required: ['layer_names'],
        },
      },
      handler: async (args) => distributeLayers(connection, args),
    },
    {
      tool: {
        name: 'photoshop_duplicate_array',
        description:
          "Duplicate a layer into a radial or linear array. count includes the source; create count-1 uniquely named copies.\n" +
          "rotate keeps the source fixed; copy i rotates by start_degrees + total_degrees/count*i around pivot. linear offsets copy i by i times offset_x/offset_y. Use photoshop_duplicate_layer for one copy.\n" +
          "Returns: source, count, created[], and pivot/step_degrees or offset_per_step.\n" +
          "Preconditions: active document, unlocked non-background source. Side effects: adds layers; not idempotent. Execution failures roll back the call and report rollback failures. Reversible with photoshop_undo.",
        inputSchema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Total instances including the source layer (2–100)',
              minimum: 2,
              maximum: 100,
            },
            mode: {
              type: 'string',
              enum: ARRAY_MODES,
              description: 'rotate for a ring around a pivot; linear for evenly stepped copies',
              default: 'rotate',
            },
            pivot_x: {
              type: 'number',
              description: 'Ring center X in pixels (default: document center)',
            },
            pivot_y: {
              type: 'number',
              description: 'Ring center Y in pixels (default: document center)',
            },
            total_degrees: {
              type: 'number',
              description: 'Angle covered by the whole ring, source included (default 360)',
              default: 360,
            },
            start_degrees: {
              type: 'number',
              description: 'Angle of the first copy; the source counts as index 0 (default 0)',
              default: 0,
            },
            offset_x: {
              type: 'number',
              description: 'Linear mode: horizontal step per copy in pixels (default 0)',
              default: 0,
            },
            offset_y: {
              type: 'number',
              description: 'Linear mode: vertical step per copy in pixels (default 0)',
              default: 0,
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['count'],
        },
      },
      handler: async (args) => duplicateArray(connection, args),
    },
  ];
}

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function alignLayers(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const align = ALIGN_MODES.includes(args.align as AlignMode) ? (args.align as AlignMode) : undefined;
  if (!align) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: `align must be one of ${ALIGN_MODES.join(', ')}`,
    });
  }
  const target = ALIGN_TARGETS.includes(args.target as AlignTarget)
    ? (args.target as AlignTarget)
    : 'canvas';
  const targetLayerName =
    typeof args.target_layer_name === 'string' ? args.target_layer_name.trim() : '';
  if (target === 'layer' && !targetLayerName) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'target_layer_name is required when target is "layer"',
    });
  }
  const layerNames = readStringArray(args.layer_names);

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.alignLayers(align, target, targetLayerName, layerNames)
    );
    const details = parseSnippetResult(raw);
    if (!details) {
      return atomicFailureFromError(new Error(`Unparseable align result: ${String(raw)}`));
    }
    const moved = Array.isArray(details.moved) ? details.moved : [];
    const skipped = Array.isArray(details.skipped) ? details.skipped : [];
    const summary =
      moved.length === 0
        ? `Nothing moved: ${skipped.length} layer(s) skipped`
        : `Aligned ${moved.length} layer(s) ${align} to ${target}${skipped.length ? `, skipped ${skipped.length}` : ''}`;
    return atomicSuccess(summary, details);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function distributeLayers(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const axis = AXES.includes(args.axis as Axis) ? (args.axis as Axis) : 'horizontal';
  const mode = DISTRIBUTE_MODES.includes(args.mode as DistributeMode)
    ? (args.mode as DistributeMode)
    : 'gaps';
  const layerNames = readStringArray(args.layer_names);
  if (layerNames.length < 3) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'layer_names needs at least 3 entries to distribute',
    });
  }

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.distributeLayers(axis, mode, layerNames)
    );
    const details = parseSnippetResult(raw);
    if (!details) {
      return atomicFailureFromError(new Error(`Unparseable distribute result: ${String(raw)}`));
    }
    const moved = Array.isArray(details.moved) ? details.moved : [];
    const gap = typeof details.gap === 'number' ? ` gap=${Math.round(details.gap * 100) / 100}px` : '';
    return atomicSuccess(
      `Distributed ${layerNames.length} layer(s) along ${axis} (${mode})${gap}, moved ${moved.length}`,
      details
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function duplicateArray(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const count = typeof args.count === 'number' ? Math.trunc(args.count) : NaN;
  if (!Number.isFinite(count) || count < 2 || count > 100) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'count must be an integer between 2 and 100',
    });
  }
  const mode = ARRAY_MODES.includes(args.mode as ArrayMode) ? (args.mode as ArrayMode) : 'rotate';
  const numberArg = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const pivotX =
    typeof args.pivot_x === 'number' && Number.isFinite(args.pivot_x) ? args.pivot_x : null;
  const pivotY =
    typeof args.pivot_y === 'number' && Number.isFinite(args.pivot_y) ? args.pivot_y : null;
  const totalDegrees = numberArg(args.total_degrees, 360);
  const startDegrees = numberArg(args.start_degrees, 0);
  const offsetX = numberArg(args.offset_x, 0);
  const offsetY = numberArg(args.offset_y, 0);

  if (mode === 'linear' && offsetX === 0 && offsetY === 0) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'linear mode needs a non-zero offset_x or offset_y',
    });
  }

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.duplicateArray(
        layerName(args),
        count,
        mode,
        pivotX,
        pivotY,
        totalDegrees,
        startDegrees,
        offsetX,
        offsetY
      )
    );
    const details = parseSnippetResult(raw);
    if (!details) {
      return atomicFailureFromError(new Error(`Unparseable array result: ${String(raw)}`));
    }
    const created = Array.isArray(details.created) ? details.created : [];
    return atomicSuccess(
      `Duplicated "${String(details.source ?? 'layer')}" into ${count} instance(s) (${mode}); created ${created.length}`,
      details
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
