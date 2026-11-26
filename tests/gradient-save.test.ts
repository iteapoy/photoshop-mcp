import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PhotoshopAPIFactory } from '../src/api/photoshop-api.js';
import { createDocumentTools } from '../src/tools/document-tools.js';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { parseGradientArgs } from '../src/api/gradient.js';
import { documentSaveScript } from '../src/api/document-save.js';

const basic = {
  from: { x: 0, y: 10 },
  to: { x: 100, y: 60 },
  color_stops: [
    { position: 0, red: 255, green: 0, blue: 0 },
    { position: 0.4, red: 0, green: 255, blue: 0 },
    { position: 1, red: 0, green: 0, blue: 255 },
  ],
  opacity_stops: [
    { position: 0, opacity: 100 },
    { position: 0.7, opacity: 40 },
    { position: 1, opacity: 0 },
  ],
};
describe('multi-stop gradients', () => {
  it.each([
    { ...basic, to: basic.from },
    { ...basic, type: 'unsupported' },
    { ...basic, dither: 'yes' },
    { ...basic, color_stops: [basic.color_stops[1], basic.color_stops[2]] },
    {
      ...basic,
      color_stops: [
        basic.color_stops[0],
        { ...basic.color_stops[1], position: 0.00001 },
        basic.color_stops[2],
      ],
    },
    {
      ...basic,
      color_stops: [
        basic.color_stops[0],
        { ...basic.color_stops[1], red: NaN },
        basic.color_stops[2],
      ],
    },
    {
      ...basic,
      opacity_stops: [
        { position: 0, opacity: 101 },
        { position: 1, opacity: 0 },
      ],
    },
    { ...basic, opacity_stops: null },
    { ...basic, fromRed: 1 },
  ])('rejects malformed parameters before Photoshop: %j', (args) =>
    expect(() => parseGradientArgs(args)).toThrow('Invalid parameter')
  );
  it.each(['linear', 'radial', 'reflected'])(
    'emits %s geometry, all colors, opacity and precise canvas coordinates',
    (type) => {
      class Descriptor {
        values: Record<string, any> = {};
        putUnitDouble(k: string, _u: string, v: number) {
          this.values[k] = v;
        }
        putDouble(k: string, v: number) {
          this.values[k] = v;
        }
        putInteger(k: string, v: number) {
          this.values[k] = v;
        }
        putString(k: string, v: string) {
          this.values[k] = v;
        }
        putBoolean(k: string, v: boolean) {
          this.values[k] = v;
        }
        putEnumerated(k: string, _t: string, v: string) {
          this.values[k] = v;
        }
        putObject(k: string, _t: string, v: Descriptor) {
          this.values[k] = v.values;
        }
        putList(k: string, v: List) {
          this.values[k] = v.values;
        }
      }
      class List {
        values: any[] = [];
        putObject(_k: string, d: Descriptor) {
          this.values.push(d.values);
        }
      }
      const layer = {
        id: 2,
        name: 'target',
        typename: 'ArtLayer',
        kind: 'normal',
        allLocked: false,
      };
      const doc = {
        layers: [layer],
        activeLayer: layer,
        selection: { bounds: [0, 5, 90, 95].map((v) => ({ as: () => v })) },
      };
      let painted: any;
      const result = new Function(
        'app',
        'LayerKind',
        'ActionDescriptor',
        'ActionList',
        'executeAction',
        'DialogModes',
        ExtendScriptSnippets.fillGradient(
          parseGradientArgs({ ...basic, type, dither: false }),
          'target'
        )
      )(
        { documents: [doc], activeDocument: doc, charIDToTypeID: (s: string) => s },
        { NORMAL: 'normal' },
        Descriptor,
        List,
        (_id: string, d: Descriptor) => {
          painted = d.values;
        },
        { NO: 0 }
      );
      expect(painted.Type).toBe(
        ({ linear: 'Lnr ', radial: 'Rdl ', reflected: 'Rflc' } as any)[type]
      );
      expect(painted.From).toEqual({ Hrzn: 0, Vrtc: 10 });
      expect(painted['T   ']).toEqual({ Hrzn: 100, Vrtc: 60 });
      expect(painted.Grad.Clrs.map((s: any) => s.Lctn)).toEqual([0, 1638, 4096]);
      expect(painted.Grad.Clrs[1]['Clr ']).toEqual({ 'Rd  ': 0, 'Grn ': 255, 'Bl  ': 0 });
      expect(painted.Grad.Trns.map((s: any) => s.Opct)).toEqual([100, 40, 0]);
      expect(painted.UsMs).toBe(true);
      expect(painted.Dthr).toBe(false);
      expect(result.selection_bounds).toEqual([0, 5, 90, 95]);
    }
  );
});
describe('document saving semantics', () => {
  function fixture(layers = 1, exists = true) {
    const calls: any[] = [];
    let fullName: any = null;
    const doc = {
      id: 9,
      name: 'Untitled',
      saved: false,
      layers: Array.from({ length: layers }, () => ({})),
      activeLayer: { typename: 'ArtLayer' },
      get fullName() {
        if (!fullName) throw Error('not saved');
        return fullName;
      },
      saveAs(file: any, options: any, copy: boolean) {
        calls.push({ file, options, copy });
        if (!copy) {
          fullName = file;
          this.name = 'bound.psd';
          this.saved = true;
        }
      },
    };
    class File {
      fsName: string;
      exists = exists;
      constructor(path: string) {
        this.fsName = path;
      }
    }
    const run = (format: 'PSD' | 'JPEG' | 'PNG', copy: boolean) =>
      new Function(
        'app',
        'File',
        'PhotoshopSaveOptions',
        'JPEGSaveOptions',
        'PNGSaveOptions',
        'Extension',
        documentSaveScript({
          path: '/tmp/a "quoted" file.' + (format === 'JPEG' ? 'jpg' : format.toLowerCase()),
          format,
          quality: 9,
          as_copy: copy,
        })
      )(
        { documents: [doc], activeDocument: doc },
        File,
        function () {},
        function () {},
        function () {},
        { LOWERCASE: 0 }
      );
    return { doc, calls, run };
  }
  it('normal PSD saving binds the document and clears dirty state while retaining layers', () => {
    const { run, calls, doc } = fixture(3);
    const result = run('PSD', false);
    expect(calls[0].copy).toBe(false);
    expect(calls[0].options.layers).toBe(true);
    expect(result.document).toMatchObject({ saved: true, name: 'bound.psd' });
    expect(doc.layers).toHaveLength(3);
  });
  it.each(['PSD', 'PNG', 'JPEG'] as const)(
    'copy saving %s preserves unsaved source path and dirty state',
    (format) => {
      const { run, doc, calls } = fixture(3);
      const result = run(format, true);
      expect(calls[0].copy).toBe(true);
      expect(doc.saved).toBe(false);
      expect(doc.name).toBe('Untitled');
      expect(result.document.path).toBeNull();
      expect(result.as_copy).toBe(true);
    }
  );
  it.each(['PNG', 'JPEG'] as const)('refuses normal layered %s saving before writing', (format) => {
    const { run, calls } = fixture(2);
    expect(() => run(format, false)).toThrow('layered documents require PSD');
    expect(calls).toEqual([]);
  });
  it('reports a missing output instead of claiming success', () => {
    expect(() => fixture(1, false).run('PSD', false)).toThrow('did not create');
  });
});

describe('save path aliases', () => {
  it('accepts a canonical document path when the requested save directory is a symlink', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ps-save-alias-')),
      real = join(root, 'real'),
      alias = join(root, 'alias');
    mkdirSync(real);
    symlinkSync(real, alias, 'junction');
    const requested = join(alias, 'document.psd');
    const api = vi.spyOn(PhotoshopAPIFactory.prototype, 'createAPI').mockResolvedValue({
      getAPIType: () => 'ExtendScript',
      executeScript: async () => {
        writeFileSync(requested, 'PSD placeholder');
        return {
          path: requested,
          format: 'PSD',
          as_copy: false,
          document: { id: 1, name: 'document.psd', path: realpathSync(requested), saved: true },
        };
      },
    });
    try {
      const tool = createDocumentTools({} as never).find(
        (t) => t.tool.name === 'photoshop_save_document'
      )!;
      const result = await tool.handler({ path: requested, format: 'PSD' });
      expect(result.isError).not.toBe(true);
      const body = JSON.parse((result.content[0] as { text: string }).text);
      expect(body.details.path).toBe(realpathSync(requested));
    } finally {
      api.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
