import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { parsePreviewScriptPayload } from '../src/apps/preview-result.js';
import { createLayerTransformTools } from '../src/tools/layer-transform-tools.js';
import { createLayerOrderingTools } from '../src/tools/layer-ordering-tools.js';
import { createLayerPropertiesTools } from '../src/tools/layer-properties-tools.js';
import { createStyleTools } from '../src/tools/style-tools.js';

describe('layer targeting without selecting first', () => {
  it('resolves the layer by name for visibility', () => {
    const jsx = ExtendScriptSnippets.setLayerVisibility(false, 'Layer 2');
    expect(jsx).toContain('__mcp_resolveLayer(doc, "Layer 2", 0)');
    expect(jsx).toContain('layer.visible = false;');
    expect(jsx).not.toContain('doc.activeLayer =');
  });

  it('resolves the layer by name for opacity', () => {
    const jsx = ExtendScriptSnippets.setLayerOpacity(40, 'Guides');
    expect(jsx).toContain('__mcp_resolveLayer(doc, "Guides", 0)');
    expect(jsx).toContain('layer.opacity = 40;');
  });

  it('renames the named layer and reports the previous name', () => {
    const jsx = ExtendScriptSnippets.renameLayer('New Name', 'Old Name');
    expect(jsx).toContain('__mcp_resolveLayer(doc, "Old Name", 0)');
    expect(jsx).toContain('layer.name = "New Name";');
    expect(jsx).toContain('oldName: oldName');
  });

  it('deletes the named layer', () => {
    const jsx = ExtendScriptSnippets.deleteLayer('Layer 3');
    expect(jsx).toContain('__mcp_resolveLayer(doc, "Layer 3", 0)');
    expect(jsx).toContain('layer.remove();');
    expect(jsx).toContain('deletedName');
  });

  it('falls back to the active layer when no name is given', () => {
    const jsx = ExtendScriptSnippets.setLayerVisibility(true);
    expect(jsx).toContain('__mcp_resolveLayer(doc, "", 0)');
    expect(jsx).toContain("if (!doc.activeLayer) throw new Error('No active layer')");
  });

  it('throws a typed error when the name does not exist', () => {
    const jsx = ExtendScriptSnippets.setLayerLocked(true, 'missing');
    expect(jsx).toContain('layer_not_found');
    expect(() => new Function(jsx)).not.toThrow();
  });
});

describe('single-layer preview', () => {
  const jsx = ExtendScriptSnippets.exportPreview(500, 8, 'Sketch');

  it('solos the layer in the duplicate and trims to its content', () => {
    expect(jsx).toContain('__mcp_soloLayer(dup, targetLayerName)');
    expect(jsx).toContain('var targetLayerName = "Sketch";');
    expect(jsx).toContain('dup.trim(TrimType.TRANSPARENT)');
    expect(jsx).toContain('cropped = true');
    expect(jsx).toContain('payload.layerName = targetLayerName');
  });

  it('keeps the document preview path untouched when no layer is named', () => {
    const full = ExtendScriptSnippets.exportPreview(500, 8);
    expect(full).toContain('var targetLayerName = "";');
    expect(full).toContain('if (targetLayerName) {');
    expect(full).toContain('var cropped = false;');
    expect(() => new Function(full)).not.toThrow();
  });

  it('compiles', () => {
    expect(() => new Function(jsx)).not.toThrow();
  });

  it('parses layer metadata back out of the script payload', () => {
    const parsed = parsePreviewScriptPayload({
      path: '/tmp/x.jpg',
      width: 400,
      height: 300,
      mimeType: 'image/jpeg',
      documentName: 'doc.psd',
      documentWidth: 2000,
      documentHeight: 2276,
      colorMode: 'RGB',
      layers: ['a'],
      layerName: 'Sketch',
      sourceWidth: 1980,
      sourceHeight: 1600,
      cropped: true,
      layerBounds: { left: 10, top: 200, width: 1980, height: 1600 },
    });
    expect(parsed?.layerName).toBe('Sketch');
    expect(parsed?.cropped).toBe(true);
    expect(parsed?.layerBounds).toEqual({ left: 10, top: 200, width: 1980, height: 1600 });
  });

  it('leaves layer fields undefined for a full-document preview', () => {
    const parsed = parsePreviewScriptPayload({
      path: '/tmp/x.jpg',
      width: 400,
      height: 300,
      layers: ['a'],
    });
    expect(parsed?.layerName).toBeUndefined();
    expect(parsed?.cropped).toBe(false);
  });
});

