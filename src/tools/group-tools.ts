import type { ToolDefinition } from '../core/tool-registry.js';
import type { PhotoshopConnection } from '../platform/connection.js';
import { atomicFailureFromError, atomicSuccess, parseSnippetResult, runSnippet } from './atomic-shared.js';

type GroupAction = 'create_group' | 'group_layers' | 'move_layers_to_group' | 'ungroup';
export function groupScript(action: GroupAction, args: Record<string, unknown>): string {
  const ids = args.layer_ids ?? [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length) throw new Error('Invalid parameter: layer_ids must contain unique positive integers');
  if ((action === 'group_layers' || action === 'move_layers_to_group') && !ids.length) {
    throw new Error('Invalid parameter: layer_ids must not be empty');
  }
  if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) {
    throw new Error('Invalid parameter: name must be non-empty');
  }
  for (const key of ['group_id', 'parent_group_id']) {
    if (args[key] !== undefined && (typeof args[key] !== 'number' || !Number.isSafeInteger(args[key]) || (args[key] as number) <= 0)) {
      throw new Error('Invalid parameter: ' + key + ' must be a positive integer');
    }
  }
  if ((action === 'ungroup' || action === 'move_layers_to_group') && args.group_id === undefined) {
    throw new Error('Invalid parameter: group_id is required');
  }
  return `
    if (!app.documents.length) throw new Error('No active document');
    var doc = app.activeDocument, baseline = doc.activeHistoryState;
    var records = [];
    function collect(container) {
      for (var i = 0; i < container.layers.length; i++) {
        var l = container.layers[i];
        records.push({ layer: l, id: l.id, parent: container, visible: l.visible });
        if (l.typename === 'LayerSet') collect(l);
      }
    }
    collect(doc);
    function find(id) {
      for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i].layer;
      throw new Error('layer_not_found: ' + id);
    }
    function restoreVisibility() {
      for (var i = 0; i < records.length; i++) {
        try {
          if (records[i].layer.visible !== records[i].visible) records[i].layer.visible = records[i].visible;
        } catch (gone) {}
      }
    }
    function assertGroup(group) {
      if (group.typename !== 'LayerSet') throw new Error('Invalid parameter: target is not a group');
      var ref = new ActionReference();
      ref.putIdentifier(charIDToTypeID('Lyr '), group.id);
      var desc = executeActionGet(ref);
      if (desc.hasKey(stringIDToTypeID('artboardEnabled')) && desc.getBoolean(stringIDToTypeID('artboardEnabled'))) {
        throw new Error('Invalid parameter: artboard grouping is not supported');
      }
    }
    var ids = ${JSON.stringify(ids)}, selected = [];
    // Walk the existing stack, not caller order, to preserve visual stacking.
    for (var i = 0; i < ids.length; i++) find(ids[i]);
    for (var r = 0; r < records.length; r++) {
      for (var i = 0; i < ids.length; i++) if (records[r].id === ids[i]) selected.push(records[r].layer);
    }
    var group = null, parent = doc;
    if (${args.parent_group_id !== undefined}) {
      parent = find(${args.parent_group_id ?? 0}); assertGroup(parent);
    }
    if (${action === 'move_layers_to_group' || action === 'ungroup'}) {
      group = find(${args.group_id ?? 0}); assertGroup(group);
    }
    if (selected.length) {
      var sourceParent = selected[0].parent;
      for (var i = 0; i < selected.length; i++) {
        if (selected[i].parent.id !== sourceParent.id || selected[i].parent.typename !== sourceParent.typename) {
          throw new Error('Invalid parameter: selected layers must be siblings');
        }
        if (selected[i].typename === 'LayerSet') assertGroup(selected[i]);
      }
      if (${action === 'group_layers' || action === 'create_group'}) {
        if (${args.parent_group_id !== undefined} && parent.id !== sourceParent.id) {
          throw new Error('Invalid parameter: parent_group_id must match selected layers parent');
        }
        parent = sourceParent;
      }
      if (${action === 'move_layers_to_group'}) {
        var ancestor = group;
        while (ancestor && ancestor.typename !== 'Document') {
          for (var i = 0; i < selected.length; i++) {
            if (ancestor.id === selected[i].id) throw new Error('Invalid parameter: cannot move group into itself or its descendant');
          }
          ancestor = ancestor.parent;
        }
      }
    }
    try {
      if (${action === 'create_group' || action === 'group_layers'}) {
        group = parent.layerSets.add();
        group.name = ${JSON.stringify(args.name ?? 'Group')};
        if (selected.length) group.move(selected[0], ElementPlacement.PLACEBEFORE);
      }
      var moved = [];
      if (${action === 'ungroup'}) {
        var children = [];
        for (var i = 0; i < group.layers.length; i++) children.push(group.layers[i]);
        for (var i = 0; i < children.length; i++) {
          children[i].move(group, ElementPlacement.PLACEBEFORE);
          moved.push(children[i].id);
        }
        group.remove();
        restoreVisibility();
        return { ungrouped: true, layer_ids: moved, document_id: doc.id,
          warning: 'Ungrouping removes group-level compositing, opacity, effects, masks and visibility inheritance.' };
      }
      for (var i = selected.length - 1; i >= 0; i--) selected[i].move(group, ElementPlacement.INSIDE);
      restoreVisibility();
      for (var i = 0; i < group.layers.length; i++) moved.push(group.layers[i].id);
      return { group_id: group.id, group_name: group.name, layer_ids: moved, document_id: doc.id };
    } catch (error) {
      try { doc.activeHistoryState = baseline; }
      catch (rollbackError) { throw new Error(error.message + ' (rollback failed: ' + rollbackError.message + ')'); }
      throw error;
    }
  `;
}

