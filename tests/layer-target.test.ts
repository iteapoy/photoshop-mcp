import { describe, expect, it } from 'vitest';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { parsePreviewScriptPayload } from '../src/apps/preview-result.js';

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
