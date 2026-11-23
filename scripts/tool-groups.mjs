/**
 * HTTP tool discovery: domain groups accept { action, params }; photoshop_call
 * accepts { tool, params }. Query photoshop_schema for per-action parameters.
 * Original schemas validate calls; wrapper aliases are normalized by extractCall
 * and unwrapNestedArgs. Group overrides live in ~/.photoshop-mcp/tool-groups.json.
 */

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';


export const GROUPS_FILE = join(homedir(), '.photoshop-mcp', 'tool-groups.json');

export const GROUPS = {
  document: {
    order: 1,
    desc: 'Document lifecycle and canvas: new/open/close document, resize, crop, place image, activate document, history, current state and preview.',
  },
  layer: {
    order: 2,
    desc: 'Layers and compositing: create, delete, duplicate, reorder, transform, blend mode, opacity, visibility, lock, merge, flatten.',
  },
  selection: {
    order: 3,
    desc: 'Selections: rectangle/ellipse, select all/subject/layer, deselect, invert, feather, expand, contract, save, bounds.',
  },
  text: {
    order: 4,
    desc: 'Type layers: create and edit text, font family/size/color, alignment, ranges and mixed styles, list/install fonts.',
  },
  adjust: {
    order: 5,
    desc: 'Adjustments and filters: brightness/contrast, curves, exposure, hue/saturation, vibrance, blur, sharpen, noise, auto levels/contrast, LUT, photo filter.',
  },
  mask: {
    order: 6,
    desc: 'Layer masks and clipping masks: create, apply, delete, gradient mask, clipping mask create/release.',
  },
  export: {
    order: 7,
    desc: 'Output: export as PNG/JPG/WebP/AVIF, save document (PSD etc.), rasterize layer.',
  },
  fill: {
    order: 8,
    desc: 'Fills: gradient fill, gradient map, content-aware fill.',
  },
  smart_object: {
    order: 9,
    desc: 'Smart objects: convert, replace contents, edit contents, duplicate as smart object.',
  },
  artboard: {
    order: 10,
    desc: 'Artboards and data sets: create/list/activate/export artboards, import/export data sets.',
  },
  recipe: {
    order: 11,
    desc: 'High-level one-call recipes: remove background, enhance portrait, prepare for web, social export sizes, watermark, passport photo, color grade, frequency separation, mockup replace, CSV to cards, and more.',
  },
  system: {
    order: 12,
    desc: 'Bridge/system: ping, version, capabilities, undo/redo, play action, run ExtendScript.',
  },
  path: {
    order: 13,
    desc: 'Vector paths & pen: create path, stroke path (solid or dashed), fill path, delete path.',
  },
};

const SYSTEM_TOOLS = new Set([
  'ping',
  'get_version',
  'get_capabilities',
  'undo',
  'redo',
  'play_action',
  'execute_script',
]);

/**
 * Names the heuristics below would file under the wrong group. Sorted-out by
 * hand because a name is not a taxonomy: `select_layer_by_name` starts with
 * "select" but is a layer lookup, and `rasterize_layer` belongs to the layer
 * domain, not to export.
 */
const EXACT_GROUPS = {
  select_layer_by_name: 'layer',
  rasterize_layer: 'layer',
  apply_layer_style: 'layer',
  fit_layer_to_document: 'layer',
};

const DOCUMENT_TOOLS = new Set([
  'get_state',
  'get_preview',
  'get_document_info',
  'list_documents',
  'create_document',
  'open_image',
  'close_document',
  'resize_image',
  'crop_document',
  'place_image',
  'set_active_document',
  'get_history',
]);