export function createGroupTools(connection: PhotoshopConnection): ToolDefinition[] {
  const idList = { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true };
  const operations: Array<{
    action: GroupAction; name: string; description: string; properties: Record<string, object>; required: string[];
  }> = [
    { action: 'create_group' as const, name: 'photoshop_create_group', description: 'Create a group, optionally grouping sibling layer_ids in existing stack order. parent_group_id selects a parent for an empty group.',
      properties: { name: { type: 'string' }, layer_ids: idList, parent_group_id: { type: 'integer', minimum: 1 } }, required: [] },
    { action: 'group_layers' as const, name: 'photoshop_group_layers', description: 'Group sibling layer_ids in existing stack order. Preserves individual visibility. Noncontiguous layers become contiguous inside the new group.',
      properties: { name: { type: 'string' }, layer_ids: idList }, required: ['layer_ids'] },
    { action: 'move_layers_to_group' as const, name: 'photoshop_move_layers_to_group', description: 'Move sibling layer_ids to the top of group_id, preserving their relative stack order and individual visibility. Rejects cyclic nesting.',
      properties: { group_id: { type: 'integer', minimum: 1 }, layer_ids: idList }, required: ['group_id', 'layer_ids'] },
    { action: 'ungroup' as const, name: 'photoshop_ungroup', description: 'Remove a group and move children to its parent in stack order. Removes group compositing, effects, masks and visibility inheritance, so appearance can change. Artboards are rejected.',
      properties: { group_id: { type: 'integer', minimum: 1 } }, required: ['group_id'] },
  ];
  return operations.map(({ action, name, description, properties, required }) => ({
    tool: {
      name,
      description: description + ' Preconditions: active document. On execution failure restores the document history checkpoint when available.',
      inputSchema: { type: 'object' as const, properties, required, additionalProperties: false },
    },
    handler: async (args) => {
      try {
        const result = parseSnippetResult(await runSnippet(connection, groupScript(action, args)));
        if (!result) throw new Error('Invalid group result');
        return atomicSuccess('Group operation completed', result);
      } catch (error) { return atomicFailureFromError(error); }
    },
  }));
}
