import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

/**
 * Anchor point, as fractions of the placed image rectangle.
 * `x`/`y` in the tool arguments address this point, so `top_left` is the classic
 * behaviour and `center` lets a caller say "put the middle of this PNG here".
 */
const ANCHORS = {
  top_left: [0, 0],
  top_center: [0.5, 0],
  top_right: [1, 0],
  center_left: [0, 0.5],
  center: [0.5, 0.5],
  center_right: [1, 0.5],
  bottom_left: [0, 1],
  bottom_center: [0.5, 1],
  bottom_right: [1, 1],
} as const;

export type PlaceAnchor = keyof typeof ANCHORS;

export const PLACE_ANCHOR_ENUM = Object.keys(ANCHORS) as PlaceAnchor[];

/** Map a (possibly sloppy) anchor name onto its x/y fractions. */
export function anchorFractions(anchor: unknown): { x: number; y: number } {
  const key = (typeof anchor === 'string' ? anchor : '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const fractions = ANCHORS[key as PlaceAnchor];
  if (!fractions) return { x: 0, y: 0 };
  return { x: fractions[0], y: fractions[1] };
}

export function createImagePlacementTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_place_image',
        description:
          'Place an external image file as a new layer in the active document, at an exact pixel position.\n\n' +
          'x/y are absolute canvas pixels of the `anchor` point on the image rectangle (0,0 = document top-left). ' +
          "They are NOT an offset from Photoshop's default centered Place. " +
          'Placement is computed from the un-trimmed image rect, so transparent margins in a PNG do not shift the result.\n\n' +
          'Use when: compositing assets into an open document at a known position/size.\n' +
          'Do NOT use when: opening a file as a new document — use photoshop_open_image.\n\n' +
          'Returns: layerName, layerBounds (image rect in canvas pixels), pixelBounds (non-transparent content), ' +
          'scalePercent, imageSize, trimInsets; position.semantics = anchor_point_on_image_rect.\n' +
          'Preconditions: active document; file must exist. Side effects: adds a new layer.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full path to the image file (JPEG, PNG, PSD, etc.)',
            },
            x: {
              type: 'number',
              description: 'Absolute canvas X of the anchor point, in pixels (default: 0)',
              default: 0,
            },
            y: {
              type: 'number',
              description: 'Absolute canvas Y of the anchor point, in pixels (default: 0)',
              default: 0,
            },
            anchor: {
              type: 'string',
              description:
                'Which point of the image x/y refers to (default: top_left). ' +
                'Use center to place by the image midpoint.',
              enum: [...PLACE_ANCHOR_ENUM],
              default: 'top_left',
            },
            scale: {
              type: 'number',
              description:
                "Scale as a percentage of the image's natural pixel size (default: 100 = 1 image px = 1 canvas px). " +
                'Ignored when fit_to_canvas is true.',
              exclusiveMinimum: 0,
              default: 100,
            },
            fit_to_canvas: {
              type: 'boolean',
              description: 'Scale the image to fit inside the canvas, preserving aspect ratio.',
              default: false,
            },
            rasterize: {
              type: 'boolean',
              description:
                'Rasterize the placed smart object immediately (default: false, keeps it editable).',
              default: false,
            },
          },
          required: ['filePath'],
        },
      },
      handler: async (args) => placeImage(connection, args),
    },
    {
      tool: {
        name: 'photoshop_open_image',
        description:
          'Open an image file as a new Photoshop document.\n\n' +
          'Use when: user provides a file path to edit or no document is open yet.\n' +
          'Do NOT use when: adding to an existing composite — use photoshop_place_image.\n\n' +
          'Returns: document id, name, width, height.\n' +
          'Preconditions: file must exist on disk. Side effects: opens document as active.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full path to the image file',
            },
          },
          required: ['filePath'],
        },
      },
      handler: async (args) => openImage(connection, args),
    },
  ];
}

async function placeImage(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.filePath as string;
  const x = typeof args.x === 'number' && Number.isFinite(args.x) ? args.x : 0;
  const y = typeof args.y === 'number' && Number.isFinite(args.y) ? args.y : 0;
  const anchor = anchorFractions(args.anchor);
  const scale = typeof args.scale === 'number' && Number.isFinite(args.scale) ? args.scale : 100;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.placeImage(filePath, x, y, {
      anchorX: anchor.x,
      anchorY: anchor.y,
      scalePercent: scale,
      fitToCanvas: args.fit_to_canvas === true,
      rasterize: args.rasterize === true,
    });
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `Image placed successfully: ${filePath}\n` +
            `Anchor: ${typeof args.anchor === 'string' ? args.anchor : 'top_left'} at (${x}, ${y})\n` +
            `Result: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error placing image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function openImage(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.filePath as string;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.openImage(filePath);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image opened as new document: ${filePath}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error opening image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
