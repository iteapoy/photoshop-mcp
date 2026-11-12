import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { LAYER_BLEND_MODE_ENUM, resolveLayerBlendMode } from './blend-mode.js';
import { LAYER_NAME_PROPERTY, layerName } from './layer-target.js';

/** Re-exported so existing imports keep working. */
export { LAYER_NAME_PROPERTY, layerName } from './layer-target.js';

export function createLayerPropertiesTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_rasterize_layer',
        description:
          'Rasterize a layer, converting text or a smart object to a normal pixel layer. Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Use when: a filter, fill, or transform needs real pixels (text and smart objects cannot take most filters).\n' +
          'Do NOT use when: the text stays editable — restyle it with photoshop_set_text_color / photoshop_execute_script instead.\n' +
          'Do NOT use when: the layer is already NORMAL — the call is a no-op that reports it.\n\n' +
          'Returns: rasterized, layerName, originalKind, newKind.\n' +
          'Preconditions: active document and a single (non-group) layer. Side effects: irreversible content change (text becomes pixels); makes the layer active. Undo restores the previous state.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => rasterizeLayer(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_opacity',
        description:
          'Set a layer opacity to an absolute 0–100 value. The number replaces the current opacity; it is not added to it. ' +
          'Pass layer_name to target a layer directly, otherwise the active layer is used.\n\n' +
          'Use when: the active layer should be more or less transparent.\n' +
          'Do NOT use when: the layer should be fully hidden from the stack — use photoshop_set_layer_visibility.\n' +
          'Do NOT use when: fading into the background with a mask gradient — use photoshop_recipe_gradient_fade.\n\n' +
          'Returns: the opacity that was set.\n' +
          'Preconditions: active document and active layer. Side effects: opacity only. The same value is idempotent. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            opacity: {
              type: 'number',
              description: 'Opacity value (0-100)',
              minimum: 0,
              maximum: 100,
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['opacity'],
        },
      },
      handler: async (args) => setLayerOpacity(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_blend_mode',
        description:
          'Set the blend mode of a layer (layer_name), or of the active layer when omitted.\n\n' +
          '`COLOR` is the Photoshop UI name (Colorize); it is mapped to ExtendScript `BlendMode.COLORBLEND`.',
        inputSchema: {
          type: 'object',
          properties: {
            blendMode: {
              type: 'string',
              description:
                'Blend mode (Photoshop UI name). COLOR maps to BlendMode.COLORBLEND. ' +
                'DARKERCOLOR / LIGHTERCOLOR use Action Manager if the DOM enum is missing.',
              enum: [...LAYER_BLEND_MODE_ENUM],
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['blendMode'],
        },
      },
      handler: async (args) => setLayerBlendMode(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_visibility',
        description:
          'Show or hide a layer. Pass layer_name to target it directly; omit to use the active layer.\n\n' +
          'Use when: a layer should be hidden or revealed in one call.\n' +
          'Do NOT use when: the whole group should toggle — name the group itself.\n\n' +
          'Returns: the resolved layerName and its new visible flag.\n' +
          'Preconditions: active document. Side effects: visibility only; idempotent; reversible.',
        inputSchema: {
          type: 'object',
          properties: {
            visible: {
              type: 'boolean',
              description: 'Whether the layer should be visible',
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['visible'],
        },
      },
      handler: async (args) => setLayerVisibility(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_locked',
        description:
          'Set the all-lock flag on a layer (layer_name, or the active layer). `locked: true` blocks further edits to that layer; `false` clears the lock.\n\n' +
          'Use when: the user asks to lock or unlock the current layer.\n' +
          'Do NOT use when: the layer should only be hidden — use photoshop_set_layer_visibility.\n' +
          'Do NOT use when: many layers need locking at once.\n\n' +
          'Returns: confirmation of the lock state.\n' +
          'Preconditions: active document; layer_name or an active layer. Side effects: sets layer.allLocked. The same boolean is idempotent. Reversible with photoshop_undo or by calling again with the opposite value.',
        inputSchema: {
          type: 'object',
          properties: {
            locked: {
              type: 'boolean',
              description: 'Whether the layer should be locked',
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['locked'],
        },
      },
      handler: async (args) => setLayerLocked(connection, args),
    },
    {
      tool: {
        name: 'photoshop_rename_layer',
        description:
          'Rename a layer (layer_name, or the active layer). Does not change pixels, order, or visibility.\n\n' +
          'Use when: the active layer needs a stable name for a later photoshop_select_layer_by_name.\n' +
          'Do NOT use when: many layers should be renamed by kind — use photoshop_recipe_organize_layers.\n' +
          'Do NOT use when: many layers should be renamed by kind.\n\n' +
          'Returns: the new layer name.\n' +
          'Preconditions: active document; layer_name or an active layer. Side effects: the name only. Setting the same name is idempotent. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'New name for the layer',
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
          required: ['name'],
        },
      },
      handler: async (args) => renameLayer(connection, args),
    },
    {
      tool: {
        name: 'photoshop_duplicate_layer',
        description:
          'Duplicate a layer. Pass layer_name to copy a specific layer, otherwise the active layer is copied. ' +
          'The duplicate becomes the active layer; returns its name and, when available, its layer id.\n\n' +
          'Use when: a copy should be edited without touching the original (Layer via Copy).\n' +
          'Do NOT use when: a linked instance is wanted — use photoshop_smart_object_convert instead.\n\n' +
          'Preconditions: active document and one layer. Side effects: adds a layer and changes the active layer. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            newName: {
              type: 'string',
              description: 'Name for the duplicated layer (optional)',
            },
            layer_name: { ...LAYER_NAME_PROPERTY },
          },
        },
      },
      handler: async (args) => duplicateLayer(connection, args),
    },
    {
      tool: {
        name: 'photoshop_merge_visible_layers',
        description:
          'Merge every visible layer into one layer. Hidden layers stay in the stack.\n\n' +
          'Use when: the user wants visible layers combined and hidden layers kept.\n' +
          'Do NOT use when: every layer, including hidden ones, should become a single Background — use photoshop_flatten_image.\n' +
          'Do NOT use when: only two named layers should combine — this always merges all visible layers.\n\n' +
          'Returns: confirmation that visible layers were merged.\n' +
          'Preconditions: active document with at least one visible layer. Side effects: destroys the separate visible layers in one history step. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => mergeVisibleLayers(connection),
    },
    {
      tool: {
        name: 'photoshop_flatten_image',
        description:
          'Flatten the active document into a single Background layer. Hidden layers are discarded.\n\n' +
          'Use when: the user explicitly wants one background layer and no remaining layer stack.\n' +
          'Do NOT use when: hidden layers should survive — use photoshop_merge_visible_layers.\n' +
          'Do NOT use when: layers must stay editable.\n\n' +
          'Returns: confirmation that the document was flattened.\n' +
          'Preconditions: active document. Side effects: destroys every layer, mask, and hidden pixel. photoshop_undo can restore the stack while history still holds it.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => flattenImage(connection),
    },
  ];
}

async function setLayerOpacity(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const opacity = args.opacity as number;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.setLayerOpacity(opacity, layerName(args));
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer opacity set to ${opacity}%`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting layer opacity: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerBlendMode(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const requested = typeof args.blendMode === 'string' ? args.blendMode : '';
  const extendScriptToken = resolveLayerBlendMode(requested);
  if (!extendScriptToken) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting blend mode: unknown blendMode "${requested}"`,
        },
      ],
      isError: true,
    };
  }

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.setLayerBlendMode(extendScriptToken, layerName(args));
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer blend mode set to ${requested}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting blend mode: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerVisibility(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const visible = args.visible as boolean;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.setLayerVisibility(visible, layerName(args));
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${visible ? 'shown' : 'hidden'}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting layer visibility: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerLocked(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const locked = args.locked as boolean;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.setLayerLocked(locked, layerName(args));
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${locked ? 'locked' : 'unlocked'}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error locking/unlocking layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function renameLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.renameLayer(name, layerName(args));
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer renamed to: ${name}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error renaming layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function duplicateLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const newName = args.newName as string | undefined;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.duplicateLayer(newName, layerName(args));
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer duplicated\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error duplicating layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function mergeVisibleLayers(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.mergeVisibleLayers();
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'All visible layers merged',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error merging visible layers: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function flattenImage(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.flattenImage();
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Image flattened (all layers merged to background)',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error flattening image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function rasterizeLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.rasterizeLayer(layerName(args));
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer rasterized\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error rasterizing layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
