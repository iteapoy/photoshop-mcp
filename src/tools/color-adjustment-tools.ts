import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { createAdjustmentTools } from './adjustment-tools.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

export function createColorAdjustmentTools(connection: PhotoshopConnection): ToolDefinition[] {
  const definitions: ToolDefinition[] = [
    {
      tool: {
        name: 'photoshop_create_black_and_white_adjustment_layer',
        description: 'Create an editable Black & White adjustment layer in the active document.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => runAdjustmentSnippet(
        connection,
        ExtendScriptSnippets.createTonalAdjustmentLayer('blackAndWhite'),
        'Black & White adjustment layer created'
      ),
    },
    {
      tool: {
        name: 'photoshop_create_posterize_adjustment_layer',
        description: 'Create an editable Posterize adjustment layer in the active document.',
        inputSchema: { type: 'object', properties: { levels: { type: 'integer', minimum: 2, maximum: 255, default: 4 } } },
      },
      handler: async (args) => runAdjustmentSnippet(
        connection,
        ExtendScriptSnippets.createTonalAdjustmentLayer('posterization', Math.round(clampNumber(args.levels, 2, 255, 4))),
        'Posterize adjustment layer created'
      ),
    },
    {
      tool: {
        name: 'photoshop_create_threshold_adjustment_layer',
        description: 'Create an editable Threshold adjustment layer in the active document.',
        inputSchema: { type: 'object', properties: { level: { type: 'integer', minimum: 1, maximum: 255, default: 128 } } },
      },
      handler: async (args) => runAdjustmentSnippet(
        connection,
        ExtendScriptSnippets.createTonalAdjustmentLayer('thresholdClassEvent', Math.round(clampNumber(args.level, 1, 255, 128))),
        'Threshold adjustment layer created'
      ),
    },
    {
      tool: {
        name: 'photoshop_apply_lut',
        description:
          'Apply a Color Lookup (3D LUT) adjustment layer for cinematic color grading. Accepts a built-in LUT name (e.g. "Crisp_Warm.3dl", "Kodak 5218 Fuji 3510.3dl", "Moonlight.3dl") or an absolute path to a .cube/.3dl/.look file.\n\n' +
          'Users often say: cinematic grade, film look, teal and orange, apply LUT, sinematik renk.\n\n' +
          'Use when: stylistic non-destructive color grade in one step.\n' +
          'Do NOT use when: basic tonal fixes — use photoshop_adjust_curves or photoshop_auto_levels.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, lut, lut_source } }.\n' +
          'Preconditions: active document. Side effects: adds a Color Lookup adjustment layer.',
        inputSchema: {
          type: 'object',
          properties: {
            lut: {
              type: 'string',
              description:
                'Built-in LUT file name (e.g. "Crisp_Warm.3dl") or absolute path to a .cube/.3dl/.look file',
            },
          },
          required: ['lut'],
        },
      },
      handler: async (args) => applyLut(connection, args),
    },
    {
      tool: {
        name: 'photoshop_adjust_vibrance',
        description:
          'Create a Vibrance adjustment layer. Vibrance boosts muted colors while protecting skin tones.\n\n' +
          'Users often say: make colors pop (safely), boost saturation without clown look.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, vibrance, saturation } }.\n' +
          'Preconditions: active document. Side effects: adds a Vibrance adjustment layer.',
        inputSchema: {
          type: 'object',
          properties: {
            vibrance: { type: 'number', description: 'Vibrance (-100 to 100)', minimum: -100, maximum: 100, default: 40 },
            saturation: { type: 'number', description: 'Saturation (-100 to 100)', minimum: -100, maximum: 100, default: 0 },
          },
        },
      },
      handler: async (args) => adjustVibrance(connection, args),
    },
    {
      tool: {
        name: 'photoshop_adjust_exposure',
        description:
          'Create an Exposure adjustment layer (stops, offset, gamma correction).\n\n' +
          'Users often say: fix underexposed photo, brighten by a stop, gamma fix.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, exposure, offset, gamma } }.\n' +
          'Preconditions: active document. Side effects: adds an Exposure adjustment layer.',
        inputSchema: {
          type: 'object',
          properties: {
            exposure: { type: 'number', description: 'Exposure in stops (-20 to 20)', minimum: -20, maximum: 20, default: 0.5 },
            offset: { type: 'number', description: 'Offset (-0.5 to 0.5)', minimum: -0.5, maximum: 0.5, default: 0 },
            gamma: { type: 'number', description: 'Gamma correction (0.01 to 9.99)', minimum: 0.01, maximum: 9.99, default: 1 },
          },
        },
      },
      handler: async (args) => adjustExposure(connection, args),
    },
    {
      tool: {
        name: 'photoshop_apply_photo_filter',
        description:
          'Create a Photo Filter adjustment layer (warming/cooling/custom tint with density control).\n\n' +
          'Users often say: warm it up, cool it down, add a tint, golden hour look.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, color, density } }.\n' +
          'Preconditions: active document. Side effects: adds a Photo Filter adjustment layer.',
        inputSchema: {
          type: 'object',
          properties: {
            red: { type: 'number', description: 'Filter color red (0-255); warming ≈ 236', minimum: 0, maximum: 255, default: 236 },
            green: { type: 'number', description: 'Filter color green (0-255); warming ≈ 138', minimum: 0, maximum: 255, default: 138 },
            blue: { type: 'number', description: 'Filter color blue (0-255); warming ≈ 0', minimum: 0, maximum: 255, default: 0 },
            density: { type: 'number', description: 'Filter density percent (0-100)', minimum: 0, maximum: 100, default: 25 },
            preserve_luminosity: { type: 'boolean', description: 'Preserve luminosity (default true)', default: true },
          },
        },
      },
      handler: async (args) => applyPhotoFilter(connection, args),
    },
    {
      tool: {
        name: 'photoshop_apply_gradient_map',
        description:
          'Create a Gradient Map adjustment layer (black→white by default) for duotone/B&W tonal remapping.\n\n' +
          'Users often say: duotone look, gradient map B&W, remap tones.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, reverse } }.\n' +
          'Preconditions: active document. Side effects: adds a Gradient Map adjustment layer.',
        inputSchema: {
          type: 'object',
          properties: {
            reverse: { type: 'boolean', description: 'Reverse the gradient (white→black)', default: false },
          },
        },
      },
      handler: async (args) => applyGradientMap(connection, args),
    },
  ];
  const sources = [...definitions, ...createAdjustmentTools(connection)];
  const types = {
    black_and_white: 'photoshop_create_black_and_white_adjustment_layer',
    posterize: 'photoshop_create_posterize_adjustment_layer',
    threshold: 'photoshop_create_threshold_adjustment_layer',
    exposure: 'photoshop_adjust_exposure',
    vibrance: 'photoshop_adjust_vibrance',
    curves: 'photoshop_adjust_curves',
    photo_filter: 'photoshop_apply_photo_filter',
    color_lookup: 'photoshop_apply_lut',
    gradient_map: 'photoshop_apply_gradient_map',
  };
  const variants = Object.entries(types).map(([type, name]) => {
    const source = sources.find((definition) => definition.tool.name === name)!;
    return { type, source };
  });
  const unified: ToolDefinition = {
    tool: {
      name: 'photoshop_create_adjustment_layer',
      description: 'Create an editable adjustment layer. Choose type and supply only parameters supported by that type. Query photoshop_schema for the complete per-type schemas.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: Object.keys(types) },
          params: { type: 'object', additionalProperties: true },
        },
        required: ['type'],
        additionalProperties: false,
        oneOf: variants.map(({ type, source }) => ({
          properties: {
            type: { const: type },
            params: { ...source.tool.inputSchema, additionalProperties: false },
          },
          ...(source.tool.inputSchema.required?.length ? { required: ['params'] } : {}),
        })),
      },
    },
    handler: async (args) => {
      const variant = variants.find((entry) => entry.type === args.type);
      if (!variant) return atomicFailureFromError(new Error('Invalid adjustment layer type'));
      if (Object.keys(args).some((key) => key !== 'type' && key !== 'params')) {
        return atomicFailureFromError(new Error('Only type and params are accepted'));
      }
      const params = args.params ?? {};
      if (typeof params !== 'object' || Array.isArray(params)) {
        return atomicFailureFromError(new Error('params must be an object'));
      }
      const schema = variant.source.tool.inputSchema;
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (!(required in params)) return atomicFailureFromError(new Error(required + ' is required'));
      }
      for (const [key, value] of Object.entries(params)) {
        const rule = properties[key] as {
          type?: string; minimum?: number; maximum?: number; enum?: unknown[];
        } | undefined;
        if (!rule) return atomicFailureFromError(new Error('Unsupported parameter: ' + key));
        const validType = rule.type === 'integer'
          ? typeof value === 'number' && Number.isInteger(value)
          : typeof value === rule.type;
        if (!validType || (typeof value === 'number' && (
          !Number.isFinite(value) ||
          (rule.minimum !== undefined && value < rule.minimum) ||
          (rule.maximum !== undefined && value > rule.maximum)
        )) || (rule.enum && !rule.enum.includes(value))) {
          return atomicFailureFromError(new Error('Invalid parameter: ' + key));
        }
      }
      return variant.source.handler(params as Record<string, unknown>);
    },
  };
  return [unified, ...definitions];
}

