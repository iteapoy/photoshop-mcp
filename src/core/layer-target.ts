import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from './tool-registry.js';

const target = new AsyncLocalStorage<number | undefined>();
const ACTIVE_LAYER_TOOLS = new Set([
  'photoshop_fill_layer', 'photoshop_fill_gradient', 'photoshop_stroke_path',
  'photoshop_fill_path', 'photoshop_rename_layer', 'photoshop_delete_layer',
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
  return (args) => {
    const raw = args.layer_id;
    if (!supportsLayerId(tool) || raw === undefined) return target.run(undefined, () => handler(args));
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
      throw new Error('Invalid parameter: layer_id must be a positive integer');
    }
    if (args.layer_name !== undefined || args.layer_index !== undefined) {
      throw new Error('Invalid parameter: layer_id conflicts with layer_name or layer_index');
    }
    return target.run(raw, () => handler(args));
  };
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
      app.activeDocument.activeLayer = found;
    })();
  `;
}
