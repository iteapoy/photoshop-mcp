import { describe, expect, it, vi } from 'vitest';
import { describeActionAliases, registerActionTools, updateActionSuggestions } from '../src/core/action-tools.js';
import { withOptionalDocumentId } from '../src/core/document-target.js';
import { withOptionalLayerId } from '../src/core/layer-target.js';
import { PhotoshopMCPServer } from '../src/core/server.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import type { PhotoshopConnection } from '../src/platform/connection.js';
import { createAdjustmentTools } from '../src/tools/adjustment-tools.js';
import { createArtboardTools } from '../src/tools/artboard-tools.js';
import { createColorAdjustmentTools } from '../src/tools/color-adjustment-tools.js';
import { createDataTools } from '../src/tools/data-tools.js';
import { createDocumentTools } from '../src/tools/document-tools.js';
import { createExportTools } from '../src/tools/export-tools.js';
import { createFilterTools } from '../src/tools/filter-tools.js';
import { createGenerativeTools } from '../src/tools/generative-tools.js';
import { createGroupTools } from '../src/tools/group-tools.js';
import { createHistoryStateTools } from '../src/tools/history-state-tools.js';
import { createHistoryTools } from '../src/tools/history-tools.js';
import { createImagePlacementTools } from '../src/tools/image-placement-tools.js';
import { createImageTools } from '../src/tools/image-tools.js';
import { createLayerOrderingTools } from '../src/tools/layer-ordering-tools.js';
import { createLayerPropertiesTools } from '../src/tools/layer-properties-tools.js';
import { createLayerTools } from '../src/tools/layer-tools.js';
import { createLayerTransformTools } from '../src/tools/layer-transform-tools.js';
import { createLayoutTools } from '../src/tools/layout-tools.js';
import { createMaskTools } from '../src/tools/mask-tools.js';
import { createNeuralTools } from '../src/tools/neural-tools.js';
import { createPathTools } from '../src/tools/path-tools.js';
import { createRecipeTools, PHOTOSHOP_RECIPE_TOOL_NAMES } from '../src/tools/recipes/index.js';
import { createSelectionTools } from '../src/tools/selection-tools.js';
import { createShapeTools } from '../src/tools/shape-tools.js';
import { createSmartObjectTools } from '../src/tools/smart-object-tools.js';
import { createStackTools } from '../src/tools/stack-tools.js';
import { createStyleTools } from '../src/tools/style-tools.js';
import { createTextTools } from '../src/tools/text-tools.js';

function setup() {
  const registry = new ToolRegistry();
  const dispatch = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ content: [] }));
  const connection = {} as PhotoshopConnection;
  const factories = [
    createDocumentTools, createGroupTools, createHistoryStateTools, createHistoryTools,
    createLayerOrderingTools, createLayerPropertiesTools, createLayerTools, createLayerTransformTools,
    createTextTools, createArtboardTools, createSelectionTools, createMaskTools, createSmartObjectTools,
    createFilterTools, createPathTools, createLayoutTools, createRecipeTools,
    createAdjustmentTools, createColorAdjustmentTools, createDataTools, createExportTools,
    createGenerativeTools, createImagePlacementTools, createImageTools, createNeuralTools, createStyleTools,
    createShapeTools, createStackTools,
  ];
  for (const create of factories) {
    for (const { tool } of create(connection)) {
      registry.register(tool.name, {
        tool: withOptionalDocumentId(withOptionalLayerId(tool)),
        handler: (args) => dispatch(tool.name, args),
      });
    }
  }
  registerActionTools(registry);
  return { registry, dispatch };
}

