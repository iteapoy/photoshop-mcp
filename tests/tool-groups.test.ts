import { describe, expect, it } from 'vitest';

import { extractCall, groupOf, prepareArgs } from '../scripts/tool-groups.mjs';

const CONFIG = { rawTool: true, overrides: {} };

const layerVisibility = {
  name: 'photoshop_set_layer_visibility',
  description: 'Show or hide the active layer',
  inputSchema: {
    type: 'object',
    properties: {
      visible: { type: 'boolean' },
      document_id: { type: ['number', 'null'] },
    },
    required: ['visible', 'document_id'],
  },
};

describe('groupOf', () => {
  it('files select_layer_by_name under layer, not selection', () => {
    expect(groupOf('photoshop_select_layer_by_name', CONFIG)).toBe('layer');
  });

  it('files rasterize_layer under layer, not export', () => {
    expect(groupOf('photoshop_rasterize_layer', CONFIG)).toBe('layer');
  });

  it('keeps real selection tools in selection', () => {
    expect(groupOf('photoshop_select_rectangle', CONFIG)).toBe('selection');
    expect(groupOf('photoshop_select_subject', CONFIG)).toBe('selection');
    expect(groupOf('photoshop_deselect', CONFIG)).toBe('selection');
  });

  it('still honours explicit overrides first', () => {
    expect(
      groupOf('photoshop_select_layer_by_name', {
        ...CONFIG,
        overrides: { photoshop_select_layer_by_name: 'selection' },
      })
    ).toBe('selection');
  });
});

describe('prepareArgs', () => {
  it('flattens params nested one level too deep', () => {
    const prepared = prepareArgs(layerVisibility, { params: { visible: false } });
    expect(prepared).toEqual({ ok: true, args: { visible: false, document_id: null } });
  });

  it('flattens doubly nested params (the escape-hatch mistake)', () => {
    const prepared = prepareArgs(layerVisibility, { params: { params: { visible: true } } });
    expect(prepared).toEqual({ ok: true, args: { visible: true, document_id: null } });
  });

  it('accepts an arguments wrapper from photoshop_call', () => {
    const prepared = prepareArgs(layerVisibility, { arguments: { visible: true, document_id: 7 } });
    expect(prepared).toEqual({ ok: true, args: { visible: true, document_id: 7 } });
  });

  it('does not unwrap when the schema really has a params property', () => {
    const tool = {
      name: 'photoshop_x',
      inputSchema: {
        type: 'object',
        properties: { params: { type: 'object' } },
        required: ['params'],
      },
    };
    const prepared = prepareArgs(tool, { params: { anything: 1 } });
    expect(prepared).toEqual({ ok: true, args: { params: { anything: 1 } } });
  });

  it('reports unknown params with the allowed list', () => {
    const prepared = prepareArgs(layerVisibility, { visible: true, bogus: 1 });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.message).toContain('unknown params: bogus');
      expect(prepared.message).toContain('visible*, document_id*');
    }
  });

  it('flattens three levels of params too', () => {
    const prepared = prepareArgs(layerVisibility, {
      params: { params: { params: { visible: true } } },
    });
    expect(prepared).toEqual({ ok: true, args: { visible: true, document_id: null } });
  });

  it('flattens five levels of params too — depth is not the caller\u2019s problem', () => {
    const prepared = prepareArgs(layerVisibility, {
      params: { params: { params: { params: { params: { visible: true } } } } },
    });
    expect(prepared).toEqual({ ok: true, args: { visible: true, document_id: null } });
  });

  it('does not loop forever on a self-referencing wrapper', () => {
    const loop: Record<string, unknown> = {};
    loop.params = loop;
    const prepared = prepareArgs(layerVisibility, { visible: true, params: loop });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.message).toContain('unknown params: params');
  });

  it('treats a non-object wrapper as a mistake and explains it', () => {
    const prepared = prepareArgs(layerVisibility, { params: 'visible=true' } as never);
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.message).toContain('only wraps the real parameters');
  });
});