async function runAdjustmentSnippet(
  connection: PhotoshopConnection,
  script: string,
  summary: string
): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, script);
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable adjustment result: ${String(raw)}`));
    }
    return atomicSuccess(summary, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function applyLut(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const lut = typeof args.lut === 'string' ? args.lut.trim() : '';
  if (!lut) {
    return atomicFailureFromError(new Error('lut parameter is required'));
  }
  return runAdjustmentSnippet(
    connection,
    ExtendScriptSnippets.applyLut(lut),
    `Color Lookup adjustment layer created (${lut})`
  );
}

async function adjustVibrance(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const vibrance = clampNumber(args.vibrance, -100, 100, 40);
  const saturation = clampNumber(args.saturation, -100, 100, 0);
  return runAdjustmentSnippet(
    connection,
    ExtendScriptSnippets.adjustVibrance(vibrance, saturation),
    `Vibrance adjustment layer created (vibrance ${vibrance}, saturation ${saturation})`
  );
}

async function adjustExposure(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const exposure = clampNumber(args.exposure, -20, 20, 0.5);
  const offset = clampNumber(args.offset, -0.5, 0.5, 0);
  const gamma = clampNumber(args.gamma, 0.01, 9.99, 1);
  return runAdjustmentSnippet(
    connection,
    ExtendScriptSnippets.adjustExposure(exposure, offset, gamma),
    `Exposure adjustment layer created (${exposure} stops)`
  );
}

async function applyPhotoFilter(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const red = clampNumber(args.red, 0, 255, 236);
  const green = clampNumber(args.green, 0, 255, 138);
  const blue = clampNumber(args.blue, 0, 255, 0);
  const density = clampNumber(args.density, 0, 100, 25);
  const preserve = args.preserve_luminosity !== false;
  return runAdjustmentSnippet(
    connection,
    ExtendScriptSnippets.applyPhotoFilter(red, green, blue, density, preserve),
    `Photo Filter adjustment layer created (density ${density}%)`
  );
}

async function applyGradientMap(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const reverse = args.reverse === true;
  return runAdjustmentSnippet(
    connection,
    ExtendScriptSnippets.applyGradientMap(reverse),
    `Gradient Map adjustment layer created${reverse ? ' (reversed)' : ''}`
  );
}