export function actionOf(toolName) {
  return toolName.replace(/^photoshop_/, '');
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
let cfgCache = null;
let cfgStamp = -1;

export function loadGroupConfig() {
  let stamp = 0;
  try {
    stamp = statSync(GROUPS_FILE).mtimeMs;
  } catch {
    stamp = 0;
  }
  if (cfgCache && stamp === cfgStamp) return cfgCache;
  const defaults = { rawTool: true, overrides: {} };
  try {
    const raw = JSON.parse(readFileSync(GROUPS_FILE, 'utf8'));
    cfgCache = { ...defaults, ...raw, overrides: { ...(raw.overrides ?? {}) } };
  } catch {
    cfgCache = defaults;
  }
  cfgStamp = stamp;
  return cfgCache;
}

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------
export function groupOf(toolName, config = loadGroupConfig()) {
  const override = config.overrides?.[toolName];
  if (override) return override;

  const s = actionOf(toolName);
  if (EXACT_GROUPS[s]) return EXACT_GROUPS[s];
  if (s.startsWith('recipe_')) return 'recipe';
  if (SYSTEM_TOOLS.has(s)) return 'system';
  if (DOCUMENT_TOOLS.has(s)) return 'document';
  if (s.startsWith('select') || s === 'deselect' || s.includes('selection')) return 'selection';
  if (s.includes('text') || s.includes('font')) return 'text';
  if (s.includes('smart_object')) return 'smart_object';
  if (s.includes('mask') || s.includes('clipping')) return 'mask';
  if (s.includes('artboard') || s.includes('dataset')) return 'artboard';
  if (s.includes('export') || s.startsWith('save') || s === 'rasterize_layer') return 'export';
  if (
    s.includes('adjust') ||
    s.includes('desaturate') ||
    s === 'invert' ||
    s.includes('blur') ||
    s.includes('sharpen') ||
    s.includes('noise') ||
    s.includes('auto_levels') ||
    s.includes('auto_contrast') ||
    s.includes('image_stack') ||
    s.includes('layer_style') ||
    s.includes('high_pass') ||
    s.includes('lut') ||
    s.includes('photo_filter') ||
    s.includes('gradient_map')
  ) {
    return 'adjust';
  }
  if (['create_group', 'move_layers_to_group', 'ungroup'].includes(s)) return 'layer';
  if (s === 'resolve_ids') return 'system';
  if (s === 'save_snapshot' || s === 'revert_to_state') return 'document';
  if (s === 'create_shape_layer') return 'path';
  if (s.endsWith('_path') || s === 'create_path') return 'path';
  if (s.includes('fill') || s.includes('gradient')) return 'fill';
  if (
    s.includes('layer') ||
    s.includes('merge') ||
    s === 'flatten_image' ||
    s.includes('opacity') ||
    s.includes('blend') ||
    s.includes('lock') ||
    s.includes('move') ||
    s.includes('rename') ||
    s.includes('duplicate') ||
    s.includes('rotate') ||
    s.includes('scale')
  ) {
    return 'layer';
  }
  if (s.includes('document') || s.includes('crop') || s.includes('resize') || s.includes('history')) {
    return 'document';
  }
  return 'document';
}

// ---------------------------------------------------------------------------
// schema helpers
// ---------------------------------------------------------------------------
export function schemaOf(tool) {
  const sch = tool?.inputSchema ?? {};
  return sch.jsonSchema ?? sch;
}

function typesOf(prop) {
  const t = prop?.type;
  if (Array.isArray(t)) return t;
  if (typeof t === 'string') return [t];
  if (prop?.enum) return ['string'];
  return [];
}

function typeLabel(prop) {
  const t = typesOf(prop);
  if (t.length) return t.join('|');
  if (prop?.enum) return 'string';
  return 'any';
}

/** `(name?, document_id*, type?)` — `*` marks required. */
export function paramSignature(tool) {
  const sch = schemaOf(tool);
  const props = sch.properties ?? {};
  const required = new Set(sch.required ?? []);
  const names = Object.keys(props);
  if (!names.length) return '()';
  return `(${names.map((n) => n + (required.has(n) ? '*' : '?')).join(', ')})`;
}

function compactDesc(text, max = 72) {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// umbrella tool construction
// ---------------------------------------------------------------------------
export function buildGroupedTools(tools, config = loadGroupConfig()) {
  const byGroup = new Map();
  for (const tool of tools) {
    const g = groupOf(tool.name, config);
    if (!GROUPS[g]) {
      // Unknown override target: fall back so the tool is never lost.
      const fallback = 'document';
      if (!byGroup.has(fallback)) byGroup.set(fallback, []);
      byGroup.get(fallback).push(tool);
      continue;
    }
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(tool);
  }

  const umbrellas = [];
  const index = new Map();

  const ordered = [...byGroup.entries()].sort(
    (a, b) => (GROUPS[a[0]]?.order ?? 99) - (GROUPS[b[0]]?.order ?? 99)
  );

  for (const [g, list] of ordered) {
    list.sort((a, b) => actionOf(a.name).localeCompare(actionOf(b.name)));
    const meta = GROUPS[g];
    const name = `photoshop_${g}`;
    const actionLines = list.map(
      (t) => `- ${actionOf(t.name)} — ${compactDesc(t.description)}`
    );

    umbrellas.push({
      name,
      description:
        `${meta.desc}\n` +
        `Choose an action, query photoshop_schema with "<group>/<action>" for its parameters, then pass them in "params".\n` +
        actionLines.join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: list.map((t) => actionOf(t.name)),
            description: 'Action name from the list above',
          },
          params: {
            type: 'object',
            description: 'Parameters returned by photoshop_schema for the chosen action.',
            additionalProperties: true,
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
    });

    index.set(name, new Map(list.map((t) => [actionOf(t.name), t])));
  }

  const schemaTool = {
    name: 'photoshop_schema',
    description:
      'Use action list to list all groups and actions. Otherwise return a compact schema and usage constraints. ' +
      'For adjust/create_adjustment_layer, pass type to retrieve only that adjustment type. ' +
      'Query this before calling an action to discover its accepted parameters, required fields, and defaults. Reuse the schema for subsequent calls to the same action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Group/action (e.g. "layer/get_layers") or raw tool name (e.g. "photoshop_get_layers").',
        },
        type: {
          type: 'string',
          description: 'Optional adjustment layer type, e.g. threshold, exposure, or curves.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  };

  if (config.rawTool) {
    umbrellas.push({
      name: 'photoshop_call',
      description:
        'Escape hatch: call one raw upstream tool by its exact name with its original schema. ' +
        'Same shape as a group tool — { tool, params } — only the key names differ. ' +
        'Only use when the grouped tools cannot express the call; check photoshop_schema first.',
      inputSchema: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Exact tool name, e.g. photoshop_get_state' },
          params: {
            type: 'object',
            description: 'Arguments for that tool (same field names as its schema).',
            additionalProperties: true,
          },
        },
        required: ['tool'],
        additionalProperties: false,
      },
    });
  }
  umbrellas.push(schemaTool);

  return { tools: umbrellas, index };
}

// ---------------------------------------------------------------------------
// argument validation / normalization
// ---------------------------------------------------------------------------
function matchesType(value, type) {
  switch (type) {
    case 'null':
      return value === null;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

function coerce(value, prop) {
  const types = typesOf(prop);
  if (types.length === 0) return value;
  if (types.length === 1 && types[0] === 'string' && typeof value === 'number') return String(value);
  if (types.includes('number') && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (types.includes('integer') && typeof value === 'string' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (types.includes('boolean') && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (types.includes('string') && Array.isArray(value)) {
    return value.join(', ');
  }
  return value;
}

/** Keys that only ever act as a payload wrapper, never as a real parameter. */
const WRAPPER_KEYS = ['params', 'arguments', 'args'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Splice payload wrappers until the arguments sit at the top level.
 *
 * Models wrap without a consistent depth: `{ params: { params: { document_id } } }`
 * is something a real session produces, and the `photoshop_call` escape hatch
 * adds `arguments` on top of it. Rather than teaching the caller the depth, we
 * peel every wrapper layer here — bounded by a guard and a seen-set so a
 * self-referencing object cannot spin forever.
 *
 * A key is only treated as a wrapper when the target schema has no parameter of
 * that name, so tools that genuinely take `params` keep their payload intact.
 */
export function unwrapNestedArgs(input, props) {
  let args = { ...(input ?? {}) };
  const seen = new Set([args]);
  for (let guard = 0; guard < 8; guard++) {
    const key = WRAPPER_KEYS.find(
      (k) => !(k in props) && isPlainObject(args[k]) && !seen.has(args[k])
    );
    if (!key) break;
    const nested = args[key];
    seen.add(nested);
    const rest = { ...args };
    delete rest[key];
    // The wrapper is the more specific truth: it wins over leftover siblings.
    args = { ...rest, ...nested };
  }
  return args;
}

/**
 * Validate + normalize arguments for a real tool.
 *
 * `document_id` is required by most Photoshop tools; upstream treats null as
 * "the active document", so we fill it in rather than making the model repeat it.
 */
export function prepareArgs(tool, rawArgs) {
  const sch = schemaOf(tool);
  const props = sch.properties ?? {};
  const required = new Set(sch.required ?? []);
  const args = unwrapNestedArgs({ ...(rawArgs ?? {}) }, props);
  const aliases = {
    file_path: ['photoshop_export_as', 'photoshop_save_document'].includes(tool.name) ? 'path' : 'filePath',
    max_size: 'max_dimension_px',
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(alias in props) && canonical in props && args[alias] !== undefined) {
      if (args[canonical] !== undefined && args[canonical] !== args[alias]) {
        return { ok: false, message: 'Conflicting parameters: ' + alias + ' and ' + canonical };
      }
      args[canonical] = args[alias];
      delete args[alias];
    }
  }
  const errors = [];

  if (required.has('document_id') && args.document_id === undefined) {
    args.document_id = null;
  }

  for (const [key, prop] of Object.entries(props)) {
    if (args[key] === undefined) continue;
    args[key] = coerce(args[key], prop);
  }

  const missing = [];
  for (const key of required) {
    if (args[key] === undefined) missing.push(`${key} (${typeLabel(props[key] ?? {})})`);
  }
  if (missing.length) errors.push(`missing required: ${missing.join(', ')}`);

  const unknown = Object.keys(args).filter((k) => !(k in props));
  if (unknown.length) {
    const allowed = Object.keys(props).length ? Object.keys(props).join(', ') : '(none)';
    errors.push(`unknown params: ${unknown.join(', ')} — allowed: ${allowed}`);
    // Wrappers of any depth are already spliced above, so a surviving one is
    // either not an object (e.g. params: "document_id=3") or self-referencing.
    const wrappers = unknown.filter((k) => WRAPPER_KEYS.includes(k));
    if (wrappers.length) {
      errors.push(
        `hint: "${wrappers.join('", "')}" only wraps the real parameters — ` +
          'pass them as a JSON object inside it, e.g. params: { document_id: 3 }'
      );
    }
  }

  const badType = [];
  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop || value === undefined) continue;
    const types = typesOf(prop);
    if (!types.length) continue;
    if (!types.some((t) => matchesType(value, t))) {
      badType.push(`${key} should be ${types.join('|')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
    }
  }
  if (badType.length) errors.push(badType.join('; '));

  if (errors.length) {
    const allowed = Object.keys(props).map((k) => `${k}${required.has(k) ? '*' : ''}:${typeLabel(props[k])}`);
    return {
      ok: false,
      message:
        `${actionOf(tool.name)}${paramSignature(tool)} — invalid arguments\n` +
        errors.join('\n') +
        `\nparameters: ${allowed.length ? allowed.join(', ') : '(none)'}` +
        `\nUse photoshop_schema with action "${actionOf(tool.name)}" for the full schema.`,
    };
  }

  // Drop keys the upstream schema does not know about (already reported above).
  const clean = {};
  for (const key of Object.keys(props)) {
    if (args[key] !== undefined) clean[key] = args[key];
  }
  return { ok: true, args: clean };
}

/**
 * Pull `{ <actionKey>, params }` out of whatever shape the model produced.
 *
 * One extractor for both entry points — `action` for a group tool, `tool` for
 * photoshop_call — so the two can never drift apart again. Accepted, in order
 * of preference: `params`, `arguments`, `args`, plus flat siblings of the
 * action key (older prompts spread the payload instead of nesting it).
 * Deeper wrappers are left for `prepareArgs`, which splices them by schema.
 */
export function extractCall(rawArgs, actionKey = 'action') {
  const rest = { ...(rawArgs ?? {}) };
  const rawAction = rest[actionKey];
  delete rest[actionKey];
  const action = typeof rawAction === 'string' ? rawAction.trim() : '';

  let params = {};
  for (const key of ['args', 'arguments', 'params']) {
    if (isPlainObject(rest[key])) params = { ...params, ...rest[key] };
    delete rest[key];
  }
  return { action, params: { ...rest, ...params } };
}

export function findToolByName(tools, name) {
  return tools.find((t) => t.name === name) ?? null;
}

/** Resolve "layer/get_layers" | "get_layers" | "photoshop_get_layers" to a tool. */
export function resolveAction(tools, action) {
  const raw = String(action ?? '').trim();
  if (!raw) return null;
  const candidates = [raw, `photoshop_${raw}`];
  const slash = raw.indexOf('/');
  if (slash > 0) {
    const a = raw.slice(slash + 1).trim();
    candidates.push(`photoshop_${a}`, a);
  }
  const bare = raw.replace(/^photoshop_/, '');
  if (bare !== raw) candidates.push(bare);
  for (const c of candidates) {
    const hit = findToolByName(tools, c);
    if (hit) return hit;
  }
  return null;
}


// Preserve the callable schema while removing duplicated prose from discovery.
export function actionSchemaDetails(tool, adjustmentType) {
  const original = schemaOf(tool);
  let schema = original;
  if (adjustmentType !== undefined) {
    if (tool.name !== 'photoshop_create_adjustment_layer') {
      throw new Error('type is only supported for create_adjustment_layer');
    }
    const variant = original.oneOf?.find(
      (entry) => entry.properties?.type?.const === adjustmentType
    );
    if (!variant) {
      throw new Error('Unknown adjustment type. Available: ' +
        (original.properties?.type?.enum ?? []).join(', '));
    }
    schema = {
      ...original,
      properties: { ...original.properties, ...variant.properties },
      required: [...new Set([...(original.required ?? []), ...(variant.required ?? [])])],
    };
    delete schema.oneOf;
  }
  const description = tool.description ?? '';
  const constraints = description.split(/\n+/).filter(
    (line) => /preconditions:|side effects:|important:|must |cannot |rasteriz/i.test(line)
  );
  return {
    action: actionOf(tool.name),
    ...(adjustmentType === undefined ? {} : { type: adjustmentType }),
    ...(constraints.length ? { constraints: constraints.join('\n') } : {}),
    schema,
  };
}
