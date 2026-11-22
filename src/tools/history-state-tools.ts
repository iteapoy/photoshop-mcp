import type { ToolDefinition } from '../core/tool-registry.js';
import type { PhotoshopConnection } from '../platform/connection.js';
import { atomicFailureFromError, atomicSuccess, parseSnippetResult, runSnippet } from './atomic-shared.js';

export function rollbackScript(code: string): string {
  return `
    if (!app.documents.length) throw new Error('No active document for rollback');
    var rollbackDoc = app.activeDocument;
    var rollbackState = rollbackDoc.activeHistoryState;
    function restoreCheckpoint() {
      try {
        app.activeDocument = rollbackDoc;
        rollbackDoc.activeHistoryState = rollbackState;
        return 'succeeded';
      } catch (restoreError) {
        return 'failed: ' + restoreError.message;
      }
    }
    try {
      var scriptResult = (function() { ${code}\n })();
      if (scriptResult && typeof scriptResult === 'object' && scriptResult.ok === false) {
        scriptResult.rollback = restoreCheckpoint();
      }
      return scriptResult;
    } catch (scriptError) {
      var status = restoreCheckpoint();
      throw new Error((scriptError.message || String(scriptError)) +
        ' (number: ' + scriptError.number + ') (script_line: ' + scriptError.line +
        ') (rollback: ' + status + ')');
    }
  `;
}

export function historyStateScript(action: 'save_snapshot' | 'revert_to_state', args: Record<string, unknown>): string {
  if (action === 'save_snapshot') {
    if (typeof args.name !== 'string' || !args.name.trim()) throw new Error('Invalid parameter: name is required');
    return `
      if (!app.documents.length) throw new Error('No active document');
      var doc = app.activeDocument;
      var name = ${JSON.stringify(args.name)};
      for (var i = 0; i < doc.historyStates.length; i++) {
        if (doc.historyStates[i].name === name) throw new Error('Invalid parameter: history name already exists');
      }
      var d = new ActionDescriptor(), r = new ActionReference();
      r.putClass(charIDToTypeID('SnpS'));
      d.putReference(charIDToTypeID('null'), r);
      var from = new ActionReference();
      from.putProperty(charIDToTypeID('HstS'), charIDToTypeID('CrnH'));
      d.putReference(charIDToTypeID('From'), from);
      d.putString(charIDToTypeID('Nm  '), name);
      executeAction(charIDToTypeID('Mk  '), d, DialogModes.NO);
      return { saved: true, snapshot_name: name, document_id: doc.id };
    `;
  }
  const hasName = args.snapshot_name !== undefined;
  const hasIndex = args.state_index !== undefined;
  if (hasName === hasIndex) throw new Error('Invalid parameter: provide exactly one of snapshot_name or state_index');
  if (hasName && (typeof args.snapshot_name !== 'string' || !args.snapshot_name.trim())) {
    throw new Error('Invalid parameter: snapshot_name must be non-empty');
  }
  if (hasIndex && (typeof args.state_index !== 'number' || !Number.isSafeInteger(args.state_index) || args.state_index < 0)) {
    throw new Error('Invalid parameter: state_index must be a non-negative integer');
  }
  return `
    if (!app.documents.length) throw new Error('No active document');
    var doc = app.activeDocument;
    var target = null;
    ${hasIndex ? `
      if (${args.state_index} >= doc.historyStates.length) throw new Error('Invalid parameter: state_index is out of range');
      target = doc.historyStates[${args.state_index}];
    ` : `
      for (var i = 0; i < doc.historyStates.length; i++) {
        var candidate = doc.historyStates[i];
        if (candidate.snapshot && candidate.name === ${JSON.stringify(args.snapshot_name)}) {
          if (target) throw new Error('Invalid parameter: ambiguous snapshot name');
          target = candidate;
        }
      }
      if (!target) throw new Error('Invalid parameter: snapshot not found');
    `}
    doc.activeHistoryState = target;
    return { restored: true, state_name: target.name, document_id: doc.id };
  `;
}

export function createHistoryStateTools(connection: PhotoshopConnection): ToolDefinition[] {
  const operations: Array<{
    name: string; description: string; inputSchema: ToolDefinition['tool']['inputSchema'];
    action: 'save_snapshot' | 'revert_to_state';
  }> = [
    {
      name: 'photoshop_save_snapshot',
      description: 'Create a named full-document history snapshot. Names must be unique within the current history list. Preconditions: active document. Side effects: adds an in-memory snapshot; snapshots do not persist across closing the document.',
      inputSchema: { type: 'object' as const, properties: { name: { type: 'string', minLength: 1 } }, required: ['name'] },
      action: 'save_snapshot' as const,
    },
    {
      name: 'photoshop_revert_to_state',
      description: 'Restore a named snapshot or a zero-based state_index from get_history. Supply exactly one selector. Indices can change after edits; query history immediately before using an index. Side effects: restores this document only; does not undo saved files or external effects.',
      inputSchema: { type: 'object' as const, properties: {
        snapshot_name: { type: 'string', minLength: 1 }, state_index: { type: 'integer', minimum: 0 },
      } },
      action: 'revert_to_state' as const,
    },
  ];
  return operations.map(({ action, ...tool }) => ({
    tool,
    handler: async (args) => {
      try {
        const result = parseSnippetResult(await runSnippet(connection, historyStateScript(action, args)));
        if (!result) throw new Error('Invalid history result');
        return atomicSuccess(action === 'save_snapshot' ? 'Snapshot saved' : 'History state restored', result);
      } catch (error) { return atomicFailureFromError(error); }
    },
  }));
}
