import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { PhotoshopAPIFactory } from '../src/api/photoshop-api.js';
import { createTextTools } from '../src/tools/text-tools.js';
import { createColorAdjustmentTools } from '../src/tools/color-adjustment-tools.js';
import { createAdjustmentTools } from '../src/tools/adjustment-tools.js';
import { createGroupTools, groupScript } from '../src/tools/group-tools.js';
import { createLayerOrderingTools, reorderLayerScript } from '../src/tools/layer-ordering-tools.js';
import { layerGuardScript, withOptionalLayerId } from '../src/core/layer-target.js';
import { buildGroupedTools, resolveAction } from '../scripts/tool-groups.mjs';

const removed = [
  'photoshop_create_black_and_white_adjustment_layer',
  'photoshop_create_posterize_adjustment_layer',
  'photoshop_create_threshold_adjustment_layer',
  'photoshop_adjust_exposure',
  'photoshop_adjust_vibrance',
  'photoshop_adjust_curves',
  'photoshop_apply_photo_filter',
  'photoshop_apply_lut',
  'photoshop_apply_gradient_map',
  'photoshop_set_text_font',
  'photoshop_set_text_color',
  'photoshop_set_text_alignment',
  'photoshop_move_layer_to_position',
  'photoshop_move_layer_to_top',
  'photoshop_move_layer_to_bottom',
  'photoshop_move_layer_up',
  'photoshop_move_layer_down',
  'photoshop_group_layers',
];
const connection = {} as never;
const definitions = [
  ...createTextTools(connection),
  ...createColorAdjustmentTools(connection),
  ...createAdjustmentTools(connection),
  ...createGroupTools(connection),
  ...createLayerOrderingTools(connection),
];
afterEach(() => vi.restoreAllMocks());

describe('canonical-only discovery', () => {
  it('removes the 18 old entries from registration and execution', async () => {
    const registry = new ToolRegistry();
    for (const def of definitions) registry.register(def.tool.name, def);
    const listed = registry.list().map((t) => t.name);
    for (const name of removed) {
      expect(listed).not.toContain(name);
      expect(registry.get(name)).toBeUndefined();
      await expect(registry.execute(name, {})).rejects.toThrow('Tool not found');
    }
    for (const name of [
      'create_adjustment_layer',
      'set_text_style',
      'reorder_layer',
      'create_group',
    ]) {
      expect(listed).toContain('photoshop_' + name);
    }
    expect(registry.count()).toBe(listed.length);
  });
  it('exposes canonical HTTP actions and rejects old schemas and action names', () => {
    const tools = definitions.map((d) => d.tool);
    const surface = buildGroupedTools(tools, { rawTool: true, overrides: {} });
    const advertised = [...surface.index.values()].flatMap((actions) =>
      [...actions.values()].map((t) => t.name)
    );
    for (const name of removed) {
      expect(advertised).not.toContain(name);
      expect(resolveAction(tools, name)).toBeNull();
    }
    expect(resolveAction(tools, 'layer/group_layers')).toBeNull();
    expect(surface.index.get('photoshop_layer')?.has('reorder_layer')).toBe(true);
  });
});

describe('unified layer ordering', () => {
  function fixture() {
    const doc = {
      typename: 'Document',
      layers: [] as any[],
      layerSets: [] as any[],
      activeLayer: undefined as any,
    };
    function layer(id: number, name: string, parent: any) {
      return { id, name, typename: 'ArtLayer', parent, visible: true, move: vi.fn() };
    }
    const group = {
      id: 10,
      name: 'group',
      typename: 'LayerSet',
      parent: doc,
      layers: [] as any[],
      layerSets: [],
    };
    const source = layer(2, 'source', group);
    const top = layer(1, 'DUP', group);
    const bottom = layer(3, 'DUP', group);
    group.layers = [top, source, bottom];
    doc.layers = [layer(4, 'DUP', doc), group];
    doc.layerSets = [group];
    doc.activeLayer = source;
    return { doc, group, source, top, bottom };
  }
  it.each(['up', 'down', 'top', 'bottom', 'above', 'below'])(
    'executes %s with exact ID targets in nested groups',
    (position) => {
      const { doc, source, top, bottom } = fixture();
      const script =
        layerGuardScript(source.id) +
        reorderLayerScript({
          position,
          ...(['above', 'below'].includes(position) ? { target_layer_id: bottom.id } : {}),
        });
      const result = new Function('app', 'ElementPlacement', script)(
        { documents: [doc], activeDocument: doc },
        {
          PLACEBEFORE: 'before',
          PLACEAFTER: 'after',
        }
      );
      expect(result.moved).toBe(true);
      const previous = ['up', 'top'].includes(position);
      const target = previous ? top : bottom;
      const placement = ['up', 'top', 'above'].includes(position) ? 'before' : 'after';
      expect(source.move).toHaveBeenCalledWith(target, placement);
      expect(doc.activeLayer).toBe(source);
    }
  );
  it.each([
    {},
    { position: 'invalid' },
    { position: 'above' },
    { position: 'below', target_layer_id: 0 },
    { position: 'above', target_layer_name: ' ' },
    { position: 'above', target_layer_id: 2, target_layer_name: 'name' },
    { position: 'up', target_layer_id: 3 },
  ])('rejects malformed ordering arguments before execution: %j', (args) => {
    expect(() => reorderLayerScript(args)).toThrow('Invalid parameter');
  });
  it('rejects ambiguous reference names and self-targets before moving', () => {
    const { doc, source } = fixture();
    const run = (args: Record<string, unknown>) =>
      new Function('app', reorderLayerScript(args))({ documents: [doc], activeDocument: doc });
    expect(() => run({ position: 'above', target_layer_name: 'DUP' })).toThrow('ambiguous_name');
    expect(() => run({ position: 'above', target_layer_id: source.id })).toThrow('itself');
    expect(source.move).not.toHaveBeenCalled();
    const tool = createLayerOrderingTools(connection).find(
      (d) => d.tool.name === 'photoshop_reorder_layer'
    )!.tool;
    expect(withOptionalLayerId(tool).inputSchema.properties).toHaveProperty('layer_id');
  });
});

