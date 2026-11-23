import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { LAYER_NAME_PROPERTY, layerName } from './layer-target.js';

export function createLayerTransformTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_fit_layer_to_document',
        description:
          'Scale a layer to the document canvas, keeping aspect ratio. `fillDocument: false` (default) fits inside and may letterbox; `true` covers the canvas and may crop the layer. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Use when: a placed layer should match the canvas size.\n' +
          'Do NOT use when: you want a specific percent — use photoshop_scale_layer.\n' +
          'Do NOT use when: the document canvas itself should change size — use photoshop_resize_image or photoshop_crop_document.\n\n' +
          'Returns: confirmation of the fit, including layerName and the resolved scale percent.\n' +
          'Preconditions: active document and one non-background layer. Side effects: transforms that layer. Does not change document dimensions. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            fillDocument: {
              type: 'boolean',
              description:
                'If true, fills entire canvas (may crop). If false, fits within canvas (may have margins). Default: false',
              default: false,
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => fitLayerToDocument(connection, args),
    },
    {
      tool: {
        name: 'photoshop_scale_layer',
        description:
          'Scale a layer by a percentage (100 leaves the size unchanged). `centerAnchor` true (default) scales from the center; false scales from the top-left. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Use when: a numeric percent scale on one layer.\n' +
          'Do NOT use when: the layer should fit the canvas automatically — use photoshop_fit_layer_to_document.\n' +
          'Do NOT use when: the document dimensions should change — use photoshop_resize_image.\n' +
          'Do NOT use when: the layer has no pixels yet — fill it first. An empty layer fails with an empty bounding rectangle.\n\n' +
          'Returns: the scale percent applied and the resolved layerName.\n' +
          'Preconditions: active document and one non-background layer. Side effects: transforms that layer, one history step. 100% does not change size; any other percent is not idempotent. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            scalePercent: {
              type: 'number',
              description: 'Scale percentage (e.g., 50 for 50%, 200 for 200%)',
              minimum: 1,
            },
            centerAnchor: {
              type: 'boolean',
              description: 'Scale from center (true) or top-left (false). Default: true',
              default: true,
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['scalePercent'],
        },
      },
      handler: async (args) => scaleLayer(connection, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer',
        description:
          'Move a layer by a pixel offset. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Use when: nudging a layer into place (e.g. after measuring a bounds offset).\n' +
          'Do NOT use when: the layer needs to be reordered in the stack — use photoshop_reorder_layer.\n\n' +
          'Returns: deltaX, deltaY and the resolved layerName.\n' +
          'Preconditions: active document and one non-background layer. Side effects: pixel offset; not idempotent. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            deltaX: {
              type: 'number',
              description: 'Horizontal offset in pixels (can be negative)',
            },
            deltaY: {
              type: 'number',
              description: 'Vertical offset in pixels (can be negative)',
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['deltaX', 'deltaY'],
        },
      },
      handler: async (args) => moveLayer(connection, args),
    },
    {
      tool: {
        name: 'photoshop_rotate_layer',
        description:
          'Rotate a layer by `degrees` (positive is clockwise) around its center. The document canvas does not rotate. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Use when: one layer needs a rotation.\n' +
          'Do NOT use when: the layer should scale or move in pixels — use photoshop_scale_layer or photoshop_move_layer.\n' +
          'Do NOT use when: the whole canvas orientation should change — this tool does not rotate the document.\n\n' +
          'Returns: the degrees applied and the resolved layerName.\n' +
          'Preconditions: active document and one non-background layer. Side effects: transforms that layer, one history step. A second call adds another rotation. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            degrees: {
              type: 'number',
              description:
                'Rotation angle in degrees (positive = clockwise, negative = counter-clockwise)',
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['degrees'],
        },
      },
      handler: async (args) => rotateLayer(connection, args),
    },
  ];
}

async function fitLayerToDocument(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const fillDocument = (args.fillDocument as boolean) || false;
  const target = layerName(args);

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.fitLayerToDocument(fillDocument, target);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${fillDocument ? 'filled' : 'fitted'} to document\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fitting layer to document: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function scaleLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const scalePercent = args.scalePercent as number;
  const centerAnchor = args.centerAnchor !== undefined ? (args.centerAnchor as boolean) : true;
  const target = layerName(args);

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.scaleLayer(scalePercent, centerAnchor, target);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer scaled to ${scalePercent}%\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error scaling layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const deltaX = args.deltaX as number;
  const deltaY = args.deltaY as number;
  const target = layerName(args);

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.moveLayer(deltaX, deltaY, target);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved by (${deltaX}, ${deltaY})px\nResult: ${JSON.stringify(result)}`,
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

async function rotateLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const degrees = args.degrees as number;
  const target = layerName(args);

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.rotateLayer(degrees, target);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer rotated ${degrees} degrees\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error rotating layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
