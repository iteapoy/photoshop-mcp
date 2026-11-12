import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { LAYER_NAME_PROPERTY, layerName } from './layer-target.js';

export function createLayerOrderingTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_move_layer_to_position',
        description:
          'Reorder a layer relative to a named layer. `position` is ABOVE, BELOW, TOP, or BOTTOM of `targetLayerName`. This changes stacking order, not canvas pixels. Pass layer_name for the layer being moved (default: the active layer).\n\n' +
          'Use when: the layer must sit above or below a specific other layer.\n' +
          'Do NOT use when: it should go to the top or bottom of the whole stack — use photoshop_move_layer_to_top or photoshop_move_layer_to_bottom.\n' +
          'Do NOT use when: it should move one step — use photoshop_move_layer_up or photoshop_move_layer_down.\n' +
          'Do NOT use when: you mean a pixel offset on the canvas — use photoshop_move_layer.\n\n' +
          'Returns: moved layerName, position, and relativeTo.\n' +
          'Preconditions: active document, one moving layer, and an existing targetLayerName (nested groups are searched). Side effects: stacking order only. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            targetLayerName: {
              type: 'string',
              description: 'Name of the layer to move relative to',
            },
            position: {
              type: 'string',
              description: 'Position relative to target layer',
              enum: ['ABOVE', 'BELOW', 'TOP', 'BOTTOM'],
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['targetLayerName', 'position'],
        },
      },
      handler: async (args) => moveLayerToPosition(connection, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_to_top',
        description:
          'Move a layer to the top of its own group (or of the document when it is a top-level layer). Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Returns: moved (false when it is already on top) and layerName.\n' +
          'Preconditions: active document. Side effects: stacking order only. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => moveLayerToTop(connection, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_to_bottom',
        description:
          'Move a layer to the bottom of its own group (or of the document when it is a top-level layer). Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Returns: moved (false when it is already at the bottom) and layerName.\n' +
          'Preconditions: active document and a non-background layer. Side effects: stacking order only. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => moveLayerToBottom(connection, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_up',
        description:
          'Move a layer up one position inside its own group. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Returns: moved (false when it is already at the top) and layerName.\n' +
          'Preconditions: active document. Side effects: stacking order only. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => moveLayerUp(connection, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_down',
        description:
          'Move a layer down one position inside its own group. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Returns: moved (false when it is already at the bottom) and layerName.\n' +
          'Preconditions: active document. Side effects: stacking order only. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => moveLayerDown(connection, args),
    },
  ];
}

async function moveLayerToPosition(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const targetLayerName = args.targetLayerName as string;
  const position = args.position as string;
  const target = layerName(args);

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.moveLayerToPosition(targetLayerName, position, target);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved ${position} "${targetLayerName}"\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayerToTop(
  connection: PhotoshopConnection,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  return runOrdering(connection, ExtendScriptSnippets.moveLayerToTop(layerName(args)), 'to top');
}

async function moveLayerToBottom(
  connection: PhotoshopConnection,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  return runOrdering(
    connection,
    ExtendScriptSnippets.moveLayerToBottom(layerName(args)),
    'to bottom'
  );
}

async function moveLayerUp(
  connection: PhotoshopConnection,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  return runOrdering(connection, ExtendScriptSnippets.moveLayerUp(layerName(args)), 'up');
}

async function moveLayerDown(
  connection: PhotoshopConnection,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  return runOrdering(connection, ExtendScriptSnippets.moveLayerDown(layerName(args)), 'down');
}

async function runOrdering(
  connection: PhotoshopConnection,
  script: string,
  direction: string
): Promise<ToolResult> {
  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved ${direction}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer ${direction}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
