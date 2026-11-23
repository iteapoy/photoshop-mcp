import { describe, expect, it } from 'vitest';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';
import { resolveIdsScript } from '../src/tools/id-tools.js';
import { classifyError } from '../src/errors/envelope.js';
import { createPathTools } from '../src/tools/path-tools.js';

describe('ambiguous layer names', () => {
  it('rejects deletion before changing either duplicate layer', () => {
    let deleted = false;
    const layer = () => ({ name: 'DUP', typename: 'ArtLayer', remove() { deleted = true; } });
    const doc = { layers: [layer(), { typename: 'LayerSet', name: 'group', layers: [layer()] }] };
    expect(() => new Function('app', ExtendScriptSnippets.deleteLayer('DUP'))({
      documents: [doc], activeDocument: doc,
    })).toThrow('ambiguous_name');
    expect(deleted).toBe(false);
    expect(classifyError('ambiguous_name: use layer_id').code).toBe('ambiguous_name');
  });
});

describe('Action Manager ID diagnostics', () => {
  it('rejects invalid charIDs before Photoshop execution with an actionable message', () => {
    expect(() => resolveIdsScript([{ kind: 'char', value: 'Using' }])).toThrow('exactly 4');
    expect(() => resolveIdsScript([{ kind: 'char', value: 'Using' }])).toThrow('stringIDToTypeID');
    expect(() => resolveIdsScript([{ kind: 'string', value: 'using' }])).not.toThrow();
  });
  it('compares four-character interpretations without guessing the intended kind', () => {
    const script = resolveIdsScript([{ kind: 'char', value: 'Usng' }]);
    const result = new Function('charIDToTypeID', 'stringIDToTypeID', script)(
      () => 1433628263, () => 4930,
    );
    expect(result.ids[0].id).toBe(1433628263);
    expect(result.ids[0].same_id).toBe(false);
  });
});

describe('stroke option validation', () => {
  it('rejects invalid widths, opacity and incomplete dash pairs before touching Photoshop', async () => {
    const tool = createPathTools({} as never).find((entry) => entry.tool.name === 'photoshop_stroke_path')!;
    for (const params of [{ width: 0 }, { width: NaN }, { opacity: 101 }, { alignment: 'bad' }, { dash: 4 }, { gap: -1 }]) {
      const result = await tool.handler({ name: 'path', ...params });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content[0] as { text: string }).text).code).toBe('invalid_arguments');
    }
  });
});
