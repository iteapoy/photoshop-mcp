import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from './tool-registry.js';

const target = new AsyncLocalStorage<number | undefined>();
const preserveVisibility = new AsyncLocalStorage<boolean>();
const ACTIVE_LAYER_TOOLS = new Set([
  'photoshop_fill_layer', 'photoshop_fill_gradient', 'photoshop_stroke_path',
  'photoshop_fill_path', 'photoshop_rename_layer', 'photoshop_delete_layer',
  'photoshop_select_layer_by_name',
  'photoshop_update_text_content', 'photoshop_set_text_font',
  'photoshop_set_text_color', 'photoshop_set_text_alignment',
  'photoshop_set_text_style', 'photoshop_set_text_ranges',
  'photoshop_create_layer_mask', 'photoshop_apply_layer_mask',
  'photoshop_delete_layer_mask', 'photoshop_apply_gradient_mask',
  'photoshop_content_aware_fill',
  'photoshop_apply_gaussian_blur', 'photoshop_apply_motion_blur',
  'photoshop_apply_smart_blur', 'photoshop_apply_high_pass',
  'photoshop_apply_noise', 'photoshop_apply_sharpen',
  'photoshop_adjust_brightness_contrast', 'photoshop_adjust_hue_saturation',
  'photoshop_auto_levels', 'photoshop_auto_contrast',
  'photoshop_desaturate', 'photoshop_invert',
]);

function supportsLayerId(tool: Tool): boolean {
  return Boolean(tool.inputSchema.properties?.layer_name) || ACTIVE_LAYER_TOOLS.has(tool.name);
}

export function withOptionalLayerId(tool: Tool): Tool {
  if (!supportsLayerId(tool)) return tool;
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      required: tool.name === 'photoshop_select_layer_by_name'
        ? (tool.inputSchema.required ?? []).filter((key) => key !== 'name')
        : tool.inputSchema.required,
      properties: {
        ...tool.inputSchema.properties,
        layer_id: {
          type: 'integer', minimum: 1,
          description: 'Exact layer ID in the target document. Cannot be combined with layer_name or layer_index. Selected atomically before execution.',
        },
      },
    },
  };
}

export function wrapLayerIdHandler(tool: Tool, handler: ToolHandler): ToolHandler {
  const wrapped: ToolHandler = (args) => {
    const raw = args.layer_id;
    if (!supportsLayerId(tool) || raw === undefined) return target.run(undefined, () => handler(args));
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
      throw new Error('Invalid parameter: layer_id must be a positive integer');
    }
    if (args.layer_name !== undefined || args.layer_index !== undefined ||
        (tool.name === 'photoshop_select_layer_by_name' && args.name !== undefined)) {
      throw new Error('Invalid parameter: layer_id conflicts with layer_name or layer_index');
    }
    return target.run(raw, () => handler(args));
  };
  return (args) => preserveVisibility.run(
    supportsLayerId(tool) && tool.name !== 'photoshop_set_layer_visibility',
    () => wrapped(args)
  );
}

export function shouldPreserveLayerVisibility(): boolean {
  return preserveVisibility.getStore() ?? false;
}

export function getTargetLayerId(): number | undefined { return target.getStore(); }

export function layerGuardScript(id: number): string {
  return `
    var __mcp_targetLayerId = ${id};
    (function() {
      if (!app.documents.length) throw new Error('No active document');
      function find(container) {
        for (var i = 0; i < container.layers.length; i++) {
          var layer = container.layers[i];
          if (layer.id === __mcp_targetLayerId) return layer;
          if (layer.typename === 'LayerSet') {
            var nested = find(layer);
            if (nested) return nested;
          }
        }
        return null;
      }
      var found = find(app.activeDocument);
      if (!found) throw new Error('layer_not_found: no layer with id ' + __mcp_targetLayerId);
      var chain = [], node = found;
      while (node && node.typename !== 'Document') {
        chain.push({ layer: node, visible: node.visible });
        node = node.parent;
      }
      app.activeDocument.activeLayer = found;
      for (var ci = 0; ci < chain.length; ci++) {
        if (chain[ci].layer.visible !== chain[ci].visible) chain[ci].layer.visible = chain[ci].visible;
      }
    })();
  `;
}