describe('canonical parameter validation', () => {
  it('sets font, size, color, and alignment through one style call', async () => {
    const textItem: any = { contents: 'test' };
    const app = {
      fonts: [{ name: 'Display Font', postScriptName: 'FontPS' }],
      documents: [{}],
      activeDocument: { activeLayer: { kind: 'text', textItem } },
    };
    vi.spyOn(PhotoshopAPIFactory.prototype, 'createAPI').mockResolvedValue({
      getAPIType: () => 'ExtendScript',
      executeScript: async (script: string) =>
        new Function('app', 'LayerKind', 'SolidColor', 'Justification', script)(
          app,
          { TEXT: 'text' },
          function () {
            this.rgb = {};
          },
          { LEFT: 'left', CENTER: 'center' }
        ),
    });
    const tool = createTextTools(connection).find(
      (d) => d.tool.name === 'photoshop_set_text_style'
    )!;
    const result = await tool.handler({
      fontName: 'Display Font',
      fontSize: 24,
      red: 10,
      green: 20,
      blue: 30,
      alignment: 'CENTER',
    });
    expect(result.isError).not.toBe(true);
    expect(textItem).toMatchObject({
      font: 'FontPS',
      size: 24,
      color: { rgb: { red: 10, green: 20, blue: 30 } },
      justification: 'center',
    });
    expect((await tool.handler({ red: 10 })).isError).toBe(true);
    expect((await tool.handler({ alignment: 'bogus' })).isError).toBe(true);
  });
  it('accepts document_id on unified adjustment calls and preserves per-type validation', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    vi.spyOn(PhotoshopAPIFactory.prototype, 'createAPI').mockResolvedValue({
      executeScript: execute,
      getAPIType: () => 'ExtendScript',
    });
    const tool = createColorAdjustmentTools(connection).find(
      (d) => d.tool.name === 'photoshop_create_adjustment_layer'
    )!;
    expect(
      (await tool.handler({ document_id: 123, type: 'threshold', params: { level: 160 } })).isError
    ).not.toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect((await tool.handler({ type: 'threshold', params: { level: 999 } })).isError).toBe(true);
    expect((await tool.handler({ type: 'threshold', params: { unknown: 1 } })).isError).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('canonical group creation', () => {
  function fixture() {
    const doc: any = { id: 100, typename: 'Document', layers: [], activeHistoryState: 'baseline' };
    const makeLayer = (id: number, name: string) => ({
      id,
      name,
      typename: 'ArtLayer',
      visible: id !== 2,
      parent: doc,
      move(group: any) {
        doc.layers.splice(doc.layers.indexOf(this), 1);
        group.layers.unshift(this);
        this.parent = group;
      },
    });
    doc.layers = [makeLayer(1, 'A'), makeLayer(2, 'B')];
    doc.layerSets = {
      add() {
        const group = {
          id: 200,
          name: '',
          typename: 'LayerSet',
          visible: true,
          parent: doc,
          layers: [],
          move() {},
        };
        doc.layers.unshift(group);
        return group;
      },
    };
    return doc;
  }
  it('creates an empty group when layer_ids is omitted', () => {
    const doc = fixture();
    const result = new Function('app', groupScript('create_group', { name: 'Empty' }))({
      documents: [doc],
      activeDocument: doc,
    });
    expect(result.group_name).toBe('Empty');
    expect(result.layer_ids).toEqual([]);
    expect(doc.layers).toHaveLength(3);
  });
  it('groups supplied IDs in stack order and preserves individual visibility', () => {
    const doc = fixture();
    const result = new Function(
      'app',
      'ElementPlacement',
      groupScript('create_group', { name: 'Combined', layer_ids: [2, 1] })
    )({ documents: [doc], activeDocument: doc }, { PLACEBEFORE: 'before', INSIDE: 'inside' });
    expect(result.layer_ids).toEqual([1, 2]);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].layers.map((l: any) => l.visible)).toEqual([true, false]);
  });
});
