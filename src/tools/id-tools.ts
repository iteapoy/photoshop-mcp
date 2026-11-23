import type { ToolDefinition } from '../core/tool-registry.js';
import type { PhotoshopConnection } from '../platform/connection.js';
import { atomicFailureFromError, atomicSuccess, parseSnippetResult, runSnippet } from './atomic-shared.js';

export function resolveIdsScript(raw: unknown): string {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) {
    throw new Error('Invalid parameter: ids must contain 1-100 entries');
  }
  const ids = raw.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid parameter: each ID needs kind and value');
    const { kind, value } = entry as Record<string, unknown>;
    if ((kind !== 'char' && kind !== 'string') || typeof value !== 'string' || !value.length) {
      throw new Error('Invalid parameter: each ID needs kind char/string and a non-empty value');
    }
    if (kind === 'char' && value.length !== 4) {
      throw new Error('Invalid parameter: charIDToTypeID requires exactly 4 characters, including spaces. Use stringIDToTypeID only for the actual stringID name, or correct the four-character charID.');
    }
    return { kind, value };
  });
  return `
    var ids = ${JSON.stringify(ids)}, results = [];
    for (var i = 0; i < ids.length; i++) {
      var entry = ids[i];
      var id = entry.kind === 'char' ? charIDToTypeID(entry.value) : stringIDToTypeID(entry.value);
      var result = { kind: entry.kind, value: entry.value, id: id };
      if (entry.value.length === 4) {
        result.char_id = charIDToTypeID(entry.value);
        result.string_id = stringIDToTypeID(entry.value);
        result.same_id = result.char_id === result.string_id;
      }
      results.push(result);
    }
    return { ids: results, note: 'Numeric IDs alone do not prove descriptor semantics. Four-character stringIDs can be valid; specify the intended kind explicitly.' };
  `;
}

export function createIdTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [{
    tool: {
      name: 'photoshop_resolve_ids',
      description: 'Resolve Action Manager IDs without changing documents. Supply explicit char or string kind; invalid charID lengths fail before execution. For four-character values also compares charID and stringID interpretations. A numeric result does not establish that a descriptor key is meaningful.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', minItems: 1, maxItems: 100, items: {
            type: 'object', properties: {
              kind: { type: 'string', enum: ['char', 'string'] },
              value: { type: 'string', minLength: 1 },
            }, required: ['kind', 'value'], additionalProperties: false,
          } },
        },
        required: ['ids'], additionalProperties: false,
      },
    },
    handler: async (args) => {
      try {
        const result = parseSnippetResult(await runSnippet(connection, resolveIdsScript(args.ids)));
        if (!result) throw new Error('Invalid ID resolution result');
        return atomicSuccess('Action Manager IDs resolved', result);
      } catch (error) { return atomicFailureFromError(error); }
    },
  }];
}
