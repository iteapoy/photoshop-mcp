import { PNG } from 'pngjs';

export interface RgbaImage {
  width: number;
  height: number;
  data: Buffer;
}
export const MAX_VERSION_PIXELS = 32_000_000;
export function decodeVersionPng(buffer: Buffer): RgbaImage {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Invalid PNG snapshot');
  const w = buffer.readUInt32BE(16),
    h = buffer.readUInt32BE(20);
  if (!w || !h || w * h > MAX_VERSION_PIXELS)
    throw new Error('Version snapshot exceeds 32 million pixels');
  const image = PNG.sync.read(buffer);
  return { width: image.width, height: image.height, data: image.data };
}
export function encodeVersionPng(image: RgbaImage): Buffer {
  return PNG.sync.write(image as PNG, { colorType: 6, bitDepth: 8 });
}
export interface PixelComparison {
  status: 'compared' | 'first_version' | 'dimensions_changed';
  threshold: number;
  changed_pixels?: number;
  changed_ratio?: number;
  max_channel_delta?: number;
  mean_absolute_channel_delta?: number;
  changed_bounds?: [number, number, number, number] | null;
}
export function compareVersionImages(
  current: RgbaImage,
  previous: RgbaImage | undefined,
  threshold = 0
): { metrics: PixelComparison; difference?: RgbaImage } {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255)
    throw new Error('Invalid parameter: pixel_threshold must be an integer from 0 to 255');
  if (!previous) return { metrics: { status: 'first_version', threshold } };
  if (current.width !== previous.width || current.height !== previous.height)
    return { metrics: { status: 'dimensions_changed', threshold } };
  const data = Buffer.alloc(current.data.length),
    n = current.width * current.height;
  let changed = 0,
    maxDelta = 0,
    totalDelta = 0,
    left = current.width,
    top = current.height,
    right = 0,
    bottom = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4,
      a = current.data[i + 3],
      b = previous.data[i + 3];
    let delta = 0;
    for (let c = 0; c < 4; c++) {
      // RGB beneath zero alpha is not visible. Compare premultiplied RGB plus alpha.
      const d = Math.abs(
        c === 3 ? a - b : (current.data[i + c] * a) / 255 - (previous.data[i + c] * b) / 255
      );
      delta = Math.max(delta, d);
      totalDelta += d;
    }
    maxDelta = Math.max(maxDelta, delta);
    if (delta > threshold) {
      changed++;
      const x = p % current.width,
        y = Math.floor(p / current.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      data[i] = 255;
      data[i + 1] = Math.min(255, Math.round(delta * 4));
      data[i + 3] = 255;
    }
  }
  return {
    metrics: {
      status: 'compared',
      threshold,
      changed_pixels: changed,
      changed_ratio: changed / n,
      max_channel_delta: maxDelta,
      mean_absolute_channel_delta: totalDelta / (n * 4),
      changed_bounds: changed ? [left, top, right, bottom] : null,
    },
    difference: { width: current.width, height: current.height, data },
  };
}
/** Area-average downsampling in premultiplied space preserves fine bright details and transparent edges. */
export function versionThumbnail(image: RgbaImage, maxDimension: number): RgbaImage {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale)),
    height = Math.max(1, Math.round(image.height * scale));
  if (width === image.width && height === image.height)
    return { ...image, data: Buffer.from(image.data) };
  const data = Buffer.alloc(width * height * 4),
    sx = image.width / width,
    sy = image.height / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = x * sx,
        x1 = (x + 1) * sx,
        y0 = y * sy,
        y1 = (y + 1) * sy;
      let alpha = 0,
        red = 0,
        green = 0,
        blue = 0,
        weight = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1) && py < image.height; py++)
        for (let px = Math.floor(x0); px < Math.ceil(x1) && px < image.width; px++) {
          const w =
            (Math.min(x1, px + 1) - Math.max(x0, px)) * (Math.min(y1, py + 1) - Math.max(y0, py));
          const i = (py * image.width + px) * 4,
            a = image.data[i + 3];
          weight += w;
          alpha += a * w;
          red += image.data[i] * a * w;
          green += image.data[i + 1] * a * w;
          blue += image.data[i + 2] * a * w;
        }
      const out = (y * width + x) * 4;
      data[out] = alpha ? Math.round(red / alpha) : 0;
      data[out + 1] = alpha ? Math.round(green / alpha) : 0;
      data[out + 2] = alpha ? Math.round(blue / alpha) : 0;
      data[out + 3] = Math.round(alpha / weight);
    }
  return { width, height, data };
}
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  G: ['01111', '10000', '10111', '10001', '01110'],
  H: ['10001', '10001', '11111', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  R: ['11110', '10001', '11110', '10100', '10010'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
};
export function versionContactSheet(
  current: RgbaImage,
  previous: RgbaImage | undefined,
  difference: RgbaImage | undefined,
  panelSize = 384
): RgbaImage {
  const gap = 12,
    header = 28,
    width = panelSize * 3 + gap * 4,
    height = panelSize + header + gap * 2;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 18;
    data[i + 1] = 19;
    data[i + 2] = 23;
    data[i + 3] = 255;
  }
  function label(text: string, x: number, y: number) {
    for (const ch of text) {
      const glyph = GLYPHS[ch];
      if (glyph)
        for (let yy = 0; yy < glyph.length; yy++)
          for (let xx = 0; xx < 5; xx++)
            if (glyph[yy][xx] === '1')
              for (let dy = 0; dy < 2; dy++)
                for (let dx = 0; dx < 2; dx++) {
                  const i = ((y + yy * 2 + dy) * width + x + xx * 2 + dx) * 4;
                  data[i] = 220;
                  data[i + 1] = 223;
                  data[i + 2] = 230;
                }
      x += 12;
    }
  }
  const images = [previous, current, difference],
    names = ['BEFORE', 'CURRENT', 'DIFFERENCE'];
  images.forEach((image, panel) => {
    const x0 = gap + (panelSize + gap) * panel;
    label(names[panel], x0, gap);
    if (!image) {
      label(panel === 0 ? 'NO BASELINE' : 'NOT COMPARED', x0 + 12, header + gap + panelSize / 2);
      return;
    }
    const thumb = versionThumbnail(image, panelSize),
      ox = x0 + Math.floor((panelSize - thumb.width) / 2),
      oy = header + gap + Math.floor((panelSize - thumb.height) / 2);
    for (let y = 0; y < thumb.height; y++)
      for (let x = 0; x < thumb.width; x++) {
        const s = (y * thumb.width + x) * 4,
          d = ((oy + y) * width + ox + x) * 4,
          a = thumb.data[s + 3] / 255;
        const matte = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 32 : 42;
        for (let c = 0; c < 3; c++)
          data[d + c] = Math.round(thumb.data[s + c] * a + matte * (1 - a));
      }
  });
  return { width, height, data };
}
