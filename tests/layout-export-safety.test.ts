import { describe, expect, it } from 'vitest';
import { ExtendScriptSnippets as snippets } from '../src/api/extendscript.js';

const unit = (value: number) => ({ value, as: () => value });
let nextId = 1;
class Layer {
  id = nextId++;
  typename = 'ArtLayer';
  visible = true;
  allLocked = false;
  positionLocked = false;
  isBackgroundLayer = false;
  parent: Layer | Document | undefined;
  layers: Layer[] = [];
  rect: number[];
  failMove = false;
  failRotate = false;
  constructor(public name: string, rect = [0, 0, 10, 10]) { this.rect = [...rect]; }
  get bounds() { return this.rect.map(unit); }
  translate(dx: ReturnType<typeof unit>, dy: ReturnType<typeof unit>) {
    if (this.failMove) throw new Error('injected translate failure');
    this.rect = this.rect.map((v, i) => v + (i % 2 ? dy.value : dx.value));
  }
  rotate() { if (this.failRotate) throw new Error('injected rotate failure'); }
  duplicate(): Layer {
    const copy = new Layer(this.name, this.rect);
    copy.parent = this.parent;
    copy.failMove = this.failMove;
    copy.failRotate = this.failRotate;
    this.parent!.layers.push(copy);
    return copy;
  }
}
class Document {
  typename = 'Document';
  activeLayer: Layer;
  width = unit(200);
  height = unit(200);
  closed = false;
  exported: unknown;
  constructor(public layers: Layer[]) {
    this.activeLayer = layers[0];
    this.attach(this);
  }
  attach(container: Layer | Document) {
    for (const layer of container.layers) {
      layer.parent = container;
      this.attach(layer);
    }
  }
  get activeHistoryState() {
    const records: Array<{ layer: Layer; rect: number[]; visible: boolean; children: Layer[] }> = [];
    function collect(container: Layer | Document) {
      for (const layer of container.layers) {
        records.push({ layer, rect: [...layer.rect], visible: layer.visible, children: [...layer.layers] });
        collect(layer);
      }
    }
    collect(this);
    return { roots: [...this.layers], records };
  }
  set activeHistoryState(state: ReturnType<Document['snapshot']>) {
    this.layers = [...state.roots];
    for (const record of state.records) {
      record.layer.rect = [...record.rect];
      record.layer.visible = record.visible;
      record.layer.layers = [...record.children];
    }
  }
  snapshot() { return this.activeHistoryState; }
  exportDocument() {
    this.exported = this.layers.map(function record(l): unknown {
      return { name: l.name, visible: l.visible, children: l.layers.map(record) };
    });
  }
  close() { this.closed = true; }
}
function run(script: string, doc: Document, extra: Record<string, unknown> = {}) {
  return new Function('app', 'UnitValue', ...Object.keys(extra), script)(
    { documents: [doc], activeDocument: doc },
    function (value: number) { return unit(value); }, ...Object.values(extra)
  );
}

function exportFixture(roots: Layer[], target: Layer, byId = false) {
  const source = new Document(roots);
  source.activeLayer = target;
  let copy: Document;
  const clone = (l: Layer): Layer => {
    const result = new Layer(l.name, l.rect);
    result.typename = l.typename;
    result.visible = l.visible;
    result.layers = l.layers.map(clone);
    return result;
  };
  Object.assign(source, { duplicate() { copy = new Document(roots.map(clone)); return copy; } });
  const script = (byId ? `var __mcp_targetLayerId = ${target.id};\n` : '') +
    snippets.exportLayer('/tmp/not-written.png', '/tmp', 'PNG', 90, '', false);
  const result = run(script, source, {
    DialogModes: { NO: 0 }, SaveOptions: { DONOTSAVECHANGES: 0 },
    File: function () {}, ExportOptionsSaveForWeb: function () {},
    SaveDocumentType: { PNG: 1 }, ExportType: { SAVEFORWEB: 1 },
  });
  return { result, source, copy: copy! };
}

