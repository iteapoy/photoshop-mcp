import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets, type CurvesPreset } from '../api/extendscript.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createColorAdjustmentTools(connection: PhotoshopConnection): ToolDefinition[] {
  const variants: Array<{
    type: string;
    schema: ToolDefinition['tool']['inputSchema'];
    handler: ToolDefinition['handler'];
  }> = [
    {
      type: 'black_and_white',
      schema: { type: 'object', properties: {} },
      handler: async () =>
        runAdjustmentSnippet(
          connection,
          ExtendScriptSnippets.createTonalAdjustmentLayer('blackAndWhite'),
          'Black & White adjustment layer created'
        ),
    },
    {
      type: 'posterize',
      schema: {
        type: 'object',
        properties: { levels: { type: 'integer', minimum: 2, maximum: 255, default: 4 } },
      },
      handler: async (args) =>
        runAdjustmentSnippet(
          connection,
          ExtendScriptSnippets.createTonalAdjustmentLayer(
            'posterization',
            (args.levels as number | undefined) ?? 4
          ),
          'Posterize adjustment layer created'
        ),
    },
    {
      type: 'threshold',
      schema: {
        type: 'object',
        properties: { level: { type: 'integer', minimum: 1, maximum: 255, default: 128 } },
      },
      handler: async (args) =>
        runAdjustmentSnippet(
          connection,
          ExtendScriptSnippets.createTonalAdjustmentLayer(
            'thresholdClassEvent',
            (args.level as number | undefined) ?? 128
          ),
          'Threshold adjustment layer created'
        ),
    },
    {
      type: 'color_lookup',
      schema: {
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
      handler: async (args) => applyLut(connection, args),
    },
    {
      type: 'vibrance',
      schema: {
        type: 'object',
        properties: {
          vibrance: {
            type: 'number',
            description: 'Vibrance (-100 to 100)',
            minimum: -100,
            maximum: 100,
            default: 40,
          },
          saturation: {
            type: 'number',
            description: 'Saturation (-100 to 100)',
            minimum: -100,
            maximum: 100,
            default: 0,
          },
        },
      },
      handler: async (args) => adjustVibrance(connection, args),
    },
    {
      type: 'exposure',
      schema: {
        type: 'object',
        properties: {
          exposure: {
            type: 'number',
            description: 'Exposure in stops (-20 to 20)',
            minimum: -20,
            maximum: 20,
            default: 0.5,
          },
          offset: {
            type: 'number',
            description: 'Offset (-0.5 to 0.5)',
            minimum: -0.5,
            maximum: 0.5,
            default: 0,
          },
          gamma: {
            type: 'number',
            description: 'Gamma correction (0.01 to 9.99)',
            minimum: 0.01,
            maximum: 9.99,
            default: 1,
          },
        },
      },
      handler: async (args) => adjustExposure(connection, args),
    },
    {
      type: 'photo_filter',
      schema: {
        type: 'object',
        properties: {
          red: {
            type: 'number',
            description: 'Filter color red (0-255); warming ≈ 236',
            minimum: 0,
            maximum: 255,
            default: 236,
          },
          green: {
            type: 'number',
            description: 'Filter color green (0-255); warming ≈ 138',
            minimum: 0,
            maximum: 255,
            default: 138,
          },
          blue: {
            type: 'number',
            description: 'Filter color blue (0-255); warming ≈ 0',
            minimum: 0,
            maximum: 255,
            default: 0,
          },
          density: {
            type: 'number',
            description: 'Filter density percent (0-100)',
            minimum: 0,
            maximum: 100,
            default: 25,
          },
          preserve_luminosity: {
            type: 'boolean',
            description: 'Preserve luminosity (default true)',
            default: true,
          },
        },
      },
      handler: async (args) => applyPhotoFilter(connection, args),
    },
    {
      type: 'gradient_map',
      schema: {
        type: 'object',
        properties: {
          reverse: {
            type: 'boolean',
            description: 'Reverse the gradient (white→black)',
            default: false,
          },
        },
      },
      handler: async (args) => applyGradientMap(connection, args),
    },
    {
      type: 'curves',
      schema: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            enum: ['auto_tone', 'neutral'],
            description: 'auto_tone (S-curve) or neutral (identity curve)',
            default: 'auto_tone',
          },
        },
      },
      handler: async (args) =>
        runAdjustmentSnippet(
          connection,
          ExtendScriptSnippets.adjustCurves((args.preset ?? 'auto_tone') as CurvesPreset),
          'Curves adjustment layer created'
        ),
    },
  ];
  const unified: ToolDefinition = {
    tool: {
      name: 'photoshop_create_adjustment_layer',
      description:
        'Create an editable adjustment layer. Choose type and supply only parameters supported by that type.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: variants.map((variant) => variant.type) },
          params: { type: 'object', additionalProperties: true },
        },
        required: ['type'],
        additionalProperties: false,
        oneOf: variants.map(({ type, schema }) => ({
          properties: {
            type: { const: type },
            params: { ...schema, additionalProperties: false },
          },
          ...(schema.required?.length ? { required: ['params'] } : {}),
        })),
      },
    },
    handler: async (args) => {
      const variant = variants.find((entry) => entry.type === args.type);
      if (!variant)
        return atomicFailure({
          ok: false,
          code: 'invalid_arguments',
          message: 'Invalid adjustment layer type',
        });
      if (
        Object.keys(args).some((key) => key !== 'type' && key !== 'params' && key !== 'document_id')
      ) {
        return atomicFailure({
          ok: false,
          code: 'invalid_arguments',
          message: 'Only type, params, and document_id are accepted',
        });
      }
      const params = args.params === undefined ? {} : args.params;
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        return atomicFailure({
          ok: false,
          code: 'invalid_arguments',
          message: 'params must be an object',
        });
      }
      const schema = variant.schema;
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (!(required in params))
          return atomicFailure({
            ok: false,
            code: 'invalid_arguments',
            message: required + ' is required',
          });
      }
      for (const [key, value] of Object.entries(params)) {
        const rule = properties[key] as
          | {
              type?: string;
              minimum?: number;
              maximum?: number;
              enum?: unknown[];
            }
          | undefined;
        if (!rule)
          return atomicFailure({
            ok: false,
            code: 'invalid_arguments',
            message: 'Unsupported parameter: ' + key,
          });
        const validType =
          rule.type === 'integer'
            ? typeof value === 'number' && Number.isInteger(value)
            : typeof value === rule.type;
        if (
          !validType ||
          (typeof value === 'number' &&
            (!Number.isFinite(value) ||
              (rule.minimum !== undefined && value < rule.minimum) ||
              (rule.maximum !== undefined && value > rule.maximum))) ||
          (rule.enum && !rule.enum.includes(value))
        ) {
          return atomicFailure({
            ok: false,
            code: 'invalid_arguments',
            message: 'Invalid parameter: ' + key,
          });
        }
      }
      return variant.handler(params as Record<string, unknown>);
    },
  };
  return [unified];
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
  const vibrance = (args.vibrance as number | undefined) ?? 40;
  const saturation = (args.saturation as number | undefined) ?? 0;
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
  const exposure = (args.exposure as number | undefined) ?? 0.5;
  const offset = (args.offset as number | undefined) ?? 0;
  const gamma = (args.gamma as number | undefined) ?? 1;
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
  const red = (args.red as number | undefined) ?? 236;
  const green = (args.green as number | undefined) ?? 138;
  const blue = (args.blue as number | undefined) ?? 0;
  const density = (args.density as number | undefined) ?? 25;
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
