import { describe, expect, it } from 'vitest';
import { shapeScript } from '../src/tools/shape-tools.js';

describe('shape parameters', () => {
  const base = { type: 'rectangle', left: 0, top: 0, right: 100, bottom: 80 };
  it('rejects invalid geometry and colors before executing Photoshop', () => {
    expect(() => shapeScript({ ...base, right: 0 })).toThrow();
    expect(() => shapeScript({ ...base, red: 256 })).toThrow();
    expect(() => shapeScript({ ...base, dash_pattern: [4] })).toThrow();
    expect(() => shapeScript({ ...base, dash_pattern: [4, 0] })).toThrow();
    expect(() => shapeScript({ ...base, fill_enabled: false })).toThrow();
    expect(() => shapeScript({ ...base, stroke_alignment: 'bad' })).toThrow();
    expect(() => shapeScript({ ...base, opacity: NaN })).toThrow();
    expect(() => shapeScript({ ...base, type: 'line', right: 0, bottom: 0 })).toThrow();
  });
  it('accepts reversed line endpoints and valid shape variants', () => {
    for (const type of ['rectangle', 'rounded_rectangle', 'ellipse', 'line']) {
      expect(() => shapeScript({ ...base, type })).not.toThrow();
    }
    expect(() => shapeScript({ ...base, type: 'line', right: -100 })).not.toThrow();
  });
});
