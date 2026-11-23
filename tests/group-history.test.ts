import { describe, expect, it } from 'vitest';
import { groupScript } from '../src/tools/group-tools.js';
import { historyStateScript, rollbackScript } from '../src/tools/history-state-tools.js';
import { layerGuardScript, withOptionalLayerId } from '../src/core/layer-target.js';

describe('visibility preservation on ID activation', () => {
  it('restores target and ancestor visibility after Photoshop activation', () => {
    const parent = { id: 2, typename: 'LayerSet', visible: false, parent: { typename: 'Document' }, layers: [] as unknown[] };
    const child = { id: 3, visible: false, parent };
    parent.layers.push(child);
    let active;
    const doc = {
      layers: [parent],
      get activeLayer() { return active; },
      set activeLayer(value) { active = value; child.visible = true; parent.visible = true; },
    };
    new Function('app', layerGuardScript(3))({ documents: [doc], activeDocument: doc });
    expect(child.visible).toBe(false);
    expect(parent.visible).toBe(false);
    expect(active).toBe(child);
  });

  it('exposes IDs for selection, text and filters without requiring the legacy selection name', () => {
    for (const name of ['photoshop_select_layer_by_name', 'photoshop_set_text_style', 'photoshop_apply_gaussian_blur']) {
      const tool = withOptionalLayerId({ name, inputSchema: { type: 'object', required: name.includes('select_') ? ['name'] : [] } });
      expect(tool.inputSchema.properties).toHaveProperty('layer_id');
      if (name.includes('select_')) expect(tool.inputSchema.required).not.toContain('name');
    }
  });
});

describe('history rollback', () => {
  function doc() {
    let current = 'initial';
    return { get activeHistoryState() { return current; }, set activeHistoryState(value) { current = value; } };
  }
  it('restores a failed script but retains successful edits', () => {
    const d = doc(), app = { documents: [d], activeDocument: d };
    expect(() => new Function('app', rollbackScript('app.activeDocument.activeHistoryState="changed"; throw new Error("failure");'))(app)).toThrow('rollback: succeeded');
    expect(d.activeHistoryState).toBe('initial');
    new Function('app', rollbackScript('app.activeDocument.activeHistoryState="changed"; return {ok:true};'))(app);
    expect(d.activeHistoryState).toBe('changed');
  });
  it('restores on returned ok:false and reports a failed restore', () => {
    const d = doc(), app = { documents: [d], activeDocument: d };
    const result = new Function('app', rollbackScript('app.activeDocument.activeHistoryState="changed"; return {ok:false};'))(app);
    expect(result.rollback).toBe('succeeded');
    expect(d.activeHistoryState).toBe('initial');
    Object.defineProperty(d, 'activeHistoryState', { get: () => 'initial', set: () => { throw new Error('document gone'); } });
    expect(() => new Function('app', rollbackScript('throw new Error("failure");'))(app)).toThrow('rollback: failed');
  });

  it('validates state selectors before executing Photoshop', () => {
    expect(() => historyStateScript('revert_to_state', {})).toThrow('exactly one');
    expect(() => historyStateScript('revert_to_state', { state_index: -1 })).toThrow();
    expect(() => historyStateScript('revert_to_state', { state_index: 0, snapshot_name: 'x' })).toThrow();
    expect(() => historyStateScript('save_snapshot', { name: '' })).toThrow();
  });
});

describe('group input validation', () => {
  it('rejects invalid and repeated layer IDs', () => {
    expect(() => groupScript('create_group', { layer_ids: [1, 1] })).toThrow();
    expect(() => groupScript('create_group', { layer_ids: [0] })).toThrow();
    expect(() => groupScript('ungroup', {})).toThrow();
    expect(() => groupScript('create_group', { parent_group_id: 1.2 })).toThrow();
  });
});
