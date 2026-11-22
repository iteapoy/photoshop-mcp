import { describe, expect, it } from 'vitest';
import { getTargetLayerId, layerGuardScript, withOptionalLayerId, wrapLayerIdHandler } from '../src/core/layer-target.js';
import { addErrorContext, envelopeToToolResult } from '../src/errors/envelope.js';

const tool = { name: 'photoshop_delete_layer', inputSchema: { type: 'object' as const, properties: {} } };

describe('layer ID targeting', () => {
  it('selects an exact nested ID even with duplicate names', () => {
    const first = { id: 1, name: 'same' };
    const nested = { id: 2, name: 'same' };
    const doc = { activeLayer: first, layers: [first, { id: 3, typename: 'LayerSet', layers: [nested] }] };
    const app = { documents: [doc], activeDocument: doc };
    new Function('app', layerGuardScript(2))(app);
    expect(doc.activeLayer).toBe(nested);
    expect(() => new Function('app', layerGuardScript(9))(app)).toThrow('layer_not_found');
    expect(doc.activeLayer).toBe(nested);
  });

  it('isolates concurrent targets and rejects conflicting arguments', async () => {
    const handler = wrapLayerIdHandler(tool, async () => {
      await Promise.resolve();
      return { content: [{ type: 'text', text: String(getTargetLayerId()) }] };
    });
    const results = await Promise.all([handler({ layer_id: 1 }), handler({ layer_id: 2 })]);
    expect(results.map((r) => r.content[0])).toEqual([
      { type: 'text', text: '1' }, { type: 'text', text: '2' },
    ]);
    expect(getTargetLayerId()).toBeUndefined();
    expect(() => handler({ layer_id: 2, layer_name: 'same' })).toThrow('conflicts');
    expect(() => handler({ layer_id: 1.2 })).toThrow('positive integer');
    expect(withOptionalLayerId(tool).inputSchema.properties).toHaveProperty('layer_id');
  });
});

describe('error phases', () => {
  it('preserves execution phase on native parameter errors', () => {
    const r = addErrorContext('photoshop_fill_layer', envelopeToToolResult({
      ok: false, code: 'invalid_arguments', message: 'Illegal parameter (phase: execution)',
    }));
    const body = JSON.parse((r.content[0] as { text: string }).text);
    expect(body.phase).toBe('execution');
    expect(body.operation).toBe('photoshop_fill_layer');
  });
  it('labels target lookup and timeout separately', () => {
    for (const [code, phase] of [['layer_not_found', 'target_resolution'], ['extendscript_timeout', 'timeout']] as const) {
      const r = addErrorContext('test', envelopeToToolResult({ ok: false, code, message: code }));
      expect(JSON.parse((r.content[0] as { text: string }).text).phase).toBe(phase);
    }
  });
});