describe('grouped MCP actions', () => {
  it('advertises three recipe entries by default and all original recipes in legacy mode', () => {
    const compact = new PhotoshopMCPServer({ serverVersion: 'test' }).listTools();
    const legacy = new PhotoshopMCPServer({
      serverVersion: 'test',
      advertiseLegacyTools: true,
    }).listTools();
    expect(compact).toHaveLength(29);
    expect(compact.filter(({ name }) => name.startsWith('photoshop_recipe_')).map(({ name }) => name))
      .toEqual(['photoshop_recipe_remove_background', 'photoshop_recipe_edit', 'photoshop_recipe_output']);
    expect(legacy).toHaveLength(133);
    expect(legacy.filter(({ name }) => name.startsWith('photoshop_recipe_')).map(({ name }) => name))
      .toEqual(PHOTOSHOP_RECIPE_TOOL_NAMES);
  });

  it('routes the consolidated actions with their original argument names and schemas', async () => {
    const { registry, dispatch } = setup();
    const filePath = 'E:/assets/badge.png';
    const actions = [
      ['photoshop_document', 'open', 'photoshop_open_image', { filePath }],
      ['photoshop_layer', 'place_image', 'photoshop_place_image', { filePath, document_id: 7 }],
      ['photoshop_layer', 'apply_style', 'photoshop_apply_layer_style', { style: 'stroke', layer_id: 42 }],
      ['photoshop_color', 'create_adjustment_layer', 'photoshop_create_adjustment_layer', {
        type: 'exposure', params: { exposure: 0.6 },
      }],
      ['photoshop_dataset', 'import', 'photoshop_import_datasets', { xml_path: 'E:/assets/variants.xml' }],
      ['photoshop_export', 'document_or_artboard', 'photoshop_export_as', {
        artboard_id: 88, path: 'E:/exports/story.webp', format: 'WEBP',
      }],
      ['photoshop_ai', 'neural_filter', 'photoshop_neural_filter', { filter: 'harmonize', reference_layer_id: 56 }],
      ['photoshop_font', 'install', 'photoshop_install_font', { file_path: 'E:/assets/Display.otf' }],
      ['photoshop_document', 'flatten', 'photoshop_flatten_image', { document_id: 7 }],
      ['photoshop_document', 'stack_images', 'photoshop_image_stack', {
        files: ['E:/assets/frame1.png', 'E:/assets/frame2.png'], mode: 'median',
      }],
      ['photoshop_layer', 'content_aware_fill', 'photoshop_content_aware_fill', { document_id: 7, layer_id: 42 }],
      ['photoshop_layer', 'create_shape', 'photoshop_create_shape_layer', {
        type: 'rectangle', left: 10, top: 20, right: 110, bottom: 80,
      }],
    ] as const;
    for (const [tool, action, legacy, args] of actions) {
      await registry.execute(tool, { action, ...args });
      expect(dispatch).toHaveBeenLastCalledWith(legacy, args);
    }

    expect((await registry.execute('photoshop_color', {
      action: 'create_adjustment_layer', type: 'exposure', params: { vibrance: 20 },
    })).isError).toBe(true);
    expect((await registry.execute('photoshop_font', { action: 'list', file_path: 'E:/assets/Display.otf' })).isError)
      .toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(actions.length);
  });

  it('dispatches grouped and legacy recipes with their original arguments', async () => {
    const { registry, dispatch } = setup();
    const sky = { document_id: 7, sky_image_path: 'E:/assets/sky.png' };
    const carousel = { document_id: 7, slides: 5 };
    await registry.execute('photoshop_recipe_edit', { action: 'sky_blend', ...sky });
    await registry.execute('photoshop_recipe_output', { action: 'split_carousel', ...carousel });
    await registry.execute('photoshop_recipe_split_carousel', carousel);
    expect((await registry.execute('photoshop_recipe_edit', { action: 'sky_blend' })).isError)
      .toBe(true);
    expect((await registry.execute('photoshop_recipe_output', { action: 'sky_blend', ...sky })).isError)
      .toBe(true);
    expect(dispatch.mock.calls).toEqual([
      ['photoshop_recipe_sky_blend', sky],
      ['photoshop_recipe_split_carousel', carousel],
      ['photoshop_recipe_split_carousel', carousel],
    ]);
    expect(describeActionAliases('Call `photoshop_recipe_prepare_for_web`.'))
      .toBe('Call photoshop_recipe_output (action: "prepare_for_web").');
  });

  it('routes canvas translation and group membership to different handlers', async () => {
    const { registry, dispatch } = setup();
    const translation = { document_id: 7, layer_id: 42, deltaX: 24, deltaY: 0 };
    const membership = { document_id: 7, layer_ids: [42], group_id: 81 };
    await registry.execute('photoshop_layer', { action: 'translate', ...translation });
    await registry.execute('photoshop_group', { action: 'move_layers_into_group', ...membership });
    expect(dispatch.mock.calls).toEqual([
      ['photoshop_move_layer', translation],
      ['photoshop_move_layers_to_group', membership],
    ]);
  });

  it('rejects swapped arguments and ambiguous move actions before executing a handler', async () => {
    const { registry, dispatch } = setup();
    for (const [name, args] of [
      ['photoshop_layer', { action: 'translate', layer_ids: [42], group_id: 81 }],
      ['photoshop_group', { action: 'move_layers_into_group', layer_id: 42, deltaX: 24, deltaY: 0 }],
      ['photoshop_layer', { action: 'move', deltaX: 24, deltaY: 0 }],
      ['photoshop_group', { action: 'move_layers_into_group', layer_ids: [], group_id: 81 }],
      ['photoshop_layer', { action: 'update', opacity: 50, visible: false }],
    ] as const) {
      expect((await registry.execute(name, args)).isError).toBe(true);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches by the update property and preserves direct legacy calls', async () => {
    const { registry, dispatch } = setup();
    await registry.execute('photoshop_layer', { action: 'update', opacity: 0 });
    await registry.execute('photoshop_layer', { action: 'update', visible: false });
    await registry.execute('photoshop_document', { action: 'list' });
    await registry.execute('photoshop_get_text', { document_id: 7 });
    expect(dispatch.mock.calls).toEqual([
      ['photoshop_set_layer_opacity', { opacity: 0 }],
      ['photoshop_set_layer_visibility', { visible: false }],
      ['photoshop_list_documents', {}],
      ['photoshop_get_text', { document_id: 7 }],
    ]);
  });

  it('routes artboards, selections, masks, and Smart Objects to their original handlers', async () => {
    const { registry, dispatch } = setup();
    const bounds = { left: 10, top: 20, right: 50, bottom: 80 };
    const layer = { document_id: 7, layer_id: 42 };
    const replacement = { ...layer, file_path: 'E:/assets/screen.png' };
    await registry.execute('photoshop_artboard', { action: 'create', width: 400, height: 500 });
    await registry.execute('photoshop_selection', { action: 'rectangle', ...bounds });
    await registry.execute('photoshop_mask', { action: 'create_from_selection', ...layer });
    await registry.execute('photoshop_mask', { action: 'delete', ...layer });
    await registry.execute('photoshop_mask', { action: 'bake_into_layer', ...layer });
    await registry.execute('photoshop_smart_object', { action: 'replace_contents', ...replacement });
    expect(dispatch.mock.calls).toEqual([
      ['photoshop_create_artboard', { width: 400, height: 500 }],
      ['photoshop_select_rectangle', bounds],
      ['photoshop_create_layer_mask', layer],
      ['photoshop_delete_layer_mask', layer],
      ['photoshop_apply_layer_mask', layer],
      ['photoshop_replace_smart_object_contents', replacement],
    ]);
  });

  it('routes layer selection and rasterization individually and merges visible layers by document', async () => {
    const { registry, dispatch } = setup();
    await registry.execute('photoshop_layer', { action: 'select', name: 'Title' });
    await registry.execute('photoshop_layer', { action: 'select', layer_id: 42 });
    await registry.execute('photoshop_layer', { action: 'rasterize', layer_id: 42 });
    await registry.execute('photoshop_layer', { action: 'merge_visible', document_id: 7 });
    const invalid = await registry.execute('photoshop_layer', { action: 'merge_visible', layer_id: 42 });
    expect(invalid.isError).toBe(true);
    expect(dispatch.mock.calls).toEqual([
      ['photoshop_select_layer_by_name', { name: 'Title' }],
      ['photoshop_select_layer_by_name', { layer_id: 42 }],
      ['photoshop_rasterize_layer', { layer_id: 42 }],
      ['photoshop_merge_visible_layers', { document_id: 7 }],
    ]);
  });

  it('rejects selection coordinates on a mask and incomplete artboard and Smart Object inputs', async () => {
    const { registry, dispatch } = setup();
    for (const [name, args] of [
      ['photoshop_mask', { action: 'create_from_selection', left: 10 }],
      ['photoshop_selection', { action: 'create_from_selection' }],
      ['photoshop_artboard', { action: 'create', width: 400 }],
      ['photoshop_smart_object', { action: 'replace_contents', layer_id: 42 }],
    ] as const) {
      expect((await registry.execute(name, args)).isError).toBe(true);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('points prompt instructions and error recovery to the public tool and action', () => {
    expect(describeActionAliases('Call `photoshop_list_documents`.'))
      .toBe('Call photoshop_document (action: "list").');
    const result = updateActionSuggestions({
      isError: true,
      content: [{ type: 'text', text: '{"ok":false,"suggested_next_tool":"photoshop_get_layers"}' }],
    });
    expect(result.content[0]).toEqual({
      type: 'text',
      text: JSON.stringify({
        ok: false,
        suggested_next_tool: 'photoshop_layer',
        suggested_args: { action: 'list' },
      }, null, 2),
    });
  });

  it('routes filters, mixed corner and Bézier paths, and layer layouts using their own parameters', async () => {
    const { registry, dispatch } = setup();
    const path = { subpaths: [[[0, 0], { anchor: [30, 40], rightDirection: [50, 60] }]] };
    await registry.execute('photoshop_filter', { action: 'gaussian_blur', radius: 3, layer_id: 42 });
    await registry.execute('photoshop_path', { action: 'create', ...path });
    await registry.execute('photoshop_layout', { action: 'distribute', layer_names: ['A', 'B', 'C'] });
    expect(dispatch.mock.calls).toEqual([
      ['photoshop_apply_gaussian_blur', { radius: 3, layer_id: 42 }],
      ['photoshop_create_path', path],
      ['photoshop_distribute_layers', { layer_names: ['A', 'B', 'C'] }],
    ]);
  });

  it('rejects incomplete or mismatched filter, path, and layout inputs before dispatch', async () => {
    const { registry, dispatch } = setup();
    for (const [name, args] of [
      ['photoshop_filter', { action: 'motion_blur', radius: 3 }],
      ['photoshop_path', { action: 'create', subpaths: [[{ anchor: [30] }]] }],
      ['photoshop_layout', { action: 'distribute', layer_names: ['A', 'B'] }],
      ['photoshop_layout', { action: 'align', align: 'left', count: 3 }],
    ] as const) {
      expect((await registry.execute(name, args)).isError).toBe(true);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});