describe('single-layer tools advertise layer_name', () => {
  const connection = null as never;
  const tools = [
    ...createLayerTransformTools(connection),
    ...createLayerOrderingTools(connection),
    ...createLayerPropertiesTools(connection),
    ...createStyleTools(connection),
  ];
  const schemas = new Map(tools.map((t) => [t.tool.name, t.tool.inputSchema]));

  const SINGLE_LAYER_TOOLS = [
    'photoshop_fit_layer_to_document',
    'photoshop_scale_layer',
    'photoshop_move_layer',
    'photoshop_rotate_layer',
    'photoshop_reorder_layer',
    'photoshop_rasterize_layer',
    'photoshop_duplicate_layer',
    'photoshop_apply_layer_style',
  ];

  it.each(SINGLE_LAYER_TOOLS)('%s takes an optional layer_name', (name) => {
    const schema = schemas.get(name) as
      { properties?: Record<string, { type?: string }>; required?: string[] } | undefined;
    expect(schema, `${name} is not registered`).toBeDefined();
    expect(schema?.properties?.layer_name?.type).toBe('string');
    // Never required: omitting it keeps the old "act on the active layer" path.
    expect(schema?.required ?? []).not.toContain('layer_name');
  });
});

describe('transforms and stacking resolve the layer by name', () => {
  const cases: Array<[string, string]> = [
    ['fit_layer_to_document', ExtendScriptSnippets.fitLayerToDocument(false, 'Rail')],
    ['scale_layer', ExtendScriptSnippets.scaleLayer(50, true, 'Rail')],
    ['move_layer', ExtendScriptSnippets.moveLayer(10, -20, 'Rail')],
    ['rotate_layer', ExtendScriptSnippets.rotateLayer(15, 'Rail')],
    ['move_layer_to_position', ExtendScriptSnippets.moveLayerToPosition('Base', 'ABOVE', 'Rail')],
    ['move_layer_to_top', ExtendScriptSnippets.moveLayerToTop('Rail')],
    ['move_layer_to_bottom', ExtendScriptSnippets.moveLayerToBottom('Rail')],
    ['move_layer_up', ExtendScriptSnippets.moveLayerUp('Rail')],
    ['move_layer_down', ExtendScriptSnippets.moveLayerDown('Rail')],
    ['rasterize_layer', ExtendScriptSnippets.rasterizeLayer('Rail')],
    ['duplicate_layer', ExtendScriptSnippets.duplicateLayer(undefined, 'Rail')],
    [
      'apply_layer_style',
      ExtendScriptSnippets.applyLayerStyle({
        style: 'drop_shadow',
        red: 0,
        green: 0,
        blue: 0,
        opacity: 60,
        size: 10,
        distance: 8,
        angle: 120,
        layerName: 'Rail',
      }),
    ],
  ];

  it.each(cases)('%s addresses "Rail" without selecting it first', (_label, jsx) => {
    expect(jsx).toContain('__mcp_resolveLayer(doc, "Rail", 0)');
    expect(() => new Function(jsx)).not.toThrow();
  });

  it('falls back to the active layer when no name is given', () => {
    for (const jsx of [
      ExtendScriptSnippets.scaleLayer(50),
      ExtendScriptSnippets.moveLayer(1, 1),
      ExtendScriptSnippets.rotateLayer(5),
      ExtendScriptSnippets.fitLayerToDocument(true),
      ExtendScriptSnippets.rasterizeLayer(),
      ExtendScriptSnippets.duplicateLayer(),
      ExtendScriptSnippets.moveLayerUp(),
    ]) {
      expect(jsx).toContain('__mcp_resolveLayer(doc, "", 0)');
    }
  });

  it('reorders inside the layer own group, not the whole document', () => {
    for (const jsx of [
      ExtendScriptSnippets.moveLayerUp('Rail'),
      ExtendScriptSnippets.moveLayerDown('Rail'),
    ]) {
      expect(jsx).toContain('__mcp_parentOf(doc, layer)');
      expect(jsx).toContain('__mcp_siblingIndex(parent, layer)');
    }
  });
});

describe('get_layers payload', () => {
  it('returns plain JSON with no text prefix', () => {
    const src = readFileSync(new URL('../src/tools/layer-tools.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('Layers:\\n');
    expect(src).toContain('JSON.stringify(result, null, 2)');
  });
});
