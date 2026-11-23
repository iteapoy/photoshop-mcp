import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';
import { LAYER_NAME_PROPERTY, layerName } from './layer-target.js';

export function createLayerOrderingTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_reorder_layer',
        description:
          'Change layer stacking order: up/down by one sibling, top/bottom within its containing group, or above/below a reference layer. ' +
          'Use layer_id for an exact source; relative placement requires target_layer_id or an unambiguous target_layer_name. ' +
          'Use photoshop_move_layer for pixel offsets. Preconditions: active document. Side effects: stacking order only; reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            position: { type: 'string', enum: ['up', 'down', 'top', 'bottom', 'above', 'below'] },
            layer_name: { ...LAYER_NAME_PROPERTY },
            target_layer_id: {
              type: 'integer',
              minimum: 1,
              description: 'Reference layer ID for above/below.',
            },
            target_layer_name: {
              type: 'string',
              minLength: 1,
              description: 'Unique reference layer name for above/below.',
            },
          },
          required: ['position'],
          additionalProperties: false,
        },
      },
      handler: async (args) => reorderLayer(connection, args),
    },
  ];
}

/** Build a validated ordering command before communicating with Photoshop. */
export function reorderLayerScript(args: Record<string, unknown>): string {
  const position = args.position;
  if (
    typeof position !== 'string' ||
    !['up', 'down', 'top', 'bottom', 'above', 'below'].includes(position)
  ) {
    throw new Error('Invalid parameter: position must be up, down, top, bottom, above, or below');
  }
  const hasId = args.target_layer_id !== undefined;
  const hasName = args.target_layer_name !== undefined;
  const relative = position === 'above' || position === 'below';
  if (relative ? hasId === hasName : hasId || hasName) {
    throw new Error(
      relative
        ? 'Invalid parameter: above/below requires exactly one of target_layer_id or target_layer_name'
        : 'Invalid parameter: target_layer_id and target_layer_name only apply to above/below'
    );
  }
  if (
    hasId &&
    (typeof args.target_layer_id !== 'number' ||
      !Number.isSafeInteger(args.target_layer_id) ||
      args.target_layer_id <= 0)
  ) {
    throw new Error('Invalid parameter: target_layer_id must be a positive integer');
  }
  if (hasName && (typeof args.target_layer_name !== 'string' || !args.target_layer_name.trim())) {
    throw new Error('Invalid parameter: target_layer_name must be a non-empty string');
  }
  const name = layerName(args);
  if (relative)
    return ExtendScriptSnippets.moveLayerToPosition(
      hasName ? (args.target_layer_name as string).trim() : '',
      position.toUpperCase(),
      name,
      hasId ? (args.target_layer_id as number) : undefined
    );
  const methods = {
    up: ExtendScriptSnippets.moveLayerUp,
    down: ExtendScriptSnippets.moveLayerDown,
    top: ExtendScriptSnippets.moveLayerToTop,
    bottom: ExtendScriptSnippets.moveLayerToBottom,
  };
  return methods[position as keyof typeof methods](name);
}

async function reorderLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  let script: string;
  try {
    script = reorderLayerScript(args);
  } catch (error) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: (error as Error).message,
    });
  }
  try {
    const details = parseSnippetResult(await runSnippet(connection, script));
    if (!details) throw new Error('Unparseable layer ordering result');
    return atomicSuccess(
      details.moved === false ? 'Layer order unchanged' : 'Layer reordered ' + args.position,
      details
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
