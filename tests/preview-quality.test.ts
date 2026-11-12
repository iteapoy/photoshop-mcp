import { describe, expect, it } from 'vitest';

import { resolveJpegQuality } from '../src/tools/state-tools.js';

describe('resolveJpegQuality', () => {
  it('maps the legacy 1–12 scale onto JPEG kval', () => {
    expect(resolveJpegQuality(8)).toBe(8);
    expect(resolveJpegQuality(12)).toBe(12);
    expect(resolveJpegQuality(1)).toBe(1);
  });

  it('accepts 0–100 percentages', () => {
    expect(resolveJpegQuality(100)).toBe(12);
    expect(resolveJpegQuality(50)).toBe(7);
    expect(resolveJpegQuality(0)).toBe(1);
  });

  it('clamps out-of-range values instead of trusting them', () => {
    expect(resolveJpegQuality(1_000)).toBe(12);
    expect(resolveJpegQuality(-20)).toBe(1);
  });

  it('keeps the historical default size when no quality is given', () => {
    // 64% round-trips to JPEG quality 8, the pre-change default.
    expect(resolveJpegQuality(undefined)).toBe(8);
    expect(resolveJpegQuality('high')).toBe(8);
  });
});