describe('extractCall', () => {
  it('reads { action, params } from a group tool', () => {
    expect(extractCall({ action: ' get_layers ', params: { document_id: 3 } })).toEqual({
      action: 'get_layers',
      params: { document_id: 3 },
    });
  });

  it('reads { tool, params } from photoshop_call', () => {
    expect(
      extractCall({ tool: 'photoshop_get_layers', params: { document_id: 3 } }, 'tool')
    ).toEqual({
      action: 'photoshop_get_layers',
      params: { document_id: 3 },
    });
  });

  it('still accepts the legacy arguments key', () => {
    expect(
      extractCall({ tool: 'photoshop_get_layers', arguments: { document_id: 3 } }, 'tool')
    ).toEqual({
      action: 'photoshop_get_layers',
      params: { document_id: 3 },
    });
  });

  it('merges flat siblings of the action key', () => {
    expect(extractCall({ action: 'get_layers', document_id: 3 })).toEqual({
      action: 'get_layers',
      params: { document_id: 3 },
    });
  });

  it('lets params win over a leftover sibling', () => {
    expect(extractCall({ action: 'x', document_id: 1, params: { document_id: 2 } })).toEqual({
      action: 'x',
      params: { document_id: 2 },
    });
  });

  it('never leaks the action key into params', () => {
    const { params } = extractCall({ action: 'x', params: { a: 1 } });
    expect(params).not.toHaveProperty('action');
  });

  it('returns an empty action so the caller can report it', () => {
    expect(extractCall({ params: { a: 1 } })).toEqual({ action: '', params: { a: 1 } });
  });
});

describe('compact adjustment schema discovery', () => {
  it('narrows parameters and required fields without mutating the original schema', async () => {
    const { actionSchemaDetails } = await import('../scripts/tool-groups.mjs');
    const { createColorAdjustmentTools } = await import('../src/tools/color-adjustment-tools.js');
    const tool = createColorAdjustmentTools({} as never)[0].tool;
    const original = JSON.stringify(tool);
    const threshold = actionSchemaDetails(tool, 'threshold').schema;
    expect(threshold.oneOf).toBeUndefined();
    expect(threshold.properties.type).toEqual({ const: 'threshold' });
    expect(Object.keys(threshold.properties.params.properties)).toEqual(['level']);
    expect(threshold.properties.params.properties.level.maximum).toBe(255);
    const lookup = actionSchemaDetails(tool, 'color_lookup').schema;
    expect(lookup.required).toContain('params');
    expect(lookup.properties.params.required).toContain('lut');
    expect(JSON.stringify(tool)).toBe(original);
    expect(() => actionSchemaDetails(tool, 'unknown')).toThrow('Unknown adjustment type');
  });

  it('keeps constraints and removes duplicate descriptions and signatures', async () => {
    const { actionSchemaDetails } = await import('../scripts/tool-groups.mjs');
    const tool = {
      name: 'photoshop_fill_layer',
      description: 'Fill pixels.\nUse when: filling.\nPreconditions: unlocked layer. Side effects: overwrites pixels.',
      inputSchema: { type: 'object', properties: {} },
    };
    const result = actionSchemaDetails(tool);
    expect(result.constraints).toContain('overwrites pixels');
    expect(result).not.toHaveProperty('signature');
    expect(result).not.toHaveProperty('description');
    expect(() => actionSchemaDetails(tool, 'threshold')).toThrow('only supported');
  });
});

describe('parameter aliases', () => {
  it('normalizes legacy file paths and rejects conflicting values', () => {
    const tool = { name: 'photoshop_open_image', inputSchema: {
      type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'],
    } };
    expect(prepareArgs(tool, { file_path: '/tmp/a.png' }).ok).toBe(true);
    expect(prepareArgs(tool, { file_path: '/tmp/a.png', filePath: '/tmp/b.png' }).ok).toBe(false);
  });
});
