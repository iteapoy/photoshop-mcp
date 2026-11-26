import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotoshopAPIFactory } from '../src/api/photoshop-api.js';
import {
  compareVersionImages,
  decodeVersionPng,
  encodeVersionPng,
  versionThumbnail,
  versionContactSheet,
  type RgbaImage,
} from '../src/lib/version-images.js';
import { VERSION_DOCUMENT_INFO_SCRIPT, versionCaptureScript } from '../src/api/version-capture.js';
import { verifyVersion } from '../src/tools/recipes/verify-version.js';
const image = (width: number, height: number, pixels?: number[]): RgbaImage => ({
  width,
  height,
  data: pixels ? Buffer.from(pixels) : Buffer.alloc(width * height * 4, 255),
});
const body = (result: any) => JSON.parse(result.content.find((c: any) => c.type === 'text').text);

describe('visible pixel verification', () => {
  it('ignores hidden RGB while comparing alpha and premultiplied visible color', () => {
    expect(
      compareVersionImages(image(1, 1, [255, 0, 0, 0]), image(1, 1, [0, 255, 0, 0])).metrics
        .changed_pixels
    ).toBe(0);
    expect(
      compareVersionImages(image(1, 1, [0, 0, 0, 255]), image(1, 1, [0, 0, 0, 0])).metrics
        .changed_pixels
    ).toBe(1);
  });
  it('reports exact changed pixels, exclusive bounds and threshold', () => {
    const a = image(3, 2),
      b = image(3, 2);
    a.data[(1 * 3 + 2) * 4] = 240;
    const { metrics, difference } = compareVersionImages(a, b);
    expect(metrics).toMatchObject({
      status: 'compared',
      changed_pixels: 1,
      changed_ratio: 1 / 6,
      max_channel_delta: 15,
      changed_bounds: [2, 1, 3, 2],
    });
    expect(compareVersionImages(a, b, 15).metrics.changed_pixels).toBe(0);
    expect(decodeVersionPng(encodeVersionPng(difference!)).width).toBe(3);
  });
  it('distinguishes the first baseline from changed dimensions', () => {
    expect(compareVersionImages(image(2, 2), undefined).metrics.status).toBe('first_version');
    expect(compareVersionImages(image(2, 2), image(3, 2)).metrics.status).toBe(
      'dimensions_changed'
    );
  });
  it('downsamples bright details and transparent edges without colored halos', () => {
    expect([...versionThumbnail(image(2, 1, [255, 0, 0, 255, 0, 255, 0, 0]), 1).data]).toEqual([
      255, 0, 0, 128,
    ]);
    const pixels = [255, 255, 255, 255, ...Array.from({ length: 3 }, () => [0, 0, 0, 255]).flat()];
    expect([...versionThumbnail(image(2, 2, pixels), 1).data]).toEqual([64, 64, 64, 255]);
    expect(versionContactSheet(image(2, 2), undefined, undefined).width).toBe(1200);
  });
  it('rejects invalid PNGs and excessive dimensions before decoding', () => {
    expect(() => decodeVersionPng(Buffer.alloc(24))).toThrow('Invalid PNG');
    const buffer = encodeVersionPng(image(1, 1));
    buffer.writeUInt32BE(50000, 16);
    buffer.writeUInt32BE(50000, 20);
    expect(() => decodeVersionPng(buffer)).toThrow('32 million');
  });
});
describe('one-call version workflow', () => {
  let home: string, previousHome: string | undefined, pixels: RgbaImage, failCapture: boolean;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ps-version-'));
    previousHome = process.env.PHOTOSHOP_MCP_HOME;
    process.env.PHOTOSHOP_MCP_HOME = home;
    pixels = image(4, 3);
    failCapture = false;
    vi.spyOn(PhotoshopAPIFactory.prototype, 'createAPI').mockResolvedValue({
      getAPIType: () => 'ExtendScript',
      executeScript: async (script: string) => {
        const document = {
          id: 73,
          name: 'Unsaved',
          path: null,
          saved: false,
          width: pixels.width,
          height: pixels.height,
        };
        if (script === VERSION_DOCUMENT_INFO_SCRIPT) return document;
        const png = JSON.parse(script.match(/copy.saveAs\(new File\(("(?:[^"\\]|\\.)*")\)/)![1]);
        writeFileSync(png, encodeVersionPng(pixels));
        if (failCapture) throw new Error('injected capture failure');
        const psd = script.match(/source.saveAs\(new File\(("(?:[^"\\]|\\.)*")\)/);
        if (psd) writeFileSync(JSON.parse(psd[1]), 'layered PSD placeholder');
        return {
          document,
          render: { width: pixels.width, height: pixels.height, color_space: 'sRGB', bit_depth: 8 },
        };
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.PHOTOSHOP_MCP_HOME;
    else process.env.PHOTOSHOP_MCP_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  const run = (args: Record<string, unknown> = {}) =>
    verifyVersion({} as never, { series: 'artwork', ...args });
  it('creates a baseline, compares unchanged and edited frames, and detects resizing', async () => {
    const first = body(await run());
    expect(first.comparison.status).toBe('first_version');
    expect(existsSync(first.artifacts.psd)).toBe(true);
    const second = body(await run());
    expect(second.comparison.changed_pixels).toBe(0);
    expect(second.previous_version_id).toBe(first.version_id);
    pixels.data[0] = 0;
    const third = body(await run({ label: 'edit' }));
    expect(third.comparison.changed_pixels).toBe(1);
    expect(third.comparison.changed_bounds).toEqual([0, 0, 1, 1]);
    expect(decodeVersionPng(readFileSync(third.artifacts.comparison)).width).toBe(1200);
    expect(JSON.parse(readFileSync(third.artifacts.report, 'utf8')).comparison.changed_pixels).toBe(
      1
    );
    pixels = image(2, 2);
    const resized = body(await run({ save_psd: false }));
    expect(resized.comparison.status).toBe('dimensions_changed');
    expect(resized.artifacts.difference).toBeUndefined();
    expect(resized.artifacts.psd).toBeUndefined();
  });
  it('does not advance the baseline on failure, removes partial files, and releases the series lock', async () => {
    const first = body(await run());
    const dir = join(home, 'exports', 'versions', 'artwork'),
      latest = readFileSync(join(dir, 'latest.json'), 'utf8');
    failCapture = true;
    const failed = await run();
    expect(failed.isError).toBe(true);
    expect(body(failed).verification_stage).toBe('capture');
    expect(readFileSync(join(dir, 'latest.json'), 'utf8')).toBe(latest);
    expect(readdirSync(dir).sort()).toEqual([first.version_id, 'latest.json'].sort());
    failCapture = false;
    expect(body(await run()).comparison.changed_pixels).toBe(0);
  });
  it('rejects an occupied series without removing another verification lock', async () => {
    const first = body(await run());
    const lock = join(home, 'exports', 'versions', 'artwork', '.lock');
    writeFileSync(lock, 'another verification');
    const failed = await run();
    expect(failed.isError).toBe(true);
    expect(body(failed).verification_stage).toBe('series_lock');
    expect(existsSync(lock)).toBe(true);
    const latest = JSON.parse(
      readFileSync(join(home, 'exports', 'versions', 'artwork', 'latest.json'), 'utf8')
    );
    expect(latest.version_id).toBe(first.version_id);
    rmSync(lock);
  });

  it('rejects invalid input before communicating with Photoshop', async () => {
    expect((await run({ series: '../escape' })).isError).toBe(true);
    expect((await run({ pixel_threshold: -1 })).isError).toBe(true);
    expect(PhotoshopAPIFactory.prototype.createAPI).not.toHaveBeenCalled();
  });
});
describe('native capture cleanup', () => {
  it('restores the source tab and closes a temporary render when profile conversion fails', () => {
    let closed = false,
      copies = 0;
    const source: any = {
      id: 7,
      name: 'source',
      saved: false,
      width: { as: () => 32 },
      height: { as: () => 32 },
      mode: 'RGB',
      bitsPerChannel: 8,
      get fullName() {
        throw Error('unsaved');
      },
      saveAs(_file: any, _options: any, copy: boolean) {
        expect(copy).toBe(true);
        copies++;
      },
      duplicate() {
        return {
          colorProfileName: 'other',
          convertProfile() {
            throw Error('profile failure');
          },
          close() {
            closed = true;
          },
        };
      },
    };
    const app = { documents: [source], activeDocument: source };
    expect(() =>
      new Function(
        'app',
        'DocumentMode',
        'BitsPerChannelType',
        'PhotoshopSaveOptions',
        'File',
        'Extension',
        'SaveOptions',
        'Intent',
        versionCaptureScript(7, '/tmp/render.png', '/tmp/copy.psd')
      )(
        app,
        { RGB: 'RGB' },
        { THIRTYTWO: 32 },
        function () {},
        function () {},
        { LOWERCASE: 0 },
        { DONOTSAVECHANGES: 0 },
        { RELATIVECOLORIMETRIC: 0 }
      )
    ).toThrow('profile failure');
    expect(closed).toBe(true);
    expect(copies).toBe(1);
    expect(app.activeDocument).toBe(source);
    expect(source.saved).toBe(false);
  });
});
