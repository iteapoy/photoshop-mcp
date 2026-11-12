import { describe, expect, it } from 'vitest';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { anchorFractions, PLACE_ANCHOR_ENUM } from '../src/tools/image-placement-tools.js';

describe('place_image anchors', () => {
  it('maps every advertised anchor to its fractions', () => {
    expect(anchorFractions('top_left')).toEqual({ x: 0, y: 0 });
    expect(anchorFractions('center')).toEqual({ x: 0.5, y: 0.5 });
    expect(anchorFractions('bottom_right')).toEqual({ x: 1, y: 1 });
    expect(anchorFractions('center_left')).toEqual({ x: 0, y: 0.5 });
    expect(PLACE_ANCHOR_ENUM).toHaveLength(9);
  });

  it('tolerates sloppy names and falls back to top-left', () => {
    expect(anchorFractions(' Bottom-Right ')).toEqual({ x: 1, y: 1 });
    expect(anchorFractions('TOP CENTER')).toEqual({ x: 0.5, y: 0 });
    expect(anchorFractions(undefined)).toEqual({ x: 0, y: 0 });
    expect(anchorFractions('nope')).toEqual({ x: 0, y: 0 });
  });
});

describe('place_image ExtendScript', () => {
  const jsx = ExtendScriptSnippets.placeImage('/tmp/a.png', 740, 0, {
    anchorX: 0.5,
    anchorY: 0.5,
    scalePercent: 50,
    fitToCanvas: false,
    rasterize: true,
  });

  it('measures the source before placing so transparent trim does not shift it', () => {
    expect(jsx).toContain('app.open(imageFile)');
    expect(jsx).toContain('trimL');
    expect(jsx).toContain('probe.close(SaveOptions.DONOTSAVECHANGES)');
    expect(jsx).toContain('function __mcp_imageRect()');
    expect(jsx).toContain('vL - (trimL / srcW) * imgW');
  });

  it('carries anchor, scale and rasterize options through', () => {
    expect(jsx).toContain('var anchorX = 0.5;');
    expect(jsx).toContain('var anchorY = 0.5;');
    expect(jsx).toContain('var scalePercent = 50;');
    expect(jsx).toContain('var rasterizeLayer = true;');
    expect(jsx).toContain('layer.resize(ratio * 100, ratio * 100, AnchorPosition.TOPLEFT)');
    expect(jsx).toContain('semantics: ');
  });

  it('self-calibrates whether Place reported trimmed bounds', () => {
    expect(jsx).toContain("var boundsMode = 'untrimmed';");
    expect(jsx).toContain("boundsMode = 'trim_compensated';");
    expect(jsx).toContain('var expectedW = srcW * fitScale;');
    expect(jsx).toContain('boundsMode: boundsMode');
  });

  it('self-calibrates whether Place reported trimmed bounds', () => {
    expect(jsx).toContain("var boundsMode = 'untrimmed';");
    expect(jsx).toContain("boundsMode = 'trim_compensated';");
    expect(jsx).toContain('var expectedW = srcW * fitScale;');
    expect(jsx).toContain('boundsMode: boundsMode');
  });

  it('defaults to native pixels at the top-left', () => {
    const plain = ExtendScriptSnippets.placeImage('/tmp/a.png', 0, 0);
    expect(plain).toContain('var anchorX = 0;');
    expect(plain).toContain('var anchorY = 0;');
    expect(plain).toContain('var scalePercent = 100;');
    expect(plain).toContain('var fitToCanvas = false;');
    expect(plain).toContain('var rasterizeLayer = false;');
  });

  it('is valid JavaScript (compiles in a function body)', () => {
    expect(() => new Function(jsx)).not.toThrow();
  });
});