describe('isolated layer export', () => {
  it('preserves visible and hidden descendants of the target group', () => {
    const group = new Layer('Group');
    group.typename = 'LayerSet';
    const visible = new Layer('visible');
    const hidden = new Layer('hidden'); hidden.visible = false;
    const nested = new Layer('nested'); nested.typename = 'LayerSet';
    nested.layers = [new Layer('nested content')];
    group.layers = [visible, hidden, nested];
    const sibling = new Layer('sibling');
    const { copy, source, result } = exportFixture([group, sibling], group);
    expect(result.ok).toBe(true);
    expect(copy.layers[0].layers.map(l => l.visible)).toEqual([true, false, true]);
    expect(copy.layers[0].layers[2].layers[0].visible).toBe(true);
    expect(copy.layers[1].visible).toBe(false);
    expect(source.layers[1].visible).toBe(true);
    expect(copy.closed).toBe(true);
  });
  it.each([false, true])('exports the exact active duplicate-name layer (ID targeting=%s)', (byId) => {
    const group = new Layer('Group'); group.typename = 'LayerSet'; group.visible = false;
    const first = new Layer('DUP');
    const second = new Layer('DUP');
    group.layers = [first, second];
    const outside = new Layer('DUP');
    const { copy, source, result } = exportFixture([outside, group], second, byId);
    expect(result.ok).toBe(true);
    expect(copy.layers[0].visible).toBe(false);
    expect(copy.layers[1].visible).toBe(true);
    expect(copy.layers[1].layers.map(l => l.visible)).toEqual([false, true]);
    expect(copy.layers[1].layers[1].id).not.toBe(second.id);
    expect(source.layers[1].visible).toBe(false);
  });
});

describe('center distribution', () => {
  it.each(['horizontal', 'vertical'] as const)('sorts by %s center and is idempotent for unequal sizes', axis => {
    const rect = (start: number, end: number) => axis === 'horizontal' ? [start, 0, end, 10] : [0, start, 10, end];
    const layers = [new Layer('A', rect(0, 200)), new Layer('B', rect(10, 20)), new Layer('C', rect(30, 40))];
    const doc = new Document(layers);
    const script = snippets.distributeLayers(axis, 'centers', ['A', 'B', 'C']);
    const first = run(script, doc);
    expect(first.order).toEqual(['B', 'C', 'A']);
    const idx = axis === 'horizontal' ? 0 : 1;
    const centers = first.order.map((name: string) => {
      const l = layers.find(l => l.name === name)!; return (l.rect[idx] + l.rect[idx + 2]) / 2;
    });
    expect(centers).toEqual([15, 57.5, 100]);
    expect(run(script, doc).moved).toEqual([]);
  });
});

describe('layout failure recovery', () => {
  it.each(['centers', 'gaps'] as const)('rolls back earlier moves after a %s distribution fails', mode => {
    const layers = [new Layer('A'), new Layer('B', [20, 0, 30, 10]), new Layer('C', [40, 0, 50, 10]), new Layer('D', [100, 0, 110, 10])];
    const doc = new Document(layers);
    const before = layers.map(l => [...l.rect]);
    layers[2].failMove = true;
    expect(() => run(snippets.distributeLayers('horizontal', mode, layers.map(l => l.name)), doc)).toThrow('injected translate failure');
    expect(layers.map(l => l.rect)).toEqual(before);
    expect(doc.activeLayer).toBe(layers[0]);
  });
  it('rejects a locked layer before moving any layer', () => {
    const layers = [new Layer('A'), new Layer('B', [20, 0, 30, 10]), new Layer('C', [40, 0, 50, 10])];
    const doc = new Document(layers);
    layers[1].positionLocked = true;
    let moves = 0;
    for (const layer of layers) layer.translate = () => { moves++; };
    expect(() => run(snippets.distributeLayers('horizontal', 'gaps', ['A', 'B', 'C']), doc)).toThrow('locked');
    expect(moves).toBe(0);
  });
  it.each(['linear', 'rotate'] as const)('removes copies after a %s array fails', mode => {
    const source = new Layer('source');
    const doc = new Document([source]);
    // Fail after one full copy and after the next duplicate has already been added.
    let calls = 0;
    const original = source.duplicate.bind(source);
    source.duplicate = () => { const copy = original(); if (++calls === 2) copy.failMove = true; return copy; };
    expect(() => run(snippets.duplicateArray('', 4, mode, null, null, 360, 0, 20, 0), doc)).toThrow('injected translate failure');
    expect(doc.layers).toEqual([source]);
    expect(doc.activeLayer).toBe(source);
  });
  it('rolls back successful alignments when a subsequent move fails', () => {
    const layers = [new Layer('A', [10, 0, 20, 10]), new Layer('B', [40, 0, 50, 10])];
    const doc = new Document(layers);
    layers[1].failMove = true;
    expect(() => run(snippets.alignLayers('left', 'canvas', '', ['A', 'B']), doc)).toThrow('injected translate failure');
    expect(layers.map(l => l.rect[0])).toEqual([10, 40]);
  });
  it('reports a rollback failure without hiding the original failure', () => {
    const source = new Layer('source'); const doc = new Document([source]);
    source.failRotate = true;
    Object.defineProperty(doc, 'activeHistoryState', { get: () => ({}), set: () => { throw Error('history unavailable'); } });
    expect(() => run(snippets.duplicateArray('', 3, 'rotate', null, null, 360, 0, 0, 0), doc))
      .toThrow('injected rotate failure (rollback failed: history unavailable)');
  });
});
